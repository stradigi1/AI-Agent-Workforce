const express = require('express');

const tasksRepo = require('../db/repo/tasks');
const activityRepo = require('../db/repo/activity');
const orchestrator = require('../services/agentOrchestrator');
const { authRequired } = require('../middleware/auth');
const { requireApprover, requireTenantUser } = require('../middleware/requireRole');

const router = express.Router();

router.use(authRequired, requireTenantUser);

router.get('/', async (req, res) => {
  try {
    const queue = await tasksRepo.listApprovalQueue(req.tenantId);
    res.json(queue);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/approve', requireApprover, async (req, res) => {
  try {
    const updated = await orchestrator.approveTask(req.tenantId, req.params.id, req.user.id);
    await activityRepo.log(req.tenantId, req.user.id, 'task_approved', `Task ${req.params.id}`);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/deny', requireApprover, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'A denial reason is required' });
    const updated = await orchestrator.denyTask(req.tenantId, req.params.id, req.user.id, reason);
    await activityRepo.log(req.tenantId, req.user.id, 'task_denied', `Task ${req.params.id}: ${reason}`);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
