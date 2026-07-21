const tasksRepo = require('../db/repo/tasks');
const departmentsRepo = require('../db/repo/departments');
const promptsRepo = require('../db/repo/prompts');
const tenantsRepo = require('../db/repo/tenants');
const usageRepo = require('../db/repo/usage');
const notificationsRepo = require('../db/repo/notifications');
const improvementsRepo = require('../db/repo/improvements');
const claude = require('./claude');
const {
  defaultDooPrompt,
  defaultManagerPrompt,
  defaultSpecialistPrompt,
} = require('./defaultPrompts');

const REVISION_CAP = 3;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getSystemPrompt(tenantId, tier, departmentId, fallback) {
  const row = await promptsRepo.getPrompt(tenantId, tier, departmentId);
  return row ? row.system_prompt : fallback;
}

async function checkUsageCap(tenantId) {
  const tenant = await tenantsRepo.getTenantById(tenantId);
  if (!tenant) return;
  const { totalTokens } = await usageRepo.getMonthToDateTokens(tenantId);
  if (totalTokens >= tenant.usage_cap_monthly_tokens && !tenant.usage_cap_warned_at) {
    await tenantsRepo.setUsageCapWarned(tenantId, true);
    await notificationsRepo.notifyTenantAdmins(
      tenantId,
      'usage_cap_warning',
      `This month's AI usage (${totalTokens.toLocaleString()} tokens) has reached your configured soft cap. Tasks will keep running — consider reviewing usage or raising the cap.`,
      '/app.html#/settings/usage'
    );
  }
}

// ---------- Step: DOO assigns department + writes the project spec ----------
async function runDooAssign(tenantId, root) {
  const departments = await departmentsRepo.listDepartments(tenantId);
  const systemPrompt = await getSystemPrompt(tenantId, 'DOO', null, defaultDooPrompt(departments.map((d) => d.name)));

  const userMessage = `ACTION: write_project_spec
Directive from the CEO: ${root.directive}

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{
  "department": "one of: ${departments.map((d) => d.name).join(', ')}",
  "manager_task_name": "short task title for the manager",
  "spec": "the project spec / definition of done, plain text with bullet points using -",
  "priority": "Low | Medium | High | Urgent"
}`;

  const result = await claude.callAgent({ tenantId, taskId: root.id, tier: 'DOO', systemPrompt, userMessage });
  const dept = departments.find((d) => d.name.toLowerCase() === String(result.department).toLowerCase()) || departments[0];

  const updatedRoot = await tasksRepo.updateUnsafe(root.id, {
    spec: result.spec,
    department_id: dept.id,
    priority: result.priority || root.priority,
    status: 'Manager',
  });

  await tasksRepo.create(tenantId, {
    parentId: root.id,
    rootId: root.id,
    tier: 'Manager',
    departmentId: dept.id,
    taskName: result.manager_task_name,
    objective: result.spec,
    priority: result.priority || root.priority,
    status: 'Manager',
  });

  return updatedRoot;
}

// ---------- Step: Manager breaks spec into specialist subtasks ----------
async function runManagerAssign(tenantId, root, managerTask) {
  const systemPrompt = await getSystemPrompt(
    tenantId, 'Manager', managerTask.department_id,
    defaultManagerPrompt(managerTask.department_name || 'the')
  );

  const userMessage = `ACTION: assign_specialists
Project spec: ${root.spec}
Manager task: ${managerTask.task_name}
${managerTask.doo_validation_notes ? `\nDOO sent this back with notes to address: ${managerTask.doo_validation_notes}` : ''}

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{
  "specialists": [
    { "agent_role": "specialist role name", "task_name": "short task title", "objective": "what this specialist needs to do", "priority": "Low | Medium | High | Urgent" }
  ]
}`;

  const result = await claude.callAgent({ tenantId, taskId: managerTask.id, tier: 'Manager', systemPrompt, userMessage });

  const created = [];
  for (const spec of result.specialists || []) {
    const t = await tasksRepo.create(tenantId, {
      parentId: managerTask.id,
      rootId: root.id,
      tier: 'Specialist',
      departmentId: managerTask.department_id,
      agentRole: spec.agent_role,
      taskName: spec.task_name,
      objective: spec.objective,
      priority: spec.priority || 'Medium',
      status: 'Specialist',
    });
    created.push(t);
  }
  return created;
}

