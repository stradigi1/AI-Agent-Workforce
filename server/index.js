require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const stripeService = require('./services/stripeService');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const taskRoutes = require('./routes/tasks');
const approvalRoutes = require('./routes/approvals');
const tenantRoutes = require('./routes/tenants');
const usageRoutes = require('./routes/usage');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const ticketRoutes = require('./routes/tickets');
const billingRoutes = require('./routes/billing');
const chatbotRoutes = require('./routes/chatbot');
const legalRoutes = require('./routes/legal');

const app = express();
app.set('trust proxy', 1); // Replit (and most PaaS hosts) sit behind a proxy — needed for req.protocol/req.secure to reflect https, and for express-rate-limit to key on the real client IP.
app.use(cors());

// Stripe webhooks need the raw request body to verify the signature, so this
// route is registered BEFORE express.json() below and given its own raw
// parser — every other route gets the normal JSON body parser.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripeService.constructWebhookEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    console.error('[stripe webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await stripeService.handleWebhookEvent(event);
    res.json({ received: true });
  } catch (err) {
    console.error('[stripe webhook] handler failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/legal', legalRoutes);

app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Agent Workforce Portal running on port ${PORT}`);
});
