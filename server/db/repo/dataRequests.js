const pool = require('../pool');

async function create(tenantId, requestedByUserId, type) {
  const { rows } = await pool.query(
    `INSERT INTO data_requests (tenant_id, requested_by_user_id, type) VALUES ($1,$2,$3) RETURNING *`,
    [tenantId, requestedByUserId, type]
  );
  return rows[0];
}

async function listByTenant(tenantId) {
  const { rows } = await pool.query(
    `SELECT * FROM data_requests WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId]
  );
  return rows;
}

async function markCompleted(id, fileUrl = null) {
  const { rows } = await pool.query(
    `UPDATE data_requests SET status = 'Completed', file_url = $2, completed_at = NOW() WHERE id = $1 RETURNING *`,
    [id, fileUrl]
  );
  return rows[0] || null;
}

module.exports = { create, listByTenant, markCompleted };
