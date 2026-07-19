const express = require('express');

const tenantsRepo = require('../db/repo/tenants');
const departmentsRepo = require('../db/repo/departments');
const promptsRepo = require('../db/repo/prompts');
const activityRepo = require('../db/repo/activity');
const { defaultManagerPrompt, defaultSpecialistPrompt } = require('../services/defaultPrompts');
const { authRequired } = require('../middleware/auth');
const { requireTenantUser, requireTenantRole } = require('../middleware/requireRole');

const router = express.Router();

router.use(authRequired, requireTenantUser);

// ---------- Branding (Section 11: white-label) ----------
router.get('/branding', async (req, res) => {
  const tenant = await tenantsRepo.getTenantById(req.tenantId);
  res.json({
    name: tenant.name,
    slug: tenant.slug,
    logoUrl: tenant.logo_url,
    brandPrimaryColor: tenant.brand_primary_color,
    brandSecondaryColor: tenant.brand_secondary_color,
  });
});

router.patch('/branding', requireTenantRole('Owner', 'Admin'), async (req, res) => {
  try {
    const { name, logoUrl, brandPrimaryColor, brandSecondaryColor } = req.body;
    const updated = await tenantsRepo.updateBranding(req.tenantId, { name, logoUrl, brandPrimaryColor, brandSecondaryColor });
    await activityRepo.log(req.tenantId, req.user.id, 'branding_updated', null);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Departments & specialist roles (Section 11: per-tenant config) ----------
router.get('/departments', async (req, res) => {
  const departments = await departmentsRepo.listDepartments(req.tenantId);
  const withRoles = await Promise.all(
    departments.map(async (d) => ({ ...d, specialistRoles: await departmentsRepo.listSpecialistRoles(req.tenantId, d.id) }))
  );
  res.json(withRoles);
});

router.post('/departments', requireTenantRole('Owner', 'Admin'), async (req, res) => {
  try {
    const { key, name } = req.body;
    if (!key || !name) return res.status(400).json({ error: 'key and name are required' });

    const dept = await departmentsRepo.createDepartment(req.tenantId, key.toLowerCase().replace(/[^a-z0-9]+/g, '_'), name);
    // Seed default Manager/Specialist prompts for the new department so agent
    // calls always have something to fall back on immediately.
    await promptsRepo.upsertPrompt(req.tenantId, 'Manager', dept.id, defaultManagerPrompt(name));
    await promptsRepo.upsertPrompt(req.tenantId, 'Specialist', dept.id, defaultSpecialistPrompt(name));

    await activityRepo.log(req.tenantId, req.user.id, 'department_created', name);
    res.status(201).json(dept);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'A department with that key already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/departments/:id', requireTenantRole('Owner', 'Admin'), async (req, res) => {
  try {
    const updated = await departmentsRepo.renameDepartment(req.tenantId, req.params.id, req.body.name);
    if (!updated) return res.status(404).json({ error: 'Department not found' });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/departments/:id/specialist-roles', requireTenantRole('Owner', 'Admin'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const role = await departmentsRepo.createSpecialistRole(req.tenantId, req.params.id, name);
    await activityRepo.log(req.tenantId, req.user.id, 'specialist_role_created', name);
    res.status(201).json(role);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/specialist-roles/:roleId', requireTenantRole('Owner', 'Admin'), async (req, res) => {
  await departmentsRepo.deleteSpecialistRole(req.tenantId, req.params.roleId);
  res.status(204).end();
});

// ---------- Agent prompts (Section 15/17: stored in DB, editable per tenant) ----------
router.get('/prompts', requireTenantRole('Owner', 'Admin'), async (req, res) => {
  const prompts = await promptsRepo.listPrompts(req.tenantId);
  res.json(prompts);
});

router.put('/prompts', requireTenantRole('Owner', 'Admin'), async (req, res) => {
  try {
    const { tier, departmentId, systemPrompt } = req.body;
    if (!tier || !systemPrompt) return res.status(400).json({ error: 'tier and systemPrompt are required' });
    const updated = await promptsRepo.upsertPrompt(req.tenantId, tier, departmentId || null, systemPrompt);
    await activityRepo.log(req.tenantId, req.user.id, 'prompt_updated', `${tier}${departmentId ? ` (dept ${departmentId})` : ''}`);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Usage & concurrency caps (Section 12) ----------
router.patch('/limits', requireTenantRole('Owner', 'Admin'), async (req, res) => {
  try {
    const { usageCapMonthlyTokens, specialistConcurrencyCap } = req.body;
    let tenant;
    if (usageCapMonthlyTokens !== undefined) tenant = await tenantsRepo.updateUsageCap(req.tenantId, usageCapMonthlyTokens);
    if (specialistConcurrencyCap !== undefined) tenant = await tenantsRepo.updateSpecialistConcurrencyCap(req.tenantId, specialistConcurrencyCap);
    await activityRepo.log(req.tenantId, req.user.id, 'limits_updated', null);
    res.json(tenant || (await tenantsRepo.getTenantById(req.tenantId)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
