const pool = require('../pool');

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

async function createTenantUser(tenantId, { email, passwordHash, name, role, canApprove = false }) {
  const { rows } = await pool.query(
    `INSERT INTO users (tenant_id, user_type, email, password_hash, name, role, can_approve)
     VALUES ($1, 'tenant', $2, $3, $4, $5, $6) RETURNING *`,
    [tenantId, email.toLowerCase(), passwordHash, name, role, canApprove]
  );
  return rows[0];
}

async function createStradigiUser({ email, passwordHash, name, role }) {
  const { rows } = await pool.query(
    `INSERT INTO users (tenant_id, user_type, email, password_hash, name, role)
     VALUES (NULL, 'stradigi', $1, $2, $3, $4) RETURNING *`,
    [email.toLowerCase(), passwordHash, name, role]
  );
  return rows[0];
}

async function getUserById(userId) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
  return rows[0] || null;
}

async function getTenantUserByEmail(tenantId, email) {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE tenant_id = $1 AND email = $2 AND user_type = 'tenant'`,
    [tenantId, email.toLowerCase()]
  );
  return rows[0] || null;
}

// Tenant users log in with email + which tenant (via subdomain/slug in MVP,
// selected at the login form) OR we can look up across all tenants sharing
// that email — but two different tenants may reuse the same email address,
// so login must be scoped by the tenant the user selects/enters.
async function getStradigiUserByEmail(email) {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE email = $1 AND user_type = 'stradigi'`,
    [email.toLowerCase()]
  );
  return rows[0] || null;
}

async function listUsersByTenant(tenantId) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, user_type, email, name, role, active, can_approve, created_at
     FROM users WHERE tenant_id = $1 ORDER BY created_at ASC`,
    [tenantId]
  );
  return rows;
}

async function listStradigiUsers() {
  const { rows } = await pool.query(
    `SELECT id, email, name, role, active, created_at FROM users WHERE user_type = 'stradigi' ORDER BY created_at ASC`
  );
  return rows;
}

async function createInvite(tenantId, { email, role, canApprove, inviteToken, expiresAt }) {
  const { rows } = await pool.query(
    `INSERT INTO users (tenant_id, user_type, email, name, role, can_approve, active, invite_token, invite_expires_at)
     VALUES ($1, 'tenant', $2, NULL, $3, $4, FALSE, $5, $6) RETURNING *`,
    [tenantId, email.toLowerCase(), role, canApprove, inviteToken, expiresAt]
  );
  return rows[0];
}

async function getByInviteToken(token) {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE invite_token = $1 AND invite_expires_at > NOW()`,
    [token]
  );
  return rows[0] || null;
}

async function acceptInvite(userId, { passwordHash, name }) {
  const { rows } = await pool.query(
    `UPDATE users SET password_hash = $2, name = $3, active = TRUE, invite_token = NULL, invite_expires_at = NULL, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [userId, passwordHash, name]
  );
  return rows[0];
}

async function updateRole(tenantId, userId, { role, canApprove }) {
  const { rows } = await pool.query(
    `UPDATE users SET role = COALESCE($3, role), can_approve = COALESCE($4, can_approve), updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, userId, role, canApprove]
  );
  return rows[0] || null;
}

async function setActive(tenantId, userId, active) {
  const { rows } = await pool.query(
    `UPDATE users SET active = $3, updated_at = NOW() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, userId, active]
  );
  return rows[0] || null;
}

async function setPasswordResetToken(userId, token, expiresAt) {
  await pool.query(
    `UPDATE users SET password_reset_token = $2, password_reset_expires_at = $3 WHERE id = $1`,
    [userId, token, expiresAt]
  );
}

async function getByPasswordResetToken(token) {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE password_reset_token = $1 AND password_reset_expires_at > NOW()`,
    [token]
  );
  return rows[0] || null;
}

async function resetPassword(userId, passwordHash) {
  await pool.query(
    `UPDATE users SET password_hash = $2, password_reset_token = NULL, password_reset_expires_at = NULL,
       failed_login_attempts = 0, locked_until = NULL, updated_at = NOW()
     WHERE id = $1`,
    [userId, passwordHash]
  );
}

// Rate-limiting on login attempts (Section 14 security basics).
async function registerFailedLogin(userId) {
  const { rows } = await pool.query(
    `UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE id = $1 RETURNING failed_login_attempts`,
    [userId]
  );
  const attempts = rows[0]?.failed_login_attempts || 0;
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
    await pool.query(`UPDATE users SET locked_until = $2 WHERE id = $1`, [userId, lockedUntil]);
    return { locked: true, lockedUntil };
  }
  return { locked: false };
}

async function clearFailedLogins(userId) {
  await pool.query(`UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`, [userId]);
}

module.exports = {
  createTenantUser,
  createStradigiUser,
  getUserById,
  getTenantUserByEmail,
  getStradigiUserByEmail,
  listUsersByTenant,
  listStradigiUsers,
  createInvite,
  getByInviteToken,
  acceptInvite,
  updateRole,
  setActive,
  setPasswordResetToken,
  getByPasswordResetToken,
  resetPassword,
  registerFailedLogin,
  clearFailedLogins,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MINUTES,
};
