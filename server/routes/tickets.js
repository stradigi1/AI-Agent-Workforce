const express = require('express');

const ticketsRepo = require('../db/repo/tickets');
const activityRepo = require('../db/repo/activity');
const emailService = require('../services/emailService');
const { authRequired } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/requireRole');

const router = express.Router();

router.use(authRequired, requireTenantUser);

function canSeeAllTenantTickets(user) {
  return user.role === 'Owner' || user.role === 'Admin';
}

router.get('/', async (req, res) => {
  try {
    const tickets = canSeeAllTenantTickets(req.user)
      ? await ticketsRepo.listByTenant(req.tenantId)
      : await ticketsRepo.listByUser(req.tenantId, req.user.id);
    res.json(tickets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const ticket = await ticketsRepo.getById(req.tenantId, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (!canSeeAllTenantTickets(req.user) && ticket.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your ticket' });
    }
    const messages = await ticketsRepo.listMessages(ticket.id);
    res.json({ ticket, messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Section 7: submit a ticket -> notify Stradigi + confirm receipt to the user
router.post('/', async (req, res) => {
  try {
    const { subject, description, category, severity } = req.body;
    if (!subject || !description) return res.status(400).json({ error: 'subject and description are required' });

    const ticket = await ticketsRepo.create(req.tenantId, req.user.id, { subject, description, category, severity });
    await activityRepo.log(req.tenantId, req.user.id, 'ticket_submitted', subject);

    await emailService.sendEmail({
      to: process.env.SUPPORT_TEAM_EMAIL || 'support@stradigi.local',
      subject: `[New Ticket] ${req.tenant.name}: ${subject}`,
      text: `New ${severity || 'normal'} severity ${category || 'general'} ticket from ${req.user.email} (${req.tenant.name}):\n\n${description}`,
    });
    await emailService.sendEmail({
      to: req.user.email,
      subject: `We received your support request: ${subject}`,
      text: `Thanks — we've received your ticket "${subject}" and will follow up soon. You can track its status in the portal under Support.`,
    });

    res.status(201).json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/messages', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    const ticket = await ticketsRepo.getById(req.tenantId, req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (!canSeeAllTenantTickets(req.user) && ticket.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your ticket' });
    }

    const msg = await ticketsRepo.addMessage(ticket.id, { senderUserId: req.user.id, senderType: 'tenant', message });
    res.status(201).json(msg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
