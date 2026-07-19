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

module.exports = { log, listByTenant };
