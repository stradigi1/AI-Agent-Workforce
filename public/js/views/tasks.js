// Task detail modal — shared across dashboard/approvals views. Exposes
// window.TaskDetail.open(id) and a shared row-renderer used by the org tree.
(function () {
  const STATUS_LABELS = {
    DOO: 'With DOO', Manager: 'With Manager', Specialist: 'With Specialist',
    Manager_Review: 'Manager Reviewing', DOO_Review: 'DOO Validating',
    Approval_Queue: 'Awaiting CEO Approval', Approved: 'Approved', Denied: 'Denied',
    Stuck: 'Stuck', Error: 'Error', Cancelled: 'Cancelled',
  };

  function renderTaskRow(task, onClick) {
    const row = document.createElement('div');
    row.className = `task-row tier-${task.tier}`;
    row.dataset.id = task.id;
    const statusClass = `status-tag status-${task.status}`;

    row.innerHTML = `
      <span class="task-tier-tag">${task.tier}</span>
      <div class="task-main">
        <div class="task-name">${escapeHTML(task.task_name)}</div>
        <div class="task-meta">${[task.department_name, task.agent_role, `#${task.id}`].filter(Boolean).join(' · ')}</div>
      </div>
      <span class="${statusClass}">${STATUS_LABELS[task.status] || task.status}</span>
    `;
    row.addEventListener('click', () => onClick(task.id));
    return row;
  }

  function revisionHistoryHTML(history) {
    if (!history || history.length === 0) return '';
    return `
      <div class="detail-field">
        <label>Revision history</label>
        ${history.map((h) => `
          <div class="revision-entry ${h.accepted ? 'accepted' : 'rejected'}">
            <strong>Round ${h.round}${h.accepted ? ' — accepted' : ' — sent back'}</strong> (${formatDate(h.timestamp)})<br/>
            ${escapeHTML(h.manager_feedback)}
          </div>
        `).join('')}
      </div>
    `;
  }

  async function open(taskId) {
    const overlay = document.getElementById('task-detail-overlay');
    const content = document.getElementById('task-detail-content');
    content.innerHTML = '<p class="empty-note">Loading…</p>';
    overlay.classList.remove('hidden');

    let data;
    try {
      data = await fetchJSON(`${API}/tasks/${taskId}`);
    } catch (err) {
      content.innerHTML = `<div class="auth-error">${escapeHTML(err.message)}</div>`;
      return;
    }

    render(data);
  }

  function render({ task, children, grandchildren }) {
    const content = document.getElementById('task-detail-content');
    const isApprover = window.__session && (window.__session.user.role === 'Owner' || window.__session.user.can_approve);

    content.innerHTML = `
      <h3>${escapeHTML(task.task_name)}</h3>
      <div class="detail-field">
        <label>Tier / Department / Role</label>
        <div class="readonly-text">${[task.tier, task.department_name, task.agent_role].filter(Boolean).join(' — ')}</div>
      </div>
      <div class="detail-field">
        <label>Status</label>
        <span class="status-tag status-${task.status}">${STATUS_LABELS[task.status] || task.status}</span>
      </div>
      ${task.directive ? `<div class="detail-field"><label>Original directive</label><div class="readonly-text">${escapeHTML(task.directive)}</div></div>` : ''}
      ${task.spec ? `<div class="detail-field"><label>Project spec (DOO)</label><div class="readonly-text">${escapeHTML(task.spec)}</div></div>` : ''}
      <div class="detail-field">
        <label>Objective</label>
        <textarea id="detail-objective" rows="3">${escapeHTML(task.objective)}</textarea>
      </div>
      ${task.output ? `<div class="detail-field"><label>Output</label><div class="readonly-text">${escapeHTML(task.output)}</div></div>` : ''}
      ${task.doo_validation_notes ? `<div class="detail-field"><label>DOO validation notes</label><div class="readonly-text">${escapeHTML(task.doo_validation_notes)}</div></div>` : ''}
      ${task.stuck_notes ? `<div class="detail-field"><label>Stuck notes</label><div class="readonly-text">${escapeHTML(task.stuck_notes)}</div></div>` : ''}
      ${task.error_detail ? `<div class="detail-field"><label>Error detail</label><div class="readonly-text">${escapeHTML(task.error_detail)}</div></div>` : ''}
      ${task.denial_reason ? `<div class="detail-field"><label>CEO denial reason</label><div class="readonly-text">${escapeHTML(task.denial_reason)}</div></div>` : ''}
      ${revisionHistoryHTML(task.revision_history)}

      ${children && children.length ? `
        <div class="detail-field">
          <label>Manager</label>
          <div id="detail-children"></div>
        </div>` : ''}

      <div class="detail-actions" id="detail-actions"></div>
    `;

    if (children && children.length) {
      const childWrap = document.getElementById('detail-children');
      children.forEach((child) => {
        childWrap.appendChild(renderTaskRow(child, open));
        const grandkids = (grandchildren && grandchildren[child.id]) || [];
        grandkids.forEach((gc) => childWrap.appendChild(renderTaskRow(gc, open)));
      });
    }

    content.querySelector('#detail-objective').addEventListener('change', async (e) => {
      try {
        await fetchJSON(`${API}/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ objective: e.target.value }) });
        toast('Objective updated', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });

    const actions = document.getElementById('detail-actions');
    const buttons = [];

    if (task.status === 'Error') {
      buttons.push(`<button class="btn btn-primary" data-action="retry">Retry</button>`);
    }
    if (task.status === 'Stuck') {
      buttons.push(`<button class="btn btn-primary" data-action="resume">DOO: Resume</button>`);
    }
    if (task.status === 'Approval_Queue' && isApprover && !task.parent_id) {
      buttons.push(`<button class="btn btn-primary" data-action="approve">Approve</button>`);
      buttons.push(`<button class="btn btn-danger" data-action="deny">Deny…</button>`);
    }
    if (!['Approved', 'Cancelled'].includes(task.status)) {
      buttons.push(`<button class="btn btn-ghost" data-action="cancel">Cancel task</button>`);
    }
    buttons.push(`<button class="btn btn-ghost" data-action="close">Close</button>`);
    actions.innerHTML = buttons.join('');

    const act = (name, fn) => {
      const btn = actions.querySelector(`[data-action="${name}"]`);
      if (btn) btn.addEventListener('click', fn);
    };

    act('retry', async () => { await run(() => fetchJSON(`${API}/tasks/${task.id}/retry`, { method: 'POST' })); });
    act('resume', async () => { await run(() => fetchJSON(`${API}/tasks/${task.id}/resume`, { method: 'POST' })); });
    act('approve', async () => { await run(() => fetchJSON(`${API}/approvals/${task.id}/approve`, { method: 'POST' })); });
    act('deny', async () => {
      const reason = prompt('Reason for denial (sent back to the DOO):');
      if (!reason) return;
      await run(() => fetchJSON(`${API}/approvals/${task.id}/deny`, { method: 'POST', body: JSON.stringify({ reason }) }));
    });
    act('cancel', async () => {
      if (!confirm('Cancel this task?')) return;
      await run(() => fetchJSON(`${API}/tasks/${task.id}/cancel`, { method: 'POST' }));
    });
    act('close', () => close());

    async function run(fn) {
      try {
        await fn();
        toast('Done', 'success');
        close();
        if (window.__refreshCurrentView) window.__refreshCurrentView();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  }

  function close() {
    document.getElementById('task-detail-overlay').classList.add('hidden');
  }

  window.TaskDetail = { open, close };
  window.renderTaskRow = renderTaskRow;
  window.STATUS_LABELS = STATUS_LABELS;
})();
