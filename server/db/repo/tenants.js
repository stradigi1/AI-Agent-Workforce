const pool = require('../pool');

async function createTenant({ name, slug }) {
  const { rows } = await pool.query(
    `INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING *`,
    [name, slug]
  );
  return rows[0];
}

async function getTenantById(tenantId) {
  const { rows } = await pool.query(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
  return rows[0] || null;
}

async function getTenantBySlug(slug) {
  const { rows } = await pool.query(`SELECT * FROM tenants WHERE slug = $1`, [slug]);
  return rows[0] || null;
}

async function slugExists(slug) {
  const { rows } = await pool.query(`SELECT 1 FROM tenants WHERE slug = $1`, [slug]);
  return rows.length > 0;
}

async function listTenants() {
  const { rows } = await pool.query(`SELECT * FROM tenants ORDER BY created_at DESC`);
  return rows;
}

async function updateBranding(tenantId, { name, logoUrl, brandPrimaryColor, brandSecondaryColor }) {
  const { rows } = await pool.query(
    `UPDATE tenants SET
       name = COALESCE($2, name),
       logo_url = COALESCE($3, logo_url),
       brand_primary_color = COALESCE($4, brand_primary_color),
       brand_secondary_color = COALESCE($5, brand_secondary_color),
       updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [tenantId, name, logoUrl, brandPrimaryColor, brandSecondaryColor]
  );
  return rows[0] || null;
}

async function updateUsageCap(tenantId, usageCapMonthlyTokens) {
  const { rows } = await pool.query(
    `UPDATE tenants SET usage_cap_monthly_tokens = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [tenantId, usageCapMonthlyTokens]
  );
  return rows[0] || null;
}

async function updateSpecialistConcurrencyCap(tenantId, cap) {
  const { rows } = await pool.query(
    `UPDATE tenants SET specialist_concurrency_cap = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [tenantId, cap]
  );
  return rows[0] || null;
}

async function setUsageCapWarned(tenantId, warned) {
  await pool.query(
    `UPDATE tenants SET usage_cap_warned_at = $2 WHERE id = $1`,
    [tenantId, warned ? new Date() : null]
  );
}

async function updateStripeCustomer(tenantId, stripeCustomerId) {
  const { rows } = await pool.query(
    `UPDATE tenants SET stripe_customer_id = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [tenantId, stripeCustomerId]
  );
  return rows[0] || null;
}

async function updateSubscription(tenantId, { stripeSubscriptionId, subscriptionStatus, plan }) {
  const { rows } = await pool.query(
    `UPDATE tenants SET
       stripe_subscription_id = COALESCE($2, stripe_subscription_id),
       subscription_status = COALESCE($3, subscription_status),
       plan = COALESCE($4, plan),
       updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [tenantId, stripeSubscriptionId, subscriptionStatus, plan]
  );
  return rows[0] || null;
}

async function getTenantByStripeCustomerId(stripeCustomerId) {
  const { rows } = await pool.query(`SELECT * FROM tenants WHERE stripe_customer_id = $1`, [stripeCustomerId]);
  return rows[0] || null;
}

async function setStatus(tenantId, status) {
  const { rows } = await pool.query(
    `UPDATE tenants SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [tenantId, status]
  );
  return rows[0] || null;
}

module.exports = {
  createTenant,
  getTenantById,
  getTenantBySlug,
  slugExists,
  listTenants,
  updateBranding,
  updateUsageCap,
  updateSpecialistConcurrencyCap,
  setUsageCapWarned,
  updateStripeCustomer,
  updateSubscription,
  getTenantByStripeCustomerId,
  setStatus,
};
