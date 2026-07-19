const pool = require('../pool');

async function record(tenantId, { taskId = null, tier, model, inputTokens, outputTokens, estimatedCostUsd }) {
  const { rows } = await pool.query(
    `INSERT INTO usage_log (tenant_id, task_id, tier, model, input_tokens, output_tokens, estimated_cost_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [tenantId, taskId, tier, model, inputTokens, outputTokens, estimatedCostUsd]
  );
  return rows[0];
}

async function getMonthToDateTokens(tenantId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS total_tokens,
            COALESCE(SUM(estimated_cost_usd), 0)::numeric AS total_cost
     FROM usage_log
     WHERE tenant_id = $1 AND created_at >= date_trunc('month', NOW())`,
    [tenantId]
  );
  return { totalTokens: Number(rows[0].total_tokens), totalCost: Number(rows[0].total_cost) };
}

async function getSummaryByTask(tenantId, taskId) {
  const { rows } = await pool.query(
    `SELECT * FROM usage_log WHERE tenant_id = $1 AND task_id = $2 ORDER BY created_at ASC`,
    [tenantId, taskId]
  );
  return rows;
}

async function getDailySeries(tenantId, days = 30) {
  const { rows } = await pool.query(
    `SELECT date_trunc('day', created_at) AS day,
            SUM(input_tokens + output_tokens)::bigint AS tokens,
            SUM(estimated_cost_usd)::numeric AS cost
     FROM usage_log
     WHERE tenant_id = $1 AND created_at >= NOW() - ($2 || ' days')::interval
     GROUP BY 1 ORDER BY 1 ASC`,
    [tenantId, days]
  );
  return rows;
}

module.exports = { record, getMonthToDateTokens, getSummaryByTask, getDailySeries };
