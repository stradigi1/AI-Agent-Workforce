const pool = require('../pool');

async function log(tenantId, userId, action, detail = null) {
  await pool.query(
    `INSERT INTO activity_log (tenant_id, user_id, action, detail) VALUES ($1, $2, $3, $4)`,
    [tenantId, userId, action, detail]
  );
}

async function listByTenant(tenantId, limit = 100) {
  const { rows } = await pool.query(
    `SELECT al.*, u.email AS user_email, u.name AS user_name
     FROM activity_log al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE al.tenant_id = $1
     ORDER BY al.created_at DESC
     LIMIT $2`,
    [tenantId, limit]
  );
  return rows;
}

module.exports = { log, listByTenant };
