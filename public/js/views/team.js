(function () {
  let activeTab = 'users';

  async function render(container) {
    const session = window.__session;
    const canManage = session && (session.user.role === 'Owner' || session.user.role === 'Admin');

    container.innerHTML = `
      <div class="view-header">
        <div><h2>Team</h2><p>Manage who has access to this workspace.</p></div>
      </div>
      <div class="tabs">
        <button class="tab-btn ${activeTab === 'users' ? 'active' : ''}" data-tab="users">Users</button>
        <button class="tab-btn ${activeTab === 'activity' ? 'active' : ''}" data-tab="activity">Activity Log</button>
      </div>
      <div id="team-tab-content"></div>
    `;
    window.__refreshCurrentView = () => render(container);

    container.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => { activeTab = btn.dataset.tab; render(container); });
    });

    if (!canManage) {
      document.getElementById('team-tab-content').innerHTML = '<p class="empty-note">Only Owners and Admins can manage the team.</p>';
      return;
    }

    if (activeTab === 'users') await renderUsers();
    else await renderActivity();
  }

  async function renderUsers() {
    const target = document.getElementById('team-tab-content');
    target.innerHTML = `
      <div class="panel">
        <h3 class="panel-title">Invite a teammate</h3>
        <form id="invite-form" class="grid-2">
          <label>Email <input type="email" id="invite-email" required /></label>
          <label>Role
            <select id="invite-role">
              <option value="Member">Member — issue directives, view progress</option>
              <option value="Admin">Admin — manage users/settings</option>
            </select>
          </label>
          <label id="can-approve-wrap" class="hidden">
            <input type="checkbox" id="invite-can-approve" style="width:auto;margin-right:6px;" />
            Can also approve/deny tasks
          </label>
          <div></div>
          <button type="submit" class="btn btn-primary" style="grid-column:1/-1;">Send invite</button>
        </form>
      </div>
      <div class="panel">
        <h3 class="panel-title">Members</h3>
        <table class="data-table" id="users-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody></tbody></table>
      </div>
    `;

    document.getElementById('invite-role').addEventListener('change', (e) => {
      document.getElementById('can-approve-wrap').classList.toggle('hidden', e.target.value !== 'Admin');
    });

    document.getElementById('invite-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('invite-email').value.trim();
      const role = document.getElementById('invite-role').value;
      const canApprove = document.getElementById('invite-can-approve').checked;
      try {
        await fetchJSON(`${API}/users/invite`, { method: 'POST', body: JSON.stringify({ email, role, canApprove }) });
        toast('Invite sent', 'success');
        e.target.reset();
        await loadUsersTable();
      } catch (err) { toast(err.message, 'error'); }
    });

    await loadUsersTable();
  }

  async function loadUsersTable() {
    const tbody = document.querySelector('#users-table tbody');
    const users = await fetchJSON(`${API}/users`);
    const me = window.__session.user.id;

    tbody.innerHTML = users.map((u) => `
      <tr>
        <td>${escapeHTML(u.name || '(pending)')}</td>
        <td>${escapeHTML(u.email)}</td>
        <td><span class="badge badge-role-${u.role}">${u.role}${u.can_approve ? ' · approver' : ''}</span></td>
        <td><span class="badge ${u.active ? 'badge-active' : 'badge-inactive'}">${u.active ? 'Active' : 'Deactivated'}</span></td>
        <td>
          ${u.id === me || u.role === 'Owner' ? '' : `
            <button class="btn btn-sm btn-ghost" data-action="toggle-active" data-id="${u.id}" data-active="${u.active}">${u.active ? 'Deactivate' : 'Reactivate'}</button>
          `}
        </td>
      </tr>
    `).join('') || '<tr><td colspan="5" class="empty-note">No users yet.</td></tr>';

    tbody.querySelectorAll('[data-action="toggle-active"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const active = btn.dataset.active !== 'true';
        try {
          await fetchJSON(`${API}/users/${btn.dataset.id}/active`, { method: 'PATCH', body: JSON.stringify({ active }) });
          await loadUsersTable();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  async function renderActivity() {
    const target = document.getElementById('team-tab-content');
    const log = await fetchJSON(`${API}/users/activity-log`);
    target.innerHTML = `
      <div class="panel">
        <table class="data-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>
          ${log.map((l) => `<tr><td class="mono">${formatDate(l.created_at)}</td><td>${escapeHTML(l.user_email || 'system')}</td><td>${escapeHTML(l.action)}</td><td>${escapeHTML(l.detail)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-note">No activity yet.</td></tr>'}
        </tbody></table>
      </div>
    `;
  }

  window.ViewTeam = { render };
})();
