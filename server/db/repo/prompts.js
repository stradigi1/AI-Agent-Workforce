const pool = require('../pool');

// tier: 'DOO' | 'Manager' | 'Specialist' | 'Chatbot'. departmentId is NULL for
// DOO/Chatbot rows (tenant-wide), required for Manager/Specialist rows.
async function getPrompt(tenantId, tier, departmentId = null) {
  const { rows } = await pool.query(
    `SELECT * FROM agent_prompts WHERE tenant_id = $1 AND tier = $2 AND department_id IS NOT DISTINCT FROM $3`,
    [tenantId, tier, departmentId]
  );
  return rows[0] || null;
}

async function upsertPrompt(tenantId, tier, departmentId, systemPrompt) {
  const { rows } = await pool.query(
    `INSERT INTO agent_prompts (tenant_id, tier, department_id, system_prompt)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, tier, (COALESCE(department_id, -1)))
     DO UPDATE SET system_prompt = EXCLUDED.system_prompt, updated_at = NOW()
     RETURNING *`,
    [tenantId, tier, departmentId, systemPrompt]
  );
  return rows[0];
}

async function listPrompts(tenantId) {
  const { rows } = await pool.query(
    `SELECT ap.*, d.name AS department_name
     FROM agent_prompts ap
     LEFT JOIN departments d ON d.id = ap.department_id
     WHERE ap.tenant_id = $1
     ORDER BY ap.tier, d.name NULLS FIRST`,
    [tenantId]
  );
  return rows;
}

module.exports = { getPrompt, upsertPrompt, listPrompts };