// ---------- Step: run one specialist, then have the Manager review it,
// looping up to REVISION_CAP rounds. Returns the final specialist task row,
// with .status either 'Approved' or 'Stuck'. ----------
async function runSpecialistWithReview(tenantId, root, managerTask, specialistTask) {
  const specialistSystemPrompt = await getSystemPrompt(
    tenantId, 'Specialist', managerTask.department_id,
    defaultSpecialistPrompt(managerTask.department_name || 'the')
  );
  const managerSystemPrompt = await getSystemPrompt(
    tenantId, 'Manager', managerTask.department_id,
    defaultManagerPrompt(managerTask.department_name || 'the')
  );

  let current = specialistTask;

  while (true) {
    const history = current.revision_history || [];
    const lastFeedback = history.length
      ? history[history.length - 1].manager_feedback
      : managerTask.doo_validation_notes || null;

    const specUserMessage = `ACTION: do_the_work
Your role: ${current.agent_role}
Task: ${current.task_name}
Objective: ${current.objective}
${lastFeedback ? `\nPrevious feedback to address (revision round ${current.revision_round + 1} of ${REVISION_CAP}): ${lastFeedback}` : ''}

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{
  "output": "the actual deliverable content, as plain text",
  "blocked": false,
  "blockers": "describe any blockers preventing completion, or empty string if none"
}`;

    const specResult = await claude.callAgent({
      tenantId, taskId: current.id, tier: 'Specialist', systemPrompt: specialistSystemPrompt, userMessage: specUserMessage,
      // Specialist output is the actual deliverable (blog posts, multi-part
      // content, code, etc.) — the default budget is nowhere near enough for
      // substantial content and silently produces a truncated/empty response.
      maxTokens: 8192,
    });

    current = await tasksRepo.updateUnsafe(current.id, { output: specResult.output });

    const reviewUserMessage = `ACTION: review_specialist_work
Specialist role: ${current.agent_role}
Task: ${current.task_name}
Objective: ${current.objective}
Submitted work:
${specResult.output}

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{
  "accept": true or false,
  "feedback": "specific feedback for the specialist if rejected, or brief confirmation notes if accepted"
}`;

    const reviewResult = await claude.callAgent({
      tenantId, taskId: managerTask.id, tier: 'Manager', systemPrompt: managerSystemPrompt, userMessage: reviewUserMessage,
    });

    const newHistory = [...history, {
      round: current.revision_round + 1,
      specialist_output: specResult.output,
      manager_feedback: reviewResult.feedback,
      accepted: !!reviewResult.accept,
      timestamp: new Date().toISOString(),
    }];

    if (reviewResult.accept) {
      current = await tasksRepo.updateUnsafe(current.id, {
        status: 'Approved',
        revision_history: JSON.stringify(newHistory),
      });
      return current;
    }

    const nextRound = current.revision_round + 1;
    if (nextRound >= REVISION_CAP) {
      current = await tasksRepo.updateUnsafe(current.id, {
        status: 'Stuck',
        revision_round: nextRound,
        revision_history: JSON.stringify(newHistory),
        stuck_notes: `Stuck after ${REVISION_CAP} unresolved revision rounds. Last manager feedback: ${reviewResult.feedback}`,
      });
      return current;
    }

    current = await tasksRepo.updateUnsafe(current.id, {
      revision_round: nextRound,
      revision_history: JSON.stringify(newHistory),
      status: 'Specialist',
    });
    // loop continues — specialist gets another attempt with feedback attached
  }
}

