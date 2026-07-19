const pool = require('../pool');

async function listDepartments(tenantId) {
  const { rows } = await pool.query(
    `SELECT * FROM departments WHERE tenant_id = $1 ORDER BY name ASC`,
    [tenantId]
  );
  return rows;
}

async function getDepartment(tenantId, departmentId) {
  const { rows } = await pool.query(
    `SELECT * FROM departments WHERE tenant_id = $1 AND id = $2`,
    [tenantId, departmentId]
  );
  return rows[0] || null;
}

async function getDepartmentByKey(tenantId, key) {
  const { rows } = await pool.query(
    `SELECT * FROM departments WHERE tenant_id = $1 AND key = $2`,
    [tenantId, key]
  );
  return rows[0] || null;
}

async function createDepartment(tenantId, key, name) {
  const { rows } = await pool.query(
    `INSERT INTO departments (tenant_id, key, name) VALUES ($1, $2, $3) RETURNING *`,
    [tenantId, key, name]
  );
  return rows[0];
}

async function renameDepartment(tenantId, departmentId, name) {
  const { rows } = await pool.query(
    `UPDATE departments SET name = $3 WHERE tenant_id = $1 AND id = $2 RETURNING *`,
    [tenantId, departmentId, name]
  );
  return rows[0] || null;
}

async function listSpecialistRoles(tenantId, departmentId) {
  const { rows } = await pool.query(
    `SELECT * FROM specialist_roles WHERE tenant_id = $1 AND department_id = $2 ORDER BY name ASC`,
    [tenantId, departmentId]
  );
  return rows;
}

async function listAllSpecialistRoles(tenantId) {
  const { rows } = await pool.query(
    `SELECT sr.*, d.name AS department_name, d.key AS department_key
     FROM specialist_roles sr
     JOIN departments d ON d.id = sr.department_id
     WHERE sr.tenant_id = $1 ORDER BY d.name, sr.name`,
    [tenantId]
  );
  return rows;
}

async function createSpecialistRole(tenantId, departmentId, name) {
  const { rows } = await pool.query(
    `INSERT INTO specialist_roles (tenant_id, department_id, name) VALUES ($1, $2, $3) RETURNING *`,
    [tenantId, departmentId, name]
  );
  return rows[0];
}

async function deleteSpecialistRole(tenantId, roleId) {
  await pool.query(`DELETE FROM specialist_roles WHERE tenant_id = $1 AND id = $2`, [tenantId, roleId]);
}

module.exports = {
  listDepartments,
  getDepartment,
  getDepartmentByKey,
  createDepartment,
  renameDepartment,
  listSpecialistRoles,
  listAllSpecialistRoles,
  createSpecialistRole,
  deleteSpecialistRole,
};
