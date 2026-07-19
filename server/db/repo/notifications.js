const pool = require('../pool');

// A NULL user_id means "broadcast to every Owner/Admin of the tenant" —
// resolved to individual rows at creation time so per-user read state works.
async function notifyTenantAdmins(tenantId, type, message, link = null) {
  const { rows: admins } = await pool.query(
    `SELECT id FROM users WHERE tenant_id = $1 AND user_type = 'tenant' AND role IN ('Owner','Admin') AND active = TRUE`,
    [tenantId]
  );
  for (const admin of admins) {
    await pool.query(
      `INSERT INTO notifications (tenant_id, user_id, type, message, link) VALUES ($1,$2,$3,$4,$5)`,
      [tenantId, admin.id, type, message, link]
    );
  }
}

async function notifyUser(tenantId, userId, type, message, link = null) {
  const { rows } = await pool.query(
    `INSERT INTO notifications (tenant_id, user_id, type, message, link) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [tenantId, userId, type, message, link]
  );
  return rows[0];
}

async function listForUser(userId, { unreadOnly = false, limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM notifications WHERE user_id = $1 ${unreadOnly ? 'AND read = FALSE' : ''}
     ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return rows;
}

async function markRead(userId, notificationId) {
  await pool.query(`UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2`, [notificationId, userId]);
}

async function markAllRead(userId) {
  await pool.query(`UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE`, [userId]);
}

async function unreadCount(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read = FALSE`,
    [userId]
  );
  return rows[0].count;
}

module.exports = { notifyTenantAdmins, notifyUser, listForUser, markRead, markAllRead, unreadCount };