// ---------- Step: Manager compiles all approved specialist outputs ----------
async function runManagerCompile(tenantId, managerTask, specialistTasks) {
  const systemPrompt = await getSystemPrompt(
    tenantId, 'Manager', managerTask.department_id,
    defaultManagerPrompt(managerTask.department_name || 'the')
  );

  const combined = specialistTasks
    .map((s) => `--- ${s.agent_role} (${s.task_name}) ---\n${s.output}`)
    .join('\n\n');

  const userMessage = `ACTION: compile_final_output
All specialists' work has been accepted. Compile into one coherent final deliverable.

${combined}

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{ "compiled_output": "the final compiled deliverable, plain text" }`;

  // Compiling multiple specialists' full deliverables into one document can
  // easily exceed a modest token budget — same reasoning as the specialist
  // call above.
  const result = await claude.callAgent({
    tenantId, taskId: managerTask.id, tier: 'Manager', systemPrompt, userMessage, maxTokens: 8192,
  });
  await tasksRepo.updateUnsafe(managerTask.id, { output: result.compiled_output, status: 'Approved' });
  return result.compiled_output;
}

// ---------- Step: DOO validates compiled output against the original spec ----------
async function runDooValidate(tenantId, root, compiledOutput) {
  const departments = await departmentsRepo.listDepartments(tenantId);
  const systemPrompt = await getSystemPrompt(tenantId, 'DOO', null, defaultDooPrompt(departments.map((d) => d.name)));

  const userMessage = `ACTION: validate_against_spec
Original project spec: ${root.spec}

Submitted final work:
${compiledOutput}

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{ "pass": true or false, "notes": "validation notes — why it passed, or specifically what's missing/wrong if it failed" }`;

  return claude.callAgent({ tenantId, taskId: root.id, tier: 'DOO', systemPrompt, userMessage });
}

// ---------- Entry point: create a new directive (root DOO task) ----------
async function createDirective(tenantId, userId, { taskName, objective, priority }) {
  const root = await tasksRepo.create(tenantId, {
    tier: 'DOO',
    taskName,
    objective,
    directive: objective,
    priority: priority || 'Medium',
    status: 'DOO',
    createdByUserId: userId,
  });
  return root;
}

