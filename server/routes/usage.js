const express = require('express');

const usageRepo = require('../db/repo/usage');
const tenantsRepo = require('../db/repo/tenants');
const { authRequired } = require('../middleware/auth');
const { requireTenantRole } = require('../middleware/requireRole');

const router = express.Router();

router.use(authRequired, requireTenantRole('Owner', 'Admin'));

router.get('/summary', async (req, res) => {
  try {
    const tenant = await tenantsRepo.getTenantById(req.tenantId);
    const { totalTokens, totalCost } = await usageRepo.getMonthToDateTokens(req.tenantId);
    res.json({
      monthToDateTokens: totalTokens,
      monthToDateEstimatedCostUsd: totalCost,
      usageCapMonthlyTokens: tenant.usage_cap_monthly_tokens,
      capWarningActive: !!tenant.usage_cap_warned_at,
      specialistConcurrencyCap: tenant.specialist_concurrency_cap,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/daily', async (req, res) => {
  try {
    const days = Number(req.query.days) || 30;
    const series = await usageRepo.getDailySeries(req.tenantId, days);
    res.json(series);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
