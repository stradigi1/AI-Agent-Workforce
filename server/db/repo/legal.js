const pool = require('../pool');

async function getLatestVersion(docType) {
  const { rows } = await pool.query(
    `SELECT * FROM legal_doc_versions WHERE doc_type = $1 ORDER BY effective_at DESC LIMIT 1`,
    [docType]
  );
  return rows[0] || null;
}

async function createVersion(docType, version, content) {
  const { rows } = await pool.query(
    `INSERT INTO legal_doc_versions (doc_type, version, content) VALUES ($1,$2,$3)
     ON CONFLICT (doc_type, version) DO UPDATE SET content = EXCLUDED.content
     RETURNING *`,
    [docType, version, content]
  );
  return rows[0];
}

async function recordAcceptance(userId, docType, version) {
  const { rows } = await pool.query(
    `INSERT INTO legal_acceptances (user_id, doc_type, version) VALUES ($1,$2,$3) RETURNING *`,
    [userId, docType, version]
  );
  return rows[0];
}

async function hasAccepted(userId, docType, version) {
  const { rows } = await pool.query(
    `SELECT 1 FROM legal_acceptances WHERE user_id = $1 AND doc_type = $2 AND version = $3`,
    [userId, docType, version]
  );
  return rows.length > 0;
}

async function getAcceptanceHistory(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM legal_acceptances WHERE user_id = $1 ORDER BY accepted_at DESC`,
    [userId]
  );
  return rows;
}

module.exports = { getLatestVersion, createVersion, recordAcceptance, hasAccepted, getAcceptanceHistory };
