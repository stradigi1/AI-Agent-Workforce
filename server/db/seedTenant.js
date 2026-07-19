const departmentsRepo = require('./repo/departments');
const promptsRepo = require('./repo/prompts');
const {
  DEFAULT_DEPARTMENTS,
  DEFAULT_SPECIALISTS,
  defaultDooPrompt,
  defaultManagerPrompt,
  defaultSpecialistPrompt,
  defaultChatbotPrompt,
} = require('../services/defaultPrompts');

// Seeds the default six departments, MVP specialist roster, and default
// agent prompts for a brand-new tenant. Called once at signup. Everything
// this writes is per-tenant and editable afterward — this is only the
// starting configuration.
async function seedTenantDefaults(tenantId, tenantName) {
  const departmentNames = DEFAULT_DEPARTMENTS.map((d) => d.name);
  const createdDepartments = {};

  for (const dept of DEFAULT_DEPARTMENTS) {
    const row = await departmentsRepo.createDepartment(tenantId, dept.key, dept.name);
    createdDepartments[dept.key] = row;

    const specialistNames = DEFAULT_SPECIALISTS[dept.key] || [];
    for (const specName of specialistNames) {
      await departmentsRepo.createSpecialistRole(tenantId, row.id, specName);
    }

    await promptsRepo.upsertPrompt(tenantId, 'Manager', row.id, defaultManagerPrompt(dept.name));
    await promptsRepo.upsertPrompt(tenantId, 'Specialist', row.id, defaultSpecialistPrompt(dept.name));
  }

  await promptsRepo.upsertPrompt(tenantId, 'DOO', null, defaultDooPrompt(departmentNames));
  await promptsRepo.upsertPrompt(tenantId, 'Chatbot', null, defaultChatbotPrompt(tenantName));

  return createdDepartments;
}

module.exports = { seedTenantDefaults };
