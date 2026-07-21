const pool = require('../pool');

async function log(tenantId, proposal) {
  const { rows } = await pool.query(
    `INSERT INTO improvement_log (tenant_id, proposal) VALUES ($1, $2) RETURNING *`,
    [tenantId, proposal]
  );
  return rows[0];
}

async function listByTenant(tenantId, limit = 50) {
  const { rows } = await pool.query(
    `SELECT * FROM improvement_log WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [tenantId, limit]
  );
  return rows;
}

async function getById(tenantId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM improvement_log WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return rows[0] || null;
}

async function markConverted(tenantId, id, taskId) {
  const { rows } = await pool.query(
    `UPDATE improvement_log SET converted_task_id = $3 WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, id, taskId]
  );
  return rows[0] || null;
}

module.exports = { log, listByTenant, getById, markConverted };