// ---------- The chain engine: advances a root task as far as it can go
// automatically, stopping only at the two true human gates (Approval Queue)
// or the two flagged-for-attention states (Stuck, Error). Safe to call
// repeatedly/idempotently (e.g. a manual "Resume" action after Stuck/Error). ----------
async function runChainSteps(tenantId, rootTaskId) {
  let root = await tasksRepo.getByIdUnsafe(rootTaskId);
  if (!root) return;

  try {
    await checkUsageCap(tenantId);

    if (root.status === 'DOO') {
      root = await runDooAssign(tenantId, root);
    }

    if (root.status === 'Manager') {
      const managerTask = (await tasksRepo.getChildren(tenantId, root.id)).find((t) => t.tier === 'Manager');
      const existingSpecialists = await tasksRepo.getChildren(tenantId, managerTask.id);
      if (existingSpecialists.length === 0) {
        await runManagerAssign(tenantId, root, managerTask);
      }
      root = await tasksRepo.updateUnsafe(root.id, { status: 'Specialist' });
    }

    if (root.status === 'Specialist') {
      const managerTask = (await tasksRepo.getChildren(tenantId, root.id)).find((t) => t.tier === 'Manager');
      const tenant = await tenantsRepo.getTenantById(tenantId);
      const concurrency = Math.max(1, tenant?.specialist_concurrency_cap || 4);

      let specialists = await tasksRepo.getChildren(tenantId, managerTask.id);
      const pending = specialists.filter((s) => s.status !== 'Approved' && s.status !== 'Stuck');

      for (const batch of chunk(pending, concurrency)) {
        await Promise.all(batch.map((s) => runSpecialistWithReview(tenantId, root, managerTask, s)));
      }

      specialists = await tasksRepo.getChildren(tenantId, managerTask.id);
      const stuck = specialists.find((s) => s.status === 'Stuck');
      if (stuck) {
        root = await tasksRepo.updateUnsafe(root.id, {
          status: 'Stuck',
          stuck_notes: `Specialist "${stuck.agent_role}" (${stuck.task_name}) is stuck: ${stuck.stuck_notes}`,
        });
        await notificationsRepo.notifyTenantAdmins(
          tenantId, 'task_stuck',
          `"${root.task_name}" is stuck after ${REVISION_CAP} revision rounds and needs DOO/CEO attention.`,
          `/app.html#/tasks/${root.id}`
        );
        return root;
      }

      const compiledOutput = await runManagerCompile(tenantId, managerTask, specialists);
      root = await tasksRepo.updateUnsafe(root.id, { status: 'DOO_Review', output: compiledOutput });
    }

    if (root.status === 'DOO_Review') {
      const { pass, notes } = await runDooValidate(tenantId, root, root.output);

      if (pass) {
        root = await tasksRepo.updateUnsafe(root.id, { status: 'Approval_Queue', doo_validation_notes: notes });
        await notificationsRepo.notifyTenantAdmins(
          tenantId, 'approval_needed',
          `"${root.task_name}" passed DOO validation and is ready for your approval.`,
          `/app.html#/approvals`
        );
        return root;
      }

      const dooRejectRound = (root.revision_round || 0) + 1;
      if (dooRejectRound >= REVISION_CAP) {
        root = await tasksRepo.updateUnsafe(root.id, {
          status: 'Stuck',
          revision_round: dooRejectRound,
          stuck_notes: `DOO rejected the compiled work ${REVISION_CAP} times. Last notes: ${notes}`,
        });
        await notificationsRepo.notifyTenantAdmins(
          tenantId, 'task_stuck',
          `"${root.task_name}" is stuck — the DOO has rejected the Manager's submission ${REVISION_CAP} times.`,
          `/app.html#/tasks/${root.id}`
        );
        return root;
      }

      const managerTask = (await tasksRepo.getChildren(tenantId, root.id)).find((t) => t.tier === 'Manager');
      await tasksRepo.updateUnsafe(managerTask.id, { doo_validation_notes: notes, status: 'Manager' });
      const specialists = await tasksRepo.getChildren(tenantId, managerTask.id);
      for (const s of specialists) {
        await tasksRepo.updateUnsafe(s.id, { status: 'Specialist', revision_round: 0, revision_history: JSON.stringify([]) });
      }

      root = await tasksRepo.updateUnsafe(root.id, {
        status: 'Specialist', revision_round: dooRejectRound, doo_validation_notes: notes,
      });
      return runChainSteps(tenantId, rootTaskId);
    }

    return root;
  } catch (err) {
    console.error(`[orchestrator] chain failed for task ${rootTaskId}:`, err);
    await tasksRepo.updateUnsafe(rootTaskId, { status: 'Error', error_detail: err.message || String(err) });
    await notificationsRepo.notifyTenantAdmins(
      tenantId, 'task_error',
      `"${root.task_name}" hit an error and needs a manual retry.`,
      `/app.html#/tasks/${rootTaskId}`
    );
  }
}

// The chain runs fire-and-forget inside this same Node process rather than a
// durable job queue — if the process restarts mid-task (a Replit redeploy,
// autoscale cycle, crash), the in-flight promise just disappears and the
// task is left sitting at whatever status it last reached, with nothing
// actively working on it and no Error/Stuck flag to say so. This in-memory
// guard only prevents a *duplicate* concurrent run for the same task within
// one live process (e.g. a double-click on Nudge) — it can't detect or
// recover from the process-restart case itself, which is what nudgeTask()
// below is for.
const activeChains = new Set();

async function advanceChain(tenantId, rootTaskId) {
  const key = `${tenantId}:${rootTaskId}`;
  if (activeChains.has(key)) {
    console.log(`[orchestrator] advanceChain(${rootTaskId}) skipped — already running`);
    return;
  }
  activeChains.add(key);
  try {
    return await runChainSteps(tenantId, rootTaskId);
  } finally {
    activeChains.delete(key);
  }
}

