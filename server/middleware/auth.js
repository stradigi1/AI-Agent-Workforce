const jwtService = require('../services/jwt');
const usersRepo = require('../db/repo/users');
const tenantsRepo = require('../db/repo/tenants');

// Verifies the bearer token, reloads the user fresh from the DB (so a
// deactivated user or locked account is rejected immediately rather than
// riding out the token's 12h lifetime), and attaches:
//   req.user          — the acting user row (if impersonating, this IS the
//                        impersonated tenant user, matching "entering the
//                        portal exactly as that user would see it")
//   req.tenantId      — convenience accessor, null for Stradigi staff
//   req.impersonation — { sessionId, stradigiUserId, stradigiEmail } when active, else null
async function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    let payload;
    try {
      payload = jwtService.verify(token);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const user = await usersRepo.getUserById(payload.sub);
    if (!user || !user.active) return res.status(401).json({ error: 'Account not found or deactivated' });

    if (user.tenant_id) {
      const tenant = await tenantsRepo.getTenantById(user.tenant_id);
      if (!tenant || tenant.status === 'suspended') {
        return res.status(403).json({ error: 'Tenant account is suspended' });
      }
      req.tenant = tenant;
    }

    req.user = user;
    req.tenantId = user.tenant_id;
    req.impersonation = payload.impersonation || null;
    next();
  } catch (err) {
    console.error('[auth] unexpected error', err);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

// For routes that work anonymously (e.g. the public sales chatbot) but
// personalize when a valid session is present. Unlike authRequired, any
// failure (missing/invalid/expired token, deactivated user, suspended
// tenant) falls back to anonymous rather than rejecting the request.
async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next();

    const payload = jwtService.verify(token);
    const user = await usersRepo.getUserById(payload.sub);
    if (!user || !user.active) return next();

    if (user.tenant_id) {
      const tenant = await tenantsRepo.getTenantById(user.tenant_id);
      if (!tenant || tenant.status === 'suspended') return next();
      req.tenant = tenant;
    }

    req.user = user;
    req.tenantId = user.tenant_id;
    req.impersonation = payload.impersonation || null;
    next();
  } catch {
    next();
  }
}

module.exports = { authRequired, optionalAuth };
