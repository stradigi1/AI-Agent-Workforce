const pool = require('../pool');

async function getOrCreateConversation({ tenantId = null, userId = null, sessionId, mode }) {
  const { rows: existing } = await pool.query(
    `SELECT * FROM chatbot_conversations WHERE session_id = $1`,
    [sessionId]
  );
  if (existing[0]) return existing[0];

  const { rows } = await pool.query(
    `INSERT INTO chatbot_conversations (tenant_id, user_id, session_id, mode) VALUES ($1,$2,$3,$4) RETURNING *`,
    [tenantId, userId, sessionId, mode]
  );
  return rows[0];
}

async function addMessage(conversationId, role, message) {
  const { rows } = await pool.query(
    `INSERT INTO chatbot_messages (conversation_id, role, message) VALUES ($1,$2,$3) RETURNING *`,
    [conversationId, role, message]
  );
  return rows[0];
}

async function getHistory(conversationId, limit = 20) {
  const { rows } = await pool.query(
    `SELECT * FROM chatbot_messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT $2`,
    [conversationId, limit]
  );
  return rows;
}

module.exports = { getOrCreateConversation, addMessage, getHistory };
