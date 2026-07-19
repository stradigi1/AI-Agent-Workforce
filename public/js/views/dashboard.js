(function () {
  async function render(container) {
    container.innerHTML = `
      <div class="view-header">
        <div><h2>Dashboard</h2><p>Issue a directive and watch it move through the chain of command.</p></div>
      </div>
      <div class="grid-2-uneven">
        <div>
          <div class="panel">
            <h3 class="panel-title">New Directive</h3>
            <p class="panel-hint">Hand a new objective to the DOO — it will route it to the right department.</p>
            <form id="new-directive-form">
              <label>Task name
                <input type="text" id="task-name" required placeholder="e.g. Launch Q3 content campaign" />
              </label>
              <label>Objective
                <textarea id="task-objective" rows="3" required placeholder="What outcome are we after?"></textarea>
              </label>
              <label>Priority
                <select id="task-priority">
                  <option>Low</option><option selected>Medium</option><option>High</option><option>Urgent</option>
                </select>
              </label>
              <button type="submit" class="btn btn-primary btn-block">Issue Directive</button>
            </form>
          </div>
          <div class="panel">
            <h3 class="panel-title">Idle Mode — Workforce Improvements</h3>
            <p class="panel-hint">When there's nothing open, the DOO proposes how to improve the agents.</p>
            <ul id="improvements-list" style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px;max-height:260px;overflow-y:auto;">
              <li class="empty-note">Checking…</li>
            </ul>
          </div>
        </div>
        <div class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <h3 class="panel-title" style="margin:0;">Chain of Command</h3>
            <span class="mono" id="dept-legend" style="font-size:11px;color:var(--text-dimmer);"></span>
          </div>
          <div id="org-tree" class="org-tree"><p class="empty-note">Loading tasks…</p></div>
        </div>
      </div>
    `;

    window.__refreshCurrentView = () => render(container);

    document.getElementById('new-directive-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const taskName = document.getElementById('task-name').value.trim();
      const objective = document.getElementById('task-objective').value.trim();
      const priority = document.getElementById('task-priority').value;
      if (!taskName || !objective) return;
      try {
        await fetchJSON(`${API}/tasks`, { method: 'POST', body: JSON.stringify({ taskName, objective, priority }) });
        toast('Directive issued — the DOO is on it', 'success');
        e.target.reset();
        document.getElementById('task-priority').value = 'Medium';
        await loadTree();
        await loadIdle();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    await loadTree();
    await loadIdle();
  }

  async function loadTree() {
    const treeEl = document.getElementById('org-tree');
    const legendEl = document.getElementById('dept-legend');
    let tasks;
    try {
      tasks = await fetchJSON(`${API}/tasks`);
    } catch (err) {
      treeEl.innerHTML = `<div class="auth-error">${escapeHTML(err.message)}</div>`;
      return;
    }

    if (tasks.length === 0) {
      treeEl.innerHTML = '<p class="empty-note">No directives yet. Issue one on the left to get started.</p>';
      legendEl.textContent = '';
      return;
    }

    const roots = tasks.filter((t) => t.tier === 'DOO');
    treeEl.innerHTML = '';
    roots.forEach((root) => {
      treeEl.appendChild(window.renderTaskRow(root, window.TaskDetail.open));
      tasks.filter((t) => t.parent_id === root.id).forEach((mgr) => {
        treeEl.appendChild(window.renderTaskRow(mgr, window.TaskDetail.open));
        tasks.filter((t) => t.parent_id === mgr.id).forEach((spec) => {
          treeEl.appendChild(window.renderTaskRow(spec, window.TaskDetail.open));
        });
      });
    });

    const depts = [...new Set(tasks.map((t) => t.department_name).filter(Boolean))];
    legendEl.textContent = depts.join(' · ');
  }

  async function loadIdle() {
    const pill = document.getElementById('idle-pill');
    const label = document.getElementById('idle-label');
    try {
      const result = await fetchJSON(`${API}/tasks/idle-check`);
      if (result.idle) {
        pill.classList.add('idle');
        label.textContent = 'Idle — DOO improving workforce';
      } else {
        pill.classList.remove('idle');
        label.textContent = `${result.openCount} open task${result.openCount === 1 ? '' : 's'}`;
      }
    } catch { /* non-fatal */ }

    const list = document.getElementById('improvements-list');
    if (!list) return;
    try {
      const items = await fetchJSON(`${API}/tasks/improvements`);
      list.innerHTML = items.length
        ? items.map((i) => `
            <li style="font-size:12.5px;line-height:1.5;padding:10px 12px;background:var(--bg);border-left:2px solid var(--brand);border-radius:4px;color:#C6CAD1;">
              <span class="mono" style="display:block;font-size:10.5px;color:var(--text-dimmer);margin-bottom:4px;">${formatDate(i.created_at)}</span>
              ${escapeHTML(i.proposal)}
            </li>`).join('')
        : '<li class="empty-note">No proposals logged yet.</li>';
    } catch { /* non-fatal */ }
  }

  window.ViewDashboard = { render };
})();
