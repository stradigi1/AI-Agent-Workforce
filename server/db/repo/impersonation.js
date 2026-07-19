const pool = require('../pool');

async function startSession(stradigiUserId, tenantId, targetUserId) {
  const { rows } = await pool.query(
    `INSERT INTO impersonation_log (stradigi_user_id, tenant_id, target_user_id) VALUES ($1, $2, $3) RETURNING *`,
    [stradigiUserId, tenantId, targetUserId]
  );
  return rows[0];
}

async function endSession(sessionId) {
  const { rows } = await pool.query(
    `UPDATE impersonation_log SET ended_at = NOW() WHERE id = $1 AND ended_at IS NULL RETURNING *`,
    [sessionId]
  );
  return rows[0] || null;
}

async function getSession(sessionId) {
  const { rows } = await pool.query(`SELECT * FROM impersonation_log WHERE id = $1`, [sessionId]);
  return rows[0] || null;
}

async function listForTenant(tenantId, limit = 100) {
  const { rows } = await pool.query(
    `SELECT il.*, su.email AS stradigi_email, su.name AS stradigi_name, tu.email AS target_email
     FROM impersonation_log il
     JOIN users su ON su.id = il.stradigi_user_id
     JOIN users tu ON tu.id = il.target_user_id
     WHERE il.tenant_id = $1
     ORDER BY il.started_at DESC
     LIMIT $2`,
    [tenantId, limit]
  );
  return rows;
}

async function listAll(limit = 200) {
  const { rows } = await pool.query(
    `SELECT il.*, su.email AS stradigi_email, tu.email AS target_email, t.name AS tenant_name
     FROM impersonation_log il
     JOIN users su ON su.id = il.stradigi_user_id
     JOIN users tu ON tu.id = il.target_user_id
     JOIN tenants t ON t.id = il.tenant_id
     ORDER BY il.started_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

module.exports = { startSession, endSession, getSession, listForTenant, listAll };
