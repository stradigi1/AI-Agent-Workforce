// Background self-healing for directives silently orphaned by a server
// restart mid-chain (a Replit redeploy, autoscale cycle, crash — see the
// activeChains comment in agentOrchestrator.js for why this happens at all).
// Without this, an orphaned directive just sits there forever, indistinguishable
// from one still legitimately in progress, until a human happens to notice and
// clicks Nudge manually. This periodically finds root tasks that have been
// sitting in an active-processing status with no update for longer than any
// real chain step should take, and nudges them the same way a human would.
//
// Deliberately scoped to DOO/Manager/Specialist/DOO_Review only — never
// Stuck or Error. Those already carry a specific, human-readable reason
// (revision history, error detail) that a person should look at before
// anything retries automatically; auto-retrying a task that's stuck or
// erroring for a *real* reason (not just "orphaned") would silently burn
// API cost against a problem retrying can't actually fix. The scope here is
// self-limiting by design: nudging a genuinely orphaned task lets it
// naturally continue to wherever it was headed — Approval_Queue, Approved,
// or (if it hits a real problem) Stuck/Error — at which point it falls out
// of this sweep's target set entirely and waits for a human, same as today.

const tasksRepo = require('../db/repo/tasks');
const activityRepo = require('../db/repo/activity');
const orchestrator = require('./agentOrchestrator');

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes
const STALE_THRESHOLD_MINUTES = Number(process.env.STALE_TASK_THRESHOLD_MINUTES || 10);

async function sweepOnce() {
  let stale;
  try {
    stale = await tasksRepo.listStaleActiveRootTasks(STALE_THRESHOLD_MINUTES);
  } catch (err) {
    console.error('[sweeper] failed to query stale tasks:', err.message);
    return;
  }

  if (stale.length === 0) return;
  console.log(`[sweeper] found ${stale.length} stale task(s) quiet for >${STALE_THRESHOLD_MINUTES}min — auto-nudging`);

  for (const task of stale) {
    console.log(`[sweeper] auto-nudging task ${task.id} "${task.task_name}" (tenant ${task.tenant_id}, status ${task.status}, quiet since ${task.updated_at})`);
    activityRepo.log(task.tenant_id, null, 'task_auto_nudged', `Task ${task.id} "${task.task_name}" was quiet for over ${STALE_THRESHOLD_MINUTES}min and was auto-nudged`).catch(() => {});
    orchestrator.nudgeTask(task.tenant_id, task.id).catch((err) => {
      console.error(`[sweeper] auto-nudge failed for task ${task.id}:`, err.message);
    });
  }
}

function start() {
  // Run once immediately at boot — a server restart is exactly the moment a
  // task could have been orphaned by the *previous* process, so there's no
  // reason to make it wait a full interval to find out.
  sweepOnce().catch((err) => console.error('[sweeper] initial sweep failed:', err.message));

  setInterval(() => {
    sweepOnce().catch((err) => console.error('[sweeper] sweep failed:', err.message));
  }, SWEEP_INTERVAL_MS);

  console.log(`[sweeper] started — checking every ${SWEEP_INTERVAL_MS / 60000}min for directives quiet longer than ${STALE_THRESHOLD_MINUTES}min`);
}

module.exports = { start, sweepOnce };