// ---------- CEO approval / denial ----------
async function approveTask(tenantId, taskId, approverUserId) {
  const task = await tasksRepo.getById(tenantId, taskId);
  if (!task) throw new Error('Task not found');
  if (task.status !== 'Approval_Queue') throw new Error('Task is not awaiting approval');

  return tasksRepo.update(tenantId, taskId, {
    status: 'Approved',
    approved_by_user_id: approverUserId,
    approved_at: new Date(),
  });
}

async function denyTask(tenantId, taskId, approverUserId, reason) {
  const root = await tasksRepo.getById(tenantId, taskId);
  if (!root) throw new Error('Task not found');
  if (root.status !== 'Approval_Queue') throw new Error('Task is not awaiting approval');
  if (!reason) throw new Error('A denial reason is required');

  // Denial routes back to the DOO with the reason, never straight to editing
  // the work — the DOO re-sends it down the same Manager/spec chain with the
  // CEO's reason attached as context, rather than starting a brand-new DOO
  // pass (which would fork a second Manager task off the same root).
  const managerTask = (await tasksRepo.getChildren(tenantId, root.id)).find((t) => t.tier === 'Manager');
  if (managerTask) {
    await tasksRepo.updateUnsafe(managerTask.id, { status: 'Manager', doo_validation_notes: `CEO denied: ${reason}` });
    const specialists = await tasksRepo.getChildren(tenantId, managerTask.id);
    for (const s of specialists) {
      await tasksRepo.updateUnsafe(s.id, { status: 'Specialist', revision_round: 0, revision_history: JSON.stringify([]) });
    }
  }

  const updated = await tasksRepo.update(tenantId, taskId, {
    status: managerTask ? 'Specialist' : 'DOO',
    denial_reason: reason,
    doo_validation_notes: `CEO denied: ${reason}`,
  });
  advanceChain(tenantId, taskId).catch((err) => console.error('[orchestrator] post-denial advance failed', err));
  return updated;
}

// ---------- DOO "resume stuck task" manual action ----------
// Retry/Resume/Nudge all only make sense applied to the root task of a
// directive (advanceChain assumes it was handed a root task's id — a
// Manager or Specialist row has no "Manager child" of its own, so treating
// one as root crashes with "Cannot read properties of undefined (reading
// 'id')" the moment it looks for one). But the org tree deliberately shows
// Stuck/Error status on the specific child that's actually stuck, and it's
// entirely natural for a user to click into THAT row and hit Resume/Retry
// there — so rather than relying on the frontend to always gate these
// buttons to root rows, resolve to the real root here regardless of which
// task id was passed in.
async function resolveRootTask(tenantId, taskId) {
  const task = await tasksRepo.getById(tenantId, taskId);
  if (!task) throw new Error('Task not found');
  if (!task.parent_id) return task;
  return tasksRepo.getById(tenantId, task.root_id);
}

async function resumeStuckTask(tenantId, taskId) {
  const root = await resolveRootTask(tenantId, taskId);
  if (!root) throw new Error('Task not found');
  if (root.status !== 'Stuck') throw new Error('Task is not in a Stuck state');

  const managerTask = (await tasksRepo.getChildren(tenantId, root.id)).find((t) => t.tier === 'Manager');
  if (managerTask) {
    const specialists = await tasksRepo.getChildren(tenantId, managerTask.id);
    for (const s of specialists) {
      if (s.status === 'Stuck') {
        await tasksRepo.updateUnsafe(s.id, { status: 'Specialist', revision_round: 0, revision_history: JSON.stringify([]) });
      }
    }
    await tasksRepo.updateUnsafe(managerTask.id, { status: 'Manager' });
  }

  const updated = await tasksRepo.update(tenantId, root.id, { status: 'Manager', stuck_notes: null });
  advanceChain(tenantId, root.id).catch((err) => console.error('[orchestrator] resume advance failed', err));
  return updated;
}

