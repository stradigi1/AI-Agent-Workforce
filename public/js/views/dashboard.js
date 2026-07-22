(function () {
  const PRIORITY_RANK = { Urgent: 4, High: 3, Medium: 2, Low: 1 };
  const ATTENTION_STATUSES = ['Stuck', 'Error'];
  const IN_PROGRESS_STATUSES = ['DOO', 'Manager', 'Specialist', 'DOO_Review'];
  const COLLAPSE_STORAGE_KEY = 'orgTreeCollapseState';

  // Module-level so filter/sort/search selections and collapse state survive
  // the full re-renders that happen after every task action elsewhere in the
  // app (approve/deny/retry/nudge all call window.__refreshCurrentView).
  let allTasks = [];
  let searchQuery = '';
  let statusFilter = 'all';
  let deptFilter = 'all';
  let sortMode = 'newest';

  function loadCollapseState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(COLLAPSE_STORAGE_KEY) || '{}');
      return { collapsed: new Set(parsed.collapsed || []), expanded: new Set(parsed.expanded || []) };
    } catch {
      return { collapsed: new Set(), expanded: new Set() };
    }
  }
  let collapseState = loadCollapseState();

  function persistCollapseState() {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify({
      collapsed: [...collapseState.collapsed],
      expanded: [...collapseState.expanded],
    }));
  }

  // Smart default: a directive with no explicit user preference starts
  // collapsed once it's Approved (done, no longer needs eyes on it) and
  // expanded otherwise — the "clean up the list" ask, without permanently
  // hiding anything the user hasn't already effectively finished with.
  function isCollapsed(root) {
    if (collapseState.collapsed.has(root.id)) return true;
    if (collapseState.expanded.has(root.id)) return false;
    return root.status === 'Approved';
  }

  function setCollapsed(rootId, collapsed) {
    if (collapsed) {
      collapseState.expanded.delete(rootId);
      collapseState.collapsed.add(rootId);
    } else {
      collapseState.collapsed.delete(rootId);
      collapseState.expanded.add(rootId);
    }
    persistCollapseState();
  }

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
          <div class="org-panel-top">
            <h3 class="panel-title" style="margin:0;">Chain of Command</h3>
            <button class="attention-chip hidden" id="attention-chip" type="button"></button>
          </div>
          <div class="org-toolbar">
            <input type="text" id="org-search" class="org-search-input" placeholder="Search directives…" />
            <select id="org-filter-status">
              <option value="all">All statuses</option>
              <option value="attention">⚠ Needs attention</option>
              <option value="in_progress">In progress</option>
              <option value="approval_queue">Awaiting approval</option>
              <option value="approved">Approved</option>
            </select>
            <select id="org-filter-dept">
              <option value="all">All departments</option>
            </select>
            <select id="org-sort">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="priority">Priority</option>
              <option value="attention">Needs attention first</option>
            </select>
            <button class="btn btn-sm btn-ghost" id="org-expand-all" type="button">Expand all</button>
            <button class="btn btn-sm btn-ghost" id="org-collapse-all" type="button">Collapse all</button>
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

    wireToolbar();
    await loadTree();
    await loadIdle();
  }

  function wireToolbar() {
    const search = document.getElementById('org-search');
    const statusSel = document.getElementById('org-filter-status');
    const deptSel = document.getElementById('org-filter-dept');
    const sortSel = document.getElementById('org-sort');

    // Restore prior selections across a full re-render (e.g. after any task
    // action elsewhere calls window.__refreshCurrentView).
    search.value = searchQuery;
    statusSel.value = statusFilter;
    sortSel.value = sortMode;

    search.addEventListener('input', () => { searchQuery = search.value; renderTree(); });
    statusSel.addEventListener('change', () => { statusFilter = statusSel.value; renderTree(); });
    deptSel.addEventListener('change', () => { deptFilter = deptSel.value; renderTree(); });
    sortSel.addEventListener('change', () => { sortMode = sortSel.value; renderTree(); });

    document.getElementById('org-expand-all').addEventListener('click', () => {
      const roots = allTasks.filter((t) => t.tier === 'DOO');
      roots.forEach((r) => setCollapsed(r.id, false));
      renderTree();
    });
    document.getElementById('org-collapse-all').addEventListener('click', () => {
      const roots = allTasks.filter((t) => t.tier === 'DOO');
      roots.forEach((r) => setCollapsed(r.id, true));
      renderTree();
    });
    document.getElementById('attention-chip').addEventListener('click', () => {
      statusFilter = 'attention';
      document.getElementById('org-filter-status').value = 'attention';
      renderTree();
    });
  }

  async function loadTree() {
    const treeEl = document.getElementById('org-tree');
    try {
      allTasks = await fetchJSON(`${API}/tasks`);
    } catch (err) {
      treeEl.innerHTML = `<div class="auth-error">${escapeHTML(err.message)}</div>`;
      return;
    }
    renderTree();
  }

  function directiveTree(root) {
    const managers = allTasks.filter((t) => t.parent_id === root.id);
    return managers.map((manager) => ({
      manager,
      specialists: allTasks.filter((t) => t.parent_id === manager.id),
    }));
  }

  function allNodes(root, groups) {
    return [root, ...groups.flatMap((g) => [g.manager, ...g.specialists])];
  }

  function matchesSearch(nodes, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    return nodes.some((t) => [t.task_name, t.department_name, t.agent_role]
      .filter(Boolean).some((f) => f.toLowerCase().includes(q)));
  }

  function matchesStatus(nodes, root, filter) {
    if (filter === 'all') return true;
    if (filter === 'attention') return nodes.some((t) => ATTENTION_STATUSES.includes(t.status));
    if (filter === 'in_progress') return IN_PROGRESS_STATUSES.includes(root.status);
    if (filter === 'approval_queue') return root.status === 'Approval_Queue';
    if (filter === 'approved') return root.status === 'Approved';
    return true;
  }

  function matchesDept(nodes, filter) {
    if (filter === 'all') return true;
    return nodes.some((t) => t.department_name === filter);
  }

  function sortRoots(roots, mode) {
    const byRecencyDesc = (a, b) => new Date(b.created_at) - new Date(a.created_at);
    const sorted = [...roots];
    if (mode === 'oldest') return sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (mode === 'priority') return sorted.sort((a, b) => (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0) || byRecencyDesc(a, b));
    if (mode === 'attention') {
      return sorted.sort((a, b) => {
        const aAttn = allNodes(a, directiveTree(a)).some((t) => ATTENTION_STATUSES.includes(t.status)) ? 1 : 0;
        const bAttn = allNodes(b, directiveTree(b)).some((t) => ATTENTION_STATUSES.includes(t.status)) ? 1 : 0;
        return bAttn - aAttn || byRecencyDesc(a, b);
      });
    }
    return sorted.sort(byRecencyDesc); // 'newest' (default)
  }

  function renderTree() {
    const treeEl = document.getElementById('org-tree');
    const deptSel = document.getElementById('org-filter-dept');

    if (allTasks.length === 0) {
      treeEl.innerHTML = '<p class="empty-note">No directives yet. Issue one on the left to get started.</p>';
      document.getElementById('attention-chip').classList.add('hidden');
      return;
    }

    // Rebuild the department dropdown's options from what's actually present,
    // preserving the current selection.
    const depts = [...new Set(allTasks.map((t) => t.department_name).filter(Boolean))].sort();
    deptSel.innerHTML = '<option value="all">All departments</option>' + depts.map((d) => `<option value="${escapeHTML(d)}">${escapeHTML(d)}</option>`).join('');
    deptSel.value = depts.includes(deptFilter) ? deptFilter : 'all';
    if (deptSel.value !== deptFilter) deptFilter = deptSel.value;

    const allRoots = allTasks.filter((t) => t.tier === 'DOO');
    const attentionCount = allRoots.filter((r) => allNodes(r, directiveTree(r)).some((t) => ATTENTION_STATUSES.includes(t.status))).length;
    const chip = document.getElementById('attention-chip');
    if (attentionCount > 0) {
      chip.textContent = `⚠ ${attentionCount} need${attentionCount === 1 ? 's' : ''} attention`;
      chip.classList.remove('hidden');
    } else {
      chip.classList.add('hidden');
    }

    const filteredRoots = allRoots.filter((root) => {
      const groups = directiveTree(root);
      const nodes = allNodes(root, groups);
      return matchesSearch(nodes, searchQuery) && matchesStatus(nodes, root, statusFilter) && matchesDept(nodes, deptFilter);
    });

    if (filteredRoots.length === 0) {
      treeEl.innerHTML = '<p class="empty-note">No directives match the current search/filters.</p>';
      return;
    }

    const sortedRoots = sortRoots(filteredRoots, sortMode);

    treeEl.innerHTML = '';
    sortedRoots.forEach((root) => treeEl.appendChild(renderDirectiveGroup(root)));
  }

  function renderDirectiveGroup(root) {
    const groups = directiveTree(root);
    const collapsed = isCollapsed(root);

    const group = document.createElement('div');
    group.className = `directive-group${collapsed ? ' collapsed' : ''}`;
    group.dataset.rootId = root.id;

    const header = document.createElement('div');
    header.className = 'directive-header-row';

    const toggle = document.createElement('button');
    toggle.className = 'tree-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', collapsed ? 'Expand directive' : 'Collapse directive');
    toggle.textContent = '▾';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowCollapsed = !group.classList.contains('collapsed');
      group.classList.toggle('collapsed', nowCollapsed);
      toggle.setAttribute('aria-label', nowCollapsed ? 'Expand directive' : 'Collapse directive');
      setCollapsed(root.id, nowCollapsed);
    });

    const rootRow = window.renderTaskRow(root, window.TaskDetail.open);
    rootRow.classList.add('directive-root-row');

    // Specialist progress fraction — a quick "2/3 approved" glance without
    // having to expand the group.
    const allSpecialists = groups.flatMap((g) => g.specialists);
    if (allSpecialists.length > 0) {
      const approvedCount = allSpecialists.filter((s) => s.status === 'Approved').length;
      const progress = document.createElement('span');
      progress.className = 'mono directive-progress';
      progress.textContent = `${approvedCount}/${allSpecialists.length}`;
      progress.title = `${approvedCount} of ${allSpecialists.length} specialist tasks approved`;
      const statusTag = rootRow.querySelector('.status-tag');
      if (statusTag) statusTag.insertAdjacentElement('beforebegin', progress);
    }

    header.appendChild(toggle);
    header.appendChild(rootRow);
    group.appendChild(header);

    const children = document.createElement('div');
    children.className = 'directive-children';
    groups.forEach(({ manager, specialists }) => {
      children.appendChild(window.renderTaskRow(manager, window.TaskDetail.open));
      specialists.forEach((spec) => children.appendChild(window.renderTaskRow(spec, window.TaskDetail.open)));
    });
    group.appendChild(children);

    return group;
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
              <div style="margin-top:8px;">
                ${i.converted_task_id
                  ? `<button class="btn btn-sm btn-ghost" data-action="view-converted" data-task-id="${i.converted_task_id}">✓ Converted — view task</button>`
                  : `<button class="btn btn-sm btn-primary" data-action="convert" data-id="${i.id}">Turn into Directive</button>`}
              </div>
            </li>`).join('')
        : '<li class="empty-note">No proposals logged yet.</li>';

      list.querySelectorAll('[data-action="convert"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = 'Converting…';
          try {
            await fetchJSON(`${API}/tasks/improvements/${btn.dataset.id}/convert`, { method: 'POST' });
            toast('Converted to a directive — the DOO is on it', 'success');
            await loadIdle();
            await loadTree();
          } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Turn into Directive';
          }
        });
      });

      list.querySelectorAll('[data-action="view-converted"]').forEach((btn) => {
        btn.addEventListener('click', () => window.TaskDetail.open(btn.dataset.taskId));
      });
    } catch { /* non-fatal */ }
  }

  window.ViewDashboard = { render };
})();
