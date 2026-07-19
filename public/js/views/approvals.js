(function () {
  async function render(container) {
    container.innerHTML = `
      <div class="view-header">
        <div><h2>Approval Queue</h2><p>Work that has passed DOO validation and is waiting on you.</p></div>
      </div>
      <div class="panel"><div id="approvals-list" class="org-tree"><p class="empty-note">Loading…</p></div></div>
    `;
    window.__refreshCurrentView = () => render(container);
    await load();
  }

  async function load() {
    const listEl = document.getElementById('approvals-list');
    let queue;
    try {
      queue = await fetchJSON(`${API}/approvals`);
    } catch (err) {
      listEl.innerHTML = `<div class="auth-error">${escapeHTML(err.message)}</div>`;
      return;
    }

    if (queue.length === 0) {
      listEl.innerHTML = '<p class="empty-note">Nothing waiting on approval right now.</p>';
      return;
    }

    listEl.innerHTML = '';
    queue.forEach((task) => listEl.appendChild(window.renderTaskRow(task, window.TaskDetail.open)));
  }

  window.ViewApprovals = { render };
})();
