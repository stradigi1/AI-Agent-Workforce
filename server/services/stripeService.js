const Stripe = require('stripe');

const tenantsRepo = require('../db/repo/tenants');
const notificationsRepo = require('../db/repo/notifications');
const emailService = require('./emailService');

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

function requireStripe() {
  if (!stripe) throw new Error('Stripe is not configured — set STRIPE_SECRET_KEY');
  return stripe;
}

// Section 8: "Use Stripe's hosted/embedded components rather than building
// custom card-collection UI" — everything here only ever creates a Stripe
// Checkout/Portal session URL; raw card data never touches this server.
async function getOrCreateCustomer(tenant, ownerEmail) {
  const s = requireStripe();
  if (tenant.stripe_customer_id) return tenant.stripe_customer_id;

  const customer = await s.customers.create({
    email: ownerEmail,
    name: tenant.name,
    metadata: { tenantId: String(tenant.id), tenantSlug: tenant.slug },
  });
  await tenantsRepo.updateStripeCustomer(tenant.id, customer.id);
  return customer.id;
}

async function createCheckoutSession(tenant, ownerEmail, priceId, successUrl, cancelUrl) {
  const s = requireStripe();
  const customerId = await getOrCreateCustomer(tenant, ownerEmail);

  return s.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { tenantId: String(tenant.id) },
  });
}

async function createPortalSession(tenant, returnUrl) {
  const s = requireStripe();
  if (!tenant.stripe_customer_id) throw new Error('This tenant has no Stripe customer yet — start a checkout session first');
  return s.billingPortal.sessions.create({ customer: tenant.stripe_customer_id, return_url: returnUrl });
}

function constructWebhookEvent(rawBody, signature) {
  const s = requireStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  return s.webhooks.constructEvent(rawBody, signature, secret);
}

async function handleWebhookEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const tenantId = session.metadata?.tenantId;
      if (!tenantId) break;
      await tenantsRepo.updateSubscription(tenantId, {
        stripeSubscriptionId: session.subscription,
        subscriptionStatus: 'active',
      });
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.created': {
      const sub = event.data.object;
      const tenant = await tenantsRepo.getTenantByStripeCustomerId(sub.customer);
      if (!tenant) break;
      await tenantsRepo.updateSubscription(tenant.id, {
        stripeSubscriptionId: sub.id,
        subscriptionStatus: sub.status,
        plan: sub.items?.data?.[0]?.price?.nickname || undefined,
      });
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const tenant = await tenantsRepo.getTenantByStripeCustomerId(sub.customer);
      if (!tenant) break;
      await tenantsRepo.updateSubscription(tenant.id, { subscriptionStatus: 'canceled' });
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const tenant = await tenantsRepo.getTenantByStripeCustomerId(invoice.customer);
      if (!tenant) break;
      await tenantsRepo.updateSubscription(tenant.id, { subscriptionStatus: 'past_due' });
      await notificationsRepo.notifyTenantAdmins(
        tenant.id, 'billing_failed',
        'A payment on your subscription failed. Please update your payment method to avoid service interruption.',
        '/app.html#/billing'
      );
      if (invoice.customer_email) {
        await emailService.sendEmail({
          to: invoice.customer_email,
          subject: 'Payment failed — action needed',
          text: `A recent payment for ${tenant.name}'s subscription failed. Please update your payment method in the billing section of the portal to avoid service interruption.`,
        });
      }
      break;
    }
    default:
      break;
  }
}

module.exports = { createCheckoutSession, createPortalSession, constructWebhookEvent, handleWebhookEvent, isConfigured: !!stripe };
