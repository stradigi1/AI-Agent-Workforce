const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const tenantsRepo = require('../db/repo/tenants');
const usersRepo = require('../db/repo/users');
const legalRepo = require('../db/repo/legal');
const activityRepo = require('../db/repo/activity');
const { seedTenantDefaults } = require('../db/seedTenant');
const jwtService = require('../services/jwt');
const emailService = require('../services/emailService');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// Rate-limit login attempts at the network layer too (Section 14 security
// basics), in addition to the per-account lockout in db/repo/users.js.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function issueToken(user, impersonation = null) {
  return jwtService.sign({
    sub: user.id,
    tenantId: user.tenant_id,
    userType: user.user_type,
    role: user.role,
    impersonation,
  });
}

function publicUser(user) {
  const { password_hash, invite_token, password_reset_token, ...safe } = user;
  return safe;
}

// ---------- Tenant signup ----------
router.post('/signup', async (req, res) => {
  try {
    const { companyName, ownerName, email, password, tosAccepted, privacyAccepted } = req.body;
    if (!companyName || !email || !password) {
      return res.status(400).json({ error: 'companyName, email, and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!tosAccepted || !privacyAccepted) {
      return res.status(400).json({ error: 'You must accept the Terms of Service and Privacy Policy' });
    }

    let slug = slugify(companyName);
    if (!slug) return res.status(400).json({ error: 'Company name must contain letters or numbers' });
    if (await tenantsRepo.slugExists(slug)) {
      slug = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
    }

    const tenant = await tenantsRepo.createTenant({ name: companyName, slug });
    await seedTenantDefaults(tenant.id, tenant.name);

    const passwordHash = await bcrypt.hash(password, 10);
    const owner = await usersRepo.createTenantUser(tenant.id, {
      email,
      passwordHash,
      name: ownerName || companyName,
      role: 'Owner',
      canApprove: true,
    });

    const tos = await legalRepo.getLatestVersion('tos');
    const privacy = await legalRepo.getLatestVersion('privacy');
    if (tos) await legalRepo.recordAcceptance(owner.id, 'tos', tos.version);
    if (privacy) await legalRepo.recordAcceptance(owner.id, 'privacy', privacy.version);

    await activityRepo.log(tenant.id, owner.id, 'tenant_signup', `${companyName} signed up`);

    const token = issueToken(owner);
    res.status(201).json({ token, user: publicUser(owner), tenant });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'That company slug or email is already in use' });
    res.status(500).json({ error: err.message });
  }
});

// ---------- Tenant user login ----------
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { tenantSlug, email, password } = req.body;
    if (!tenantSlug || !email || !password) {
      return res.status(400).json({ error: 'tenantSlug, email, and password are required' });
    }

    const tenant = await tenantsRepo.getTenantBySlug(tenantSlug.toLowerCase());
    if (!tenant) return res.status(401).json({ error: 'Invalid company, email, or password' });
    if (tenant.status === 'suspended') return res.status(403).json({ error: 'This account is suspended' });

    const user = await usersRepo.getTenantUserByEmail(tenant.id, email);
    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid company, email, or password' });
    if (!user.active) return res.status(403).json({ error: 'This user has been deactivated' });
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(403).json({ error: 'Account temporarily locked due to failed login attempts. Try again later.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const result = await usersRepo.registerFailedLogin(user.id);
      if (result.locked) return res.status(403).json({ error: 'Too many failed attempts. Account locked for 15 minutes.' });
      return res.status(401).json({ error: 'Invalid company, email, or password' });
    }

    await usersRepo.clearFailedLogins(user.id);
    await activityRepo.log(tenant.id, user.id, 'login', null);

    const token = issueToken(user);
    res.json({ token, user: publicUser(user), tenant });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Stradigi staff login (separate from tenant auth entirely) ----------
router.post('/stradigi/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

    const user = await usersRepo.getStradigiUserByEmail(email);
    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.active) return res.status(403).json({ error: 'This account has been deactivated' });
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(403).json({ error: 'Account temporarily locked. Try again later.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      const result = await usersRepo.registerFailedLogin(user.id);
      if (result.locked) return res.status(403).json({ error: 'Too many failed attempts. Account locked for 15 minutes.' });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await usersRepo.clearFailedLogins(user.id);
    const token = issueToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Accept invite (sets password for a pre-created invited user) ----------
router.post('/accept-invite', async (req, res) => {
  try {
    const { token, name, password, tosAccepted, privacyAccepted } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'token and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!tosAccepted || !privacyAccepted) {
      return res.status(400).json({ error: 'You must accept the Terms of Service and Privacy Policy' });
    }

    const invited = await usersRepo.getByInviteToken(token);
    if (!invited) return res.status(400).json({ error: 'Invite link is invalid or has expired' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await usersRepo.acceptInvite(invited.id, { passwordHash, name: name || invited.email });

    const tos = await legalRepo.getLatestVersion('tos');
    const privacy = await legalRepo.getLatestVersion('privacy');
    if (tos) await legalRepo.recordAcceptance(user.id, 'tos', tos.version);
    if (privacy) await legalRepo.recordAcceptance(user.id, 'privacy', privacy.version);

    await activityRepo.log(user.tenant_id, user.id, 'invite_accepted', null);

    const tenant = await tenantsRepo.getTenantById(user.tenant_id);
    const jwtToken = issueToken(user);
    res.json({ token: jwtToken, user: publicUser(user), tenant });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Password reset ----------
router.post('/forgot-password', loginLimiter, async (req, res) => {
  try {
    const { tenantSlug, email } = req.body;
    if (!tenantSlug || !email) return res.status(400).json({ error: 'tenantSlug and email are required' });

    const tenant = await tenantsRepo.getTenantBySlug(tenantSlug.toLowerCase());
    const user = tenant ? await usersRepo.getTenantUserByEmail(tenant.id, email) : null;

    // Always respond success-shaped, whether or not the account exists, so
    // this endpoint can't be used to enumerate registered emails.
    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await usersRepo.setPasswordResetToken(user.id, resetToken, expiresAt);
      const resetUrl = `${process.env.APP_URL || ''}/reset-password.html?token=${resetToken}`;
      await emailService.sendEmail({
        to: email,
        subject: 'Reset your password',
        text: `Reset your password: ${resetUrl}\nThis link expires in 1 hour.`,
      });
    }
    res.json({ ok: true, message: 'If that account exists, a reset link has been sent.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'token and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const user = await usersRepo.getByPasswordResetToken(token);
    if (!user) return res.status(400).json({ error: 'Reset link is invalid or has expired' });

    const passwordHash = await bcrypt.hash(password, 10);
    await usersRepo.resetPassword(user.id, passwordHash);
    await activityRepo.log(user.tenant_id, user.id, 'password_reset', null);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Current session ----------
router.get('/me', authRequired, async (req, res) => {
  const tenant = req.tenantId ? await tenantsRepo.getTenantById(req.tenantId) : null;
  res.json({ user: publicUser(req.user), tenant, impersonation: req.impersonation });
});

module.exports = router;
