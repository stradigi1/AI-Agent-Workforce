const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const tenantsRepo = require('../db/repo/tenants');
const usersRepo = require('../db/repo/users');
const impersonationRepo = require('../db/repo/impersonation');
const usageRepo = require('../db/repo/usage');
const activityRepo = require('../db/repo/activity');
const ticketsRepo = require('../db/repo/tickets');
const notificationsRepo = require('../db/repo/notifications');
const emailService = require('../services/emailService');
const { seedTenantDefaults } = require('../db/seedTenant');
const jwtService = require('../services/jwt');
const { authRequired } = require('../middleware/auth');
const { requireStradigiRole } = require('../middleware/requireRole');

const router = express.Router();

router.use(authRequired, requireStradigiRole('StradigiAdmin', 'StradigiSupport'));

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
function publicUser(user) {
  const { password_hash, invite_token, password_reset_token, ...safe } = user;
  return safe;
}

// ---------- Tenants ----------
router.get('/tenants', async (req, res) => {
  const tenants = await tenantsRepo.listTenants();
  res.json(tenants);
});

// Provisioning a new tenant account (Section 11: "Admin layer"). The Owner
// is created via the same invite-acceptance flow regular team invites use —
// no password is set here, so Stradigi staff never see/handle it.
router.post('/tenants', requireStradigiRole('StradigiAdmin'), async (req, res) => {
  try {
    const { companyName, ownerEmail, ownerName } = req.body;
    if (!companyName || !ownerEmail) return res.status(400).json({ error: 'companyName and ownerEmail are required' });

    let slug = slugify(companyName);
    if (await tenantsRepo.slugExists(slug)) slug = `${slug}-${crypto.randomBytes(3).toString('hex')}`;

    const tenant = await tenantsRepo.createTenant({ name: companyName, slug });
    await seedTenantDefaults(tenant.id, tenant.name);

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await usersRepo.createInvite(tenant.id, { email: ownerEmail, role: 'Owner', canApprove: true, inviteToken, expiresAt });

    const inviteUrl = `${process.env.APP_URL || ''}/accept-invite.html?token=${inviteToken}`;
    await emailService.sendEmail({
      to: ownerEmail,
      subject: `Your ${companyName} AI Workforce Portal account is ready`,
      text: `${ownerName ? `Hi ${ownerName},\n\n` : ''}Your account has been provisioned. Set your password to get started: ${inviteUrl}\nThis link expires in 7 days.`,
    });

    await activityRepo.log(tenant.id, null, 'tenant_provisioned', `Provisioned by Stradigi admin ${req.user.email}`);
    res.status(201).json({ tenant, slug });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/tenants/:id', async (req, res) => {
  const tenant = await tenantsRepo.getTenantById(req.params.id);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  res.json(tenant);
});

router.get('/tenants/:id/users', async (req, res) => {
  const users = await usersRepo.listUsersByTenant(req.params.id);
  res.json(users);
});

router.get('/tenants/:id/usage', async (req, res) => {
  const usage = await usageRepo.getMonthToDateTokens(req.params.id);
  res.json(usage);
});

router.patch('/tenants/:id/status', requireStradigiRole('StradigiAdmin'), async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'suspended', 'pending_deletion'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const tenant = await tenantsRepo.setStatus(req.params.id, status);
    await activityRepo.log(req.params.id, null, 'tenant_status_changed', `${status} by ${req.user.email}`);
    res.json(tenant);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Impersonation (Section 6) ----------
// Every session is logged with start/end timestamps and never exposes or
// requires the tenant user's password — this issues a fresh token scoped to
// the target user, carrying an `impersonation` claim so the UI can render
// the mandatory banner and so /end below can find its way back.
router.post('/impersonate/start', requireStradigiRole('StradigiAdmin'), async (req, res) => {
  try {
    const { tenantId, targetUserId } = req.body;
    if (!tenantId || !targetUserId) return res.status(400).json({ error: 'tenantId and targetUserId are required' });

    const targetUser = await usersRepo.getUserById(targetUserId);
    if (!targetUser || targetUser.tenant_id !== Number(tenantId)) {
      return res.status(404).json({ error: 'Target user not found on that tenant' });
    }

    const session = await impersonationRepo.startSession(req.user.id, tenantId, targetUserId);
    await activityRepo.log(tenantId, targetUserId, 'impersonation_started', `By Stradigi admin ${req.user.email}`);

    const token = jwtService.sign({
      sub: targetUser.id,
      tenantId: targetUser.tenant_id,
      userType: targetUser.user_type,
      role: targetUser.role,
      impersonation: { sessionId: session.id, stradigiUserId: req.user.id, stradigiEmail: req.user.email },
    });

    res.json({ token, user: publicUser(targetUser), session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Called while the impersonation token is still active (req.impersonation
// comes from the authRequired middleware reading the token's claim).
router.post('/impersonate/end', async (req, res) => {
  try {
    if (!req.impersonation) return res.status(400).json({ error: 'Not currently impersonating' });

    await impersonationRepo.endSession(req.impersonation.sessionId);
    await activityRepo.log(req.tenantId, req.user.id, 'impersonation_ended', `By Stradigi admin ${req.impersonation.stradigiEmail}`);

    const stradigiUser = await usersRepo.getUserById(req.impersonation.stradigiUserId);
    const token = jwtService.sign({
      sub: stradigiUser.id,
      tenantId: null,
      userType: stradigiUser.user_type,
      role: stradigiUser.role,
    });
    res.json({ token, user: publicUser(stradigiUser) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/tenants/:id/impersonation-log', async (req, res) => {
  const log = await impersonationRepo.listForTenant(req.params.id);
  res.json(log);
});

router.get('/impersonation-log', requireStradigiRole('StradigiAdmin'), async (req, res) => {
  const log = await impersonationRepo.listAll();
  res.json(log);
});

// ---------- Stradigi staff management ----------
router.get('/staff', requireStradigiRole('StradigiAdmin'), async (req, res) => {
  const staff = await usersRepo.listStradigiUsers();
  res.json(staff);
});

router.post('/staff', requireStradigiRole('StradigiAdmin'), async (req, res) => {
  try {
    const { email, name, role, password } = req.body;
    if (!email || !password || !['StradigiAdmin', 'StradigiSupport'].includes(role)) {
      return res.status(400).json({ error: 'email, password, and role (StradigiAdmin|StradigiSupport) are required' });
    }
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const passwordHash = await bcrypt.hash(password, 10);
    const staff = await usersRepo.createStradigiUser({ email, passwordHash, name, role });
    res.status(201).json(publicUser(staff));
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'A Stradigi user with that email already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ---------- Cross-tenant support ticket queue (Section 7) ----------
router.get('/tickets', async (req, res) => {
  const tickets = await ticketsRepo.listAllForStradigi();
  res.json(tickets);
});

router.get('/tickets/:id', async (req, res) => {
  const ticket = await ticketsRepo.getByIdCrossTenant(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  const messages = await ticketsRepo.listMessages(ticket.id);
  res.json({ ticket, messages });
});

router.patch('/tickets/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['Open', 'In Progress', 'Resolved'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const updated = await ticketsRepo.setStatus(req.params.id, status);
    if (!updated) return res.status(404).json({ error: 'Ticket not found' });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/tickets/:id/messages', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    const ticket = await ticketsRepo.getByIdCrossTenant(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const msg = await ticketsRepo.addMessage(ticket.id, { senderUserId: req.user.id, senderType: 'stradigi', message });

    await notificationsRepo.notifyUser(
      ticket.tenant_id, ticket.user_id, 'ticket_reply',
      `New reply on your ticket "${ticket.subject}"`, `/app.html#/tickets/${ticket.id}`
    );

    // Section 13: notify the tenant user of the reply — email at minimum,
    // since a missed in-app badge has real consequences for support threads.
    await emailService.sendEmail({
      to: ticket.user_email,
      subject: `New reply on your support ticket: ${ticket.subject}`,
      text: `${req.user.name || req.user.email} replied to your ticket "${ticket.subject}":\n\n${message}\n\nView it in the portal under Support.`,
    });

    res.status(201).json(msg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
