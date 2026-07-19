const express = require('express');

const legalRepo = require('../db/repo/legal');
const dataRequestsRepo = require('../db/repo/dataRequests');
const tasksRepo = require('../db/repo/tasks');
const usersRepo = require('../db/repo/users');
const ticketsRepo = require('../db/repo/tickets');
const activityRepo = require('../db/repo/activity');
const { authRequired } = require('../middleware/auth');
const { requireTenantRole } = require('../middleware/requireRole');

const router = express.Router();

// Public — shown on the signup page before an account exists.
router.get('/:docType', async (req, res) => {
  const doc = await legalRepo.getLatestVersion(req.params.docType);
  if (!doc) return res.status(404).json({ error: 'No document on file for that type' });
  res.json(doc);
});

router.get('/status/acceptance', authRequired, async (req, res) => {
  const [tos, privacy, history] = await Promise.all([
    legalRepo.getLatestVersion('tos'),
    legalRepo.getLatestVersion('privacy'),
    legalRepo.getAcceptanceHistory(req.user.id),
  ]);

  const latestAcceptedVersion = (docType) => history.find((h) => h.doc_type === docType)?.version || null;

  res.json({
    tos: { currentVersion: tos?.version, acceptedVersion: latestAcceptedVersion('tos'), upToDate: tos?.version === latestAcceptedVersion('tos') },
    privacy: { currentVersion: privacy?.version, acceptedVersion: latestAcceptedVersion('privacy'), upToDate: privacy?.version === latestAcceptedVersion('privacy') },
  });
});

// Re-prompt acceptance when terms change materially (Section 10 build requirement).
router.post('/:docType/accept', authRequired, async (req, res) => {
  const doc = await legalRepo.getLatestVersion(req.params.docType);
  if (!doc) return res.status(404).json({ error: 'No document on file for that type' });
  const accepted = await legalRepo.recordAcceptance(req.user.id, req.params.docType, doc.version);
  res.status(201).json(accepted);
});

// ---------- Data export / deletion (Sections 10 & 20) ----------
router.post('/data-request/export', authRequired, requireTenantRole('Owner'), async (req, res) => {
  try {
    const [tasks, users, tickets] = await Promise.all([
      tasksRepo.listByTenant(req.tenantId),
      usersRepo.listUsersByTenant(req.tenantId),
      ticketsRepo.listByTenant(req.tenantId),
    ]);

    const request = await dataRequestsRepo.create(req.tenantId, req.user.id, 'export');
    await dataRequestsRepo.markCompleted(request.id);
    await activityRepo.log(req.tenantId, req.user.id, 'data_export_requested', null);

    // Returned directly rather than emailed/staged — this is a synchronous
    // export of everything scoped to the tenant, which the browser can save.
    res.json({ exportedAt: new Date().toISOString(), tenantId: req.tenantId, tasks, users, tickets });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Deletion is request-only, not instant/self-service: it surfaces in the
// Stradigi admin queue for staff to execute after the usual account-closure
// steps (e.g. billing cancellation, any retention-period grace window) —
// see Section 20's open question on retention-before-deletion.
router.post('/data-request/deletion', authRequired, requireTenantRole('Owner'), async (req, res) => {
  try {
    const request = await dataRequestsRepo.create(req.tenantId, req.user.id, 'deletion');
    await activityRepo.log(req.tenantId, req.user.id, 'data_deletion_requested', null);
    res.status(201).json(request);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/data-request/history', authRequired, requireTenantRole('Owner', 'Admin'), async (req, res) => {
  const history = await dataRequestsRepo.listByTenant(req.tenantId);
  res.json(history);
});

module.exports = router;
