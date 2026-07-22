const pool = require('../pool');

const OPEN_STATUSES = ['DOO', 'Manager', 'Specialist', 'Manager_Review', 'DOO_Review', 'Approval_Queue'];

async function listByTenant(tenantId) {
  const { rows } = await pool.query(
    `SELECT t.*, d.name AS department_name
     FROM tasks t
     LEFT JOIN departments d ON d.id = t.department_id
     WHERE t.tenant_id = $1
     ORDER BY t.root_id NULLS FIRST, t.tier, t.created_at ASC`,
    [tenantId]
  );
  return rows;
}

async function getById(tenantId, taskId) {
  const { rows } = await pool.query(
    `SELECT t.*, d.name AS department_name
     FROM tasks t
     LEFT JOIN departments d ON d.id = t.department_id
     WHERE t.tenant_id = $1 AND t.id = $2`,
    [tenantId, taskId]
  );
  return rows[0] || null;
}

// Used internally by the orchestrator, which already trusts the tenantId it
// carries from the triggering request — still always scoped.
async function getByIdUnsafe(taskId) {
  const { rows } = await pool.query(`SELECT * FROM tasks WHERE id = $1`, [taskId]);
  return rows[0] || null;
}

async function getChildren(tenantId, parentId) {
  const { rows } = await pool.query(
    `SELECT * FROM tasks WHERE tenant_id = $1 AND parent_id = $2 ORDER BY created_at ASC`,
    [tenantId, parentId]
  );
  return rows;
}

async function getSiblingSpecialists(tenantId, managerTaskId) {
  return getChildren(tenantId, managerTaskId);
}

async function create(tenantId, {
  parentId = null,
  rootId = null,
  tier,
  departmentId = null,
  agentRole = null,
  taskName,
  objective = null,
  directive = null,
  spec = null,
  priority = 'Medium',
  status,
  createdByUserId = null,
}) {
  const { rows } = await pool.query(
    `INSERT INTO tasks
       (tenant_id, parent_id, root_id, tier, department_id, agent_role, task_name, objective,
        directive, spec, priority, status, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [tenantId, parentId, rootId, tier, departmentId, agentRole, taskName, objective,
      directive, spec, priority, status, createdByUserId]
  );
  const task = rows[0];

  if (rootId === null) {
    const { rows: updated } = await pool.query(
      `UPDATE tasks SET root_id = $2 WHERE id = $1 RETURNING *`,
      [task.id, task.id]
    );
    return updated[0];
  }
  return task;
}

const UPDATABLE_FIELDS = [
  'task_name', 'objective', 'directive', 'spec', 'department_id', 'agent_role', 'priority',
  'status', 'output', 'revision_round', 'revision_history', 'stuck_notes', 'error_detail',
  'doo_validation_notes', 'denial_reason', 'approved_by_user_id', 'approved_at',
];

async function update(tenantId, taskId, fields) {
  const keys = Object.keys(fields).filter((k) => UPDATABLE_FIELDS.includes(k));
  if (keys.length === 0) return getById(tenantId, taskId);

  const setClause = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  const values = keys.map((k) => fields[k]);

  const { rows } = await pool.query(
    `UPDATE tasks SET ${setClause}, updated_at = NOW() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, taskId, ...values]
  );
  return rows[0] || null;
}

// Same as update() but without a tenant filter, for use inside the
// orchestrator where the tenantId was already validated on entry and the
// call chain works task-id-first (child tasks looked up by id, not tenant).
async function updateUnsafe(taskId, fields) {
  const keys = Object.keys(fields).filter((k) => UPDATABLE_FIELDS.includes(k));
  if (keys.length === 0) return getByIdUnsafe(taskId);

  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => fields[k]);

  const { rows } = await pool.query(
    `UPDATE tasks SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [taskId, ...values]
  );
  return rows[0] || null;
}

async function deleteTask(tenantId, taskId) {
  await pool.query(`DELETE FROM tasks WHERE tenant_id = $1 AND id = $2`, [tenantId, taskId]);
}

async function getOpenCount(tenantId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM tasks WHERE tenant_id = $1 AND status = ANY($2::text[])`,
    [tenantId, OPEN_STATUSES]
  );
  return rows[0].count;
}

async function listApprovalQueue(tenantId) {
  const { rows } = await pool.query(
    `SELECT t.*, d.name AS department_name
     FROM tasks t LEFT JOIN departments d ON d.id = t.department_id
     WHERE t.tenant_id = $1 AND t.status = 'Approval_Queue' AND t.parent_id IS NULL
     ORDER BY t.updated_at ASC`,
    [tenantId]
  );
  return rows;
}

// Cross-tenant on purpose — this backs the background sweep (staleTaskSweeper.js)
// that looks for directives silently orphaned by a server restart mid-chain.
// Deliberately scoped to the "active processing" statuses only, never
// Stuck/Error — those already carry a specific reason a human should look
// at before anything retries them automatically.
const ACTIVE_PROCESSING_STATUSES = ['DOO', 'Manager', 'Specialist', 'DOO_Review'];

async function listStaleActiveRootTasks(staleMinutes) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, task_name, status, updated_at FROM tasks
     WHERE parent_id IS NULL AND status = ANY($1::text[])
       AND updated_at < NOW() - ($2 || ' minutes')::interval`,
    [ACTIVE_PROCESSING_STATUSES, staleMinutes]
  );
  return rows;
}

module.exports = {
  OPEN_STATUSES,
  listByTenant,
  getById,
  getByIdUnsafe,
  getChildren,
  getSiblingSpecialists,
  create,
  update,
  updateUnsafe,
  deleteTask,
  getOpenCount,
  listApprovalQueue,
  listStaleActiveRootTasks,
};
