const pool = require('../pool');

async function create(tenantId, userId, { subject, description, category, severity }) {
  const { rows } = await pool.query(
    `INSERT INTO support_tickets (tenant_id, user_id, subject, description, category, severity)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [tenantId, userId, subject, description, category || 'general', severity || 'normal']
  );
  return rows[0];
}

async function listByTenant(tenantId) {
  const { rows } = await pool.query(
    `SELECT tk.*, u.email AS user_email, u.name AS user_name
     FROM support_tickets tk JOIN users u ON u.id = tk.user_id
     WHERE tk.tenant_id = $1 ORDER BY tk.created_at DESC`,
    [tenantId]
  );
  return rows;
}

async function listByUser(tenantId, userId) {
  const { rows } = await pool.query(
    `SELECT * FROM support_tickets WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC`,
    [tenantId, userId]
  );
  return rows;
}

async function listAllForStradigi() {
  const { rows } = await pool.query(
    `SELECT tk.*, u.email AS user_email, u.name AS user_name, t.name AS tenant_name
     FROM support_tickets tk
     JOIN users u ON u.id = tk.user_id
     JOIN tenants t ON t.id = tk.tenant_id
     ORDER BY tk.status ASC, tk.created_at DESC`
  );
  return rows;
}

async function getById(tenantId, ticketId) {
  const { rows } = await pool.query(
    `SELECT tk.*, u.email AS user_email, u.name AS user_name
     FROM support_tickets tk JOIN users u ON u.id = tk.user_id
     WHERE tk.tenant_id = $1 AND tk.id = $2`,
    [tenantId, ticketId]
  );
  return rows[0] || null;
}

// For Stradigi staff, who can view any tenant's ticket.
async function getByIdCrossTenant(ticketId) {
  const { rows } = await pool.query(
    `SELECT tk.*, u.email AS user_email, u.name AS user_name, t.name AS tenant_name
     FROM support_tickets tk
     JOIN users u ON u.id = tk.user_id
     JOIN tenants t ON t.id = tk.tenant_id
     WHERE tk.id = $1`,
    [ticketId]
  );
  return rows[0] || null;
}

async function setStatus(ticketId, status) {
  const { rows } = await pool.query(
    `UPDATE support_tickets SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [ticketId, status]
  );
  return rows[0] || null;
}

async function addMessage(ticketId, { senderUserId, senderType, message }) {
  const { rows } = await pool.query(
    `INSERT INTO support_ticket_messages (ticket_id, sender_user_id, sender_type, message)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [ticketId, senderUserId, senderType, message]
  );
  await pool.query(`UPDATE support_tickets SET updated_at = NOW() WHERE id = $1`, [ticketId]);
  return rows[0];
}

async function listMessages(ticketId) {
  const { rows } = await pool.query(
    `SELECT stm.*, u.email AS sender_email, u.name AS sender_name
     FROM support_ticket_messages stm
     LEFT JOIN users u ON u.id = stm.sender_user_id
     WHERE stm.ticket_id = $1 ORDER BY stm.created_at ASC`,
    [ticketId]
  );
  return rows;
}

module.exports = {
  create,
  listByTenant,
  listByUser,
  listAllForStradigi,
  getById,
  getByIdCrossTenant,
  setStatus,
  addMessage,
  listMessages,
};
