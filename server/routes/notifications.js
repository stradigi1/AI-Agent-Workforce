const express = require('express');

const notificationsRepo = require('../db/repo/notifications');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

router.use(authRequired);

router.get('/', async (req, res) => {
  const unreadOnly = req.query.unread === 'true';
  const notifications = await notificationsRepo.listForUser(req.user.id, { unreadOnly });
  res.json(notifications);
});

router.get('/unread-count', async (req, res) => {
  const count = await notificationsRepo.unreadCount(req.user.id);
  res.json({ count });
});

router.post('/:id/read', async (req, res) => {
  await notificationsRepo.markRead(req.user.id, req.params.id);
  res.status(204).end();
});

router.post('/read-all', async (req, res) => {
  await notificationsRepo.markAllRead(req.user.id);
  res.status(204).end();
});

module.exports = router;
