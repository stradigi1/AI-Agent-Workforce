const express = require('express');

const tenantsRepo = require('../db/repo/tenants');
const activityRepo = require('../db/repo/activity');
const stripeService = require('../services/stripeService');
const { authRequired } = require('../middleware/auth');
const { requireTenantRole } = require('../middleware/requireRole');

const router = express.Router();

router.use(authRequired, requireTenantRole('Owner', 'Admin'));

router.get('/status', async (req, res) => {
  const tenant = await tenantsRepo.getTenantById(req.tenantId);
  res.json({
    plan: tenant.plan,
    subscriptionStatus: tenant.subscription_status,
    hasStripeCustomer: !!tenant.stripe_customer_id,
    stripeConfigured: stripeService.isConfigured,
  });
});

router.post('/checkout-session', async (req, res) => {
  try {
    const { priceId } = req.body;
    if (!priceId) return res.status(400).json({ error: 'priceId is required' });

    const tenant = await tenantsRepo.getTenantById(req.tenantId);
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const session = await stripeService.createCheckoutSession(
      tenant, req.user.email, priceId,
      `${appUrl}/app.html#/billing?checkout=success`,
      `${appUrl}/app.html#/billing?checkout=cancelled`
    );
    await activityRepo.log(req.tenantId, req.user.id, 'billing_checkout_started', priceId);
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/portal-session', async (req, res) => {
  try {
    const tenant = await tenantsRepo.getTenantById(req.tenantId);
    const appUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const session = await stripeService.createPortalSession(tenant, `${appUrl}/app.html#/billing`);
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
