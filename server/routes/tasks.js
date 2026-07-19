const express = require('express');

const tasksRepo = require('../db/repo/tasks');
const activityRepo = require('../db/repo/activity');
const improvementsRepo = require('../db/repo/improvements');
const orchestrator = require('../services/agentOrchestrator');
const { authRequired } = require('../middleware/auth');
const { requireTenantUser } = require('../middleware/requireRole');

const router = express.Router();

router.use(authRequired, requireTenantUser);

router.get('/', async (req, res) => {
  try {
    const tasks = await tasksRepo.listByTenant(req.tenantId);
    res.json(tasks);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Section 3 "idle behavior" — polled by the dashboard. Registered ahead of
// the /:id route below so these literal paths aren't swallowed as an :id.
router.get('/idle-check', async (req, res) => {
  try {
    const result = await orchestrator.checkIdleAndPropose(req.tenantId);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/improvements', async (req, res) => {
  try {
    const items = await improvementsRepo.listByTenant(req.tenantId);
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const task = await tasksRepo.getById(req.tenantId, req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const children = await tasksRepo.getChildren(req.tenantId, req.params.id);
    const grandchildren = {};
    for (const child of children) {
      grandchildren[child.id] = await tasksRepo.getChildren(req.tenantId, child.id);
    }
    res.json({ task, children, grandchildren });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Issue a new directive — Section 4: "Issue new directives (start a new project)"
router.post('/', async (req, res) => {
  try {
    const { taskName, objective, priority } = req.body;
    if (!taskName || !objective) return res.status(400).json({ error: 'taskName and objective are required' });

    const task = await orchestrator.createDirective(req.tenantId, req.user.id, { taskName, objective, priority });
    await activityRepo.log(req.tenantId, req.user.id, 'directive_issued', taskName);

    // Fire-and-forget: the chain runs in the background and the frontend
    // polls task status, matching the existing prototype's polling pattern.
    orchestrator.advanceChain(req.tenantId, task.id).catch((err) => console.error('[tasks] advanceChain failed', err));

    res.status(201).json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Manual edit — Section 4: "Add, edit, or manage tasks manually if needed".
// Deliberately limited to descriptive fields; chain-state fields (status,
// revision data) are only ever changed by the orchestrator or the dedicated
// retry/resume/cancel actions below, to avoid corrupting an in-flight chain.
router.patch('/:id', async (req, res) => {
  try {
    const { task_name, objective, priority } = req.body;
    const updated = await tasksRepo.update(req.tenantId, req.params.id, { task_name, objective, priority });
    if (!updated) return res.status(404).json({ error: 'Task not found' });
    await activityRepo.log(req.tenantId, req.user.id, 'task_edited', `Task ${req.params.id}`);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/cancel', async (req, res) => {
  try {
    const updated = await tasksRepo.update(req.tenantId, req.params.id, { status: 'Cancelled' });
    if (!updated) return res.status(404).json({ error: 'Task not found' });
    await activityRepo.log(req.tenantId, req.user.id, 'task_cancelled', `Task ${req.params.id}`);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await tasksRepo.deleteTask(req.tenantId, req.params.id);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Manual "Retry" action for tasks in an Error state (Section 3 failure handling)
router.post('/:id/retry', async (req, res) => {
  try {
    const updated = await orchestrator.retryTask(req.tenantId, req.params.id);
    await activityRepo.log(req.tenantId, req.user.id, 'task_retried', `Task ${req.params.id}`);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DOO "resume stuck task" action (Section 3 revision cap escalation)
router.post('/:id/resume', async (req, res) => {
  try {
    const updated = await orchestrator.resumeStuckTask(req.tenantId, req.params.id);
    await activityRepo.log(req.tenantId, req.user.id, 'task_resumed', `Task ${req.params.id}`);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
