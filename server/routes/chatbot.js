const express = require('express');

const chatbotRepo = require('../db/repo/chatbot');
const promptsRepo = require('../db/repo/prompts');
const tenantsRepo = require('../db/repo/tenants');
const ticketsRepo = require('../db/repo/tickets');
const claude = require('../services/claude');
const { defaultChatbotPrompt } = require('../services/defaultPrompts');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

const VALID_MODES = ['sales', 'support', 'billing'];

// Public sales mode works without login (Section 9: "may need to run
// without requiring login, on a public-facing page"); support/billing
// modes are more useful authenticated but don't hard-require it either.
router.post('/message', optionalAuth, async (req, res) => {
  try {
    const { sessionId, message, mode } = req.body;
    if (!sessionId || !message) return res.status(400).json({ error: 'sessionId and message are required' });
    const chatMode = VALID_MODES.includes(mode) ? mode : 'sales';

    const tenantId = req.tenantId || null;
    const userId = req.user?.id || null;

    const conversation = await chatbotRepo.getOrCreateConversation({ tenantId, userId, sessionId, mode: chatMode });
    await chatbotRepo.addMessage(conversation.id, 'user', message);

    const tenant = tenantId ? await tenantsRepo.getTenantById(tenantId) : null;
    const systemPrompt = tenantId
      ? await (async () => {
          const row = await promptsRepo.getPrompt(tenantId, 'Chatbot', null);
          return row ? row.system_prompt : defaultChatbotPrompt(tenant?.name);
        })()
      : defaultChatbotPrompt(null);

    const history = await chatbotRepo.getHistory(conversation.id, 20);
    const anthropicHistory = history.map((m) => ({ role: m.role, content: m.message }));

    const modeContext = `[Current mode: ${chatMode}${req.user ? `, user is logged in as ${req.user.email} on tenant "${tenant?.name}"` : ', user is not logged in'}]`;
    anthropicHistory[anthropicHistory.length - 1] = {
      role: 'user',
      content: `${modeContext}\n${message}`,
    };

    const reply = await claude.chatCompletion({ tenantId, systemPrompt, history: anthropicHistory });
    await chatbotRepo.addMessage(conversation.id, 'assistant', reply);

    res.json({ reply, conversationId: conversation.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Lets the widget offer "file a ticket" when the bot can't resolve something
// (Section 9) — only meaningful for a logged-in tenant user.
router.post('/file-ticket', optionalAuth, async (req, res) => {
  try {
    if (!req.user || req.user.user_type !== 'tenant') {
      return res.status(401).json({ error: 'Log in to file a support ticket' });
    }
    const { subject, description, category, severity } = req.body;
    if (!subject || !description) return res.status(400).json({ error: 'subject and description are required' });

    const ticket = await ticketsRepo.create(req.tenantId, req.user.id, { subject, description, category, severity });
    res.status(201).json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
