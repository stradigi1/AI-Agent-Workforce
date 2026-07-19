const express = require('express');
const crypto = require('crypto');

const usersRepo = require('../db/repo/users');
const activityRepo = require('../db/repo/activity');
const emailService = require('../services/emailService');
const { authRequired } = require('../middleware/auth');
const { requireTenantRole } = require('../middleware/requireRole');

const router = express.Router();

const TENANT_ROLES = ['Owner', 'Admin', 'Member'];

router.use(authRequired);

router.get('/', requireTenantRole('Owner', 'Admin'), async (req, res) => {
  const users = await usersRepo.listUsersByTenant(req.tenantId);
  res.json(users);
});

router.post('/invite', requireTenantRole('Owner', 'Admin'), async (req, res) => {
  try {
    const { email, role, canApprove } = req.body;
    if (!email || !TENANT_ROLES.includes(role)) {
      return res.status(400).json({ error: `email and role (one of ${TENANT_ROLES.join(', ')}) are required` });
    }
    if (role === 'Owner') return res.status(400).json({ error: 'Ownership must be transferred, not invited — contact support' });

    const existing = await usersRepo.getTenantUserByEmail(req.tenantId, email);
    if (existing) return res.status(409).json({ error: 'A user with that email already exists on this account' });

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invited = await usersRepo.createInvite(req.tenantId, {
      email,
      role,
      canApprove: role === 'Admin' ? !!canApprove : false,
      inviteToken,
      expiresAt,
    });

    const inviteUrl = `${process.env.APP_URL || ''}/accept-invite.html?token=${inviteToken}`;
    await emailService.sendEmail({
      to: email,
      subject: `You've been invited to join ${req.tenant.name} on the AI Workforce Portal`,
      text: `${req.user.name || req.user.email} invited you to join ${req.tenant.name}.\nAccept your invite: ${inviteUrl}\nThis link expires in 7 days.`,
    });

    await activityRepo.log(req.tenantId, req.user.id, 'user_invited', `Invited ${email} as ${role}`);
    res.status(201).json(invited);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/role', requireTenantRole('Owner', 'Admin'), async (req, res) => {
  try {
    const { role, canApprove } = req.body;
    if (role && !TENANT_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (role === 'Owner') return res.status(400).json({ error: 'Ownership must be transferred via support, not this endpoint' });
    if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: "You can't change your own role" });

    const updated = await usersRepo.updateRole(req.tenantId, req.params.id, { role, canApprove });
    if (!updated) return res.status(404).json({ error: 'User not found' });

    await activityRepo.log(req.tenantId, req.user.id, 'user_role_changed', `User ${req.params.id} -> ${role || '(unchanged)'}`);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/active', requireTenantRole('Owner', 'Admin'), async (req, res) => {
  try {
    const { active } = req.body;
    if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: "You can't deactivate yourself" });

    const updated = await usersRepo.setActive(req.tenantId, req.params.id, !!active);
    if (!updated) return res.status(404).json({ error: 'User not found' });

    await activityRepo.log(req.tenantId, req.user.id, active ? 'user_reactivated' : 'user_deactivated', `User ${req.params.id}`);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/activity-log', requireTenantRole('Owner', 'Admin'), async (req, res) => {
  const log = await activityRepo.listByTenant(req.tenantId);
  res.json(log);
});

module.exports = router;