// Marking a task Error overwrites the in-flight stage, so a retry needs to
// infer where the chain actually left off from what's already on the row
// rather than from the (now-clobbered) status.
async function inferResumeStatus(tenantId, root) {
  if (!root.spec) return 'DOO';

  const managerTask = (await tasksRepo.getChildren(tenantId, root.id)).find((t) => t.tier === 'Manager');
  if (!managerTask) return 'DOO';

  const specialists = await tasksRepo.getChildren(tenantId, managerTask.id);
  if (specialists.length === 0) return 'Manager';

  const allApproved = specialists.every((s) => s.status === 'Approved');
  if (!allApproved) return 'Specialist';

  if (!root.output) return 'Specialist'; // specialists done but compile step didn't finish
  return 'DOO_Review';
}

// ---------- Manual retry after Error ----------
async function retryTask(tenantId, taskId) {
  const root = await resolveRootTask(tenantId, taskId);
  if (!root) throw new Error('Task not found');
  if (root.status !== 'Error') throw new Error('Task is not in an Error state');

  const resumeStatus = await inferResumeStatus(tenantId, root);
  const updated = await tasksRepo.update(tenantId, root.id, { status: resumeStatus, error_detail: null });
  advanceChain(tenantId, root.id).catch((err) => console.error('[orchestrator] retry advance failed', err));
  return updated;
}

// A task can end up genuinely frozen — not flagged Error, not flagged Stuck
// — if the server process running its chain got restarted mid-task (see the
// comment on the activeChains guard above). There's no way to distinguish
// "still actually running" from "orphaned by a restart" from the DB alone,
// so this is a manual, human-triggered action rather than something
// automatic: the user decides a task has been sitting too long and asks for
// it to be nudged. Safe to call even if it turns out nothing was wrong —
// advanceChain always resumes from the task's current stored status, and
// the activeChains guard no-ops if a run is genuinely still in flight.
const NUDGEABLE_STATUSES = ['DOO', 'Manager', 'Specialist', 'DOO_Review', 'Stuck', 'Error'];

async function nudgeTask(tenantId, taskId) {
  const root = await resolveRootTask(tenantId, taskId);
  if (!root) throw new Error('Task not found');
  if (!NUDGEABLE_STATUSES.includes(root.status)) {
    throw new Error(`"${root.status}" tasks don't need nudging`);
  }

  if (root.status === 'Error') return retryTask(tenantId, root.id);
  if (root.status === 'Stuck') return resumeStuckTask(tenantId, root.id);

  advanceChain(tenantId, root.id).catch((err) => console.error('[orchestrator] nudge advance failed', err));
  return root;
}

// ---------- Idle mode: when there's no open work, the DOO proposes a
// workforce improvement instead (Section 3's "idle behavior"). ----------
async function runIdleDoo(tenantId) {
  const departments = await departmentsRepo.listDepartments(tenantId);
  const systemPrompt = await getSystemPrompt(tenantId, 'DOO', null, defaultDooPrompt(departments.map((d) => d.name)));

  const userMessage = `ACTION: propose_improvement
There is currently no open work anywhere in the workforce. Propose one concrete improvement.

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{ "proposal": "a specific, actionable improvement proposal, 2-4 sentences" }`;

  const result = await claude.callAgent({ tenantId, tier: 'DOO', systemPrompt, userMessage });
  return improvementsRepo.log(tenantId, result.proposal);
}

async function checkIdleAndPropose(tenantId) {
  const openCount = await tasksRepo.getOpenCount(tenantId);
  if (openCount > 0) return { idle: false, openCount };
  const proposal = await runIdleDoo(tenantId);
  return { idle: true, openCount: 0, proposal };
}

module.exports = {
  createDirective, advanceChain, approveTask, denyTask, resumeStuckTask, retryTask, nudgeTask,
  checkIdleAndPropose, REVISION_CAP,
};
