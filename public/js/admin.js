(function () {
  const ROUTES = { tenants: renderTenants, tickets: renderTickets, staff: renderStaff };

  async function init() {
    const session = requireStradigiAuth();
    if (!session) return;
    window.__session = session;

    renderUserMenu(session.user);
    if (session.user.role !== 'StradigiAdmin') {
      document.querySelector('[data-route="staff"]').classList.add('hidden');
    }

    document.querySelectorAll('.nav-link').forEach((link) => {
      link.addEventListener('click', () => { location.hash = `#/${link.dataset.route}`; });
    });
    document.getElementById('overlay-close').addEventListener('click', closeOverlay);

    window.addEventListener('hashchange', route);
    route();
  }

  function renderUserMenu(user) {
    const wrap = document.getElementById('user-menu-wrap');
    wrap.innerHTML = `
      <button class="user-menu-btn" id="user-menu-btn">${escapeHTML(user.name || user.email)} ▾</button>
      <div class="user-menu-dropdown hidden" id="user-menu-dropdown">
        <div style="padding:8px 10px;font-size:11.5px;color:var(--text-dimmer);">${escapeHTML(user.email)}<br/><span class="badge badge-role-${user.role}">${user.role}</span></div>
        <button id="logout-btn">Log out</button>
      </div>
    `;
    document.getElementById('user-menu-btn').addEventListener('click', () => document.getElementById('user-menu-dropdown').classList.toggle('hidden'));
    document.getElementById('logout-btn').addEventListener('click', logout);
  }

  function route() {
    const hash = location.hash.replace(/^#\//, '');
    const [routeName, ...params] = hash.split('/').filter(Boolean);
    const fn = ROUTES[routeName] || ROUTES.tenants;

    document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.route === (routeName || 'tenants')));
    fn(document.getElementById('view-container'), params);
  }

  function openOverlay(html) {
    document.getElementById('detail-content').innerHTML = html;
    document.getElementById('detail-overlay').classList.remove('hidden');
  }
  function closeOverlay() { document.getElementById('detail-overlay').classList.add('hidden'); }

  // ---------- Tenants ----------
  async function renderTenants(container) {
    container.innerHTML = `
      <div class="view-header">
        <div><h2>Tenants</h2><p>Every provisioned company workspace.</p></div>
        <button class="btn btn-primary" id="provision-btn">Provision new tenant</button>
      </div>
      <div class="panel">
        <table class="data-table"><thead><tr><th>Name</th><th>Slug</th><th>Plan</th><th>Status</th><th>Subscription</th><th></th></tr></thead>
        <tbody id="tenants-tbody"><tr><td colspan="6" class="empty-note">Loading…</td></tr></tbody></table>
      </div>
    `;

    document.getElementById('provision-btn').addEventListener('click', openProvisionModal);

    const tenants = await fetchJSON(`${API}/admin/tenants`);
    document.getElementById('tenants-tbody').innerHTML = tenants.map((t) => `
      <tr style="cursor:pointer;" data-id="${t.id}">
        <td>${escapeHTML(t.name)}</td>
        <td class="mono">${escapeHTML(t.slug)}</td>
        <td>${escapeHTML(t.plan)}</td>
        <td><span class="badge ${t.status === 'active' ? 'badge-active' : 'badge-inactive'}">${t.status}</span></td>
        <td>${escapeHTML(t.subscription_status)}</td>
        <td><button class="btn btn-sm" data-view="${t.id}">Open</button></td>
      </tr>
    `).join('') || '<tr><td colspan="6" class="empty-note">No tenants yet.</td></tr>';

    document.querySelectorAll('[data-view]').forEach((btn) => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTenantDetail(btn.dataset.view);
    }));
  }

  function openProvisionModal() {
    openOverlay(`
      <h3>Provision a new tenant</h3>
      <form id="provision-form">
        <div class="detail-field"><label>Company name</label><input type="text" id="p-company" required /></div>
        <div class="detail-field"><label>Owner email</label><input type="email" id="p-email" required /></div>
        <div class="detail-field"><label>Owner name</label><input type="text" id="p-name" /></div>
        <div class="detail-actions"><button type="submit" class="btn btn-primary">Provision</button></div>
      </form>
    `);
    document.getElementById('provision-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchJSON(`${API}/admin/tenants`, {
          method: 'POST',
          body: JSON.stringify({
            companyName: document.getElementById('p-company').value.trim(),
            ownerEmail: document.getElementById('p-email').value.trim(),
            ownerName: document.getElementById('p-name').value.trim(),
          }),
        });
        toast('Tenant provisioned — invite email sent to the owner', 'success');
        closeOverlay();
        route();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  async function openTenantDetail(tenantId) {
    const [tenant, users, usage, impLog] = await Promise.all([
      fetchJSON(`${API}/admin/tenants/${tenantId}`),
      fetchJSON(`${API}/admin/tenants/${tenantId}/users`),
      fetchJSON(`${API}/admin/tenants/${tenantId}/usage`),
      fetchJSON(`${API}/admin/tenants/${tenantId}/impersonation-log`),
    ]);

    openOverlay(`
      <h3>${escapeHTML(tenant.name)} <span class="mono" style="font-size:12px;color:var(--text-dimmer);">${escapeHTML(tenant.slug)}</span></h3>
      <div class="detail-field"><label>Status</label>
        <select id="tenant-status">
          ${['active', 'suspended', 'pending_deletion'].map((s) => `<option ${s === tenant.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="detail-field"><label>Subscription</label><div class="readonly-text">${escapeHTML(tenant.subscription_status)} · ${escapeHTML(tenant.plan)}</div></div>
      <div class="detail-field"><label>Usage this month</label><div class="readonly-text">${Number(usage.totalTokens).toLocaleString()} tokens · $${Number(usage.totalCost).toFixed(2)} est.</div></div>
      <div class="detail-field">
        <label>Users (click to impersonate)</label>
        ${users.map((u) => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">
            <span>${escapeHTML(u.name || u.email)} <span class="badge badge-role-${u.role}">${u.role}</span></span>
            ${window.__session.user.role === 'StradigiAdmin' ? `<button class="btn btn-sm" data-impersonate="${u.id}">Impersonate</button>` : ''}
          </div>
        `).join('') || '<p class="empty-note">No users yet.</p>'}
      </div>
      <div class="detail-field">
        <label>Impersonation log</label>
        ${impLog.map((l) => `<div class="mono" style="font-size:11px;color:var(--text-dimmer);">${formatDate(l.started_at)} — ${escapeHTML(l.stradigi_email)} as ${escapeHTML(l.target_email)}${l.ended_at ? ` (ended ${formatDate(l.ended_at)})` : ' (active)'}</div>`).join('') || '<p class="empty-note">None yet.</p>'}
      </div>
      <div class="detail-actions">
        ${window.__session.user.role === 'StradigiAdmin' ? '<button class="btn btn-primary" id="save-tenant-status">Save status</button>' : ''}
      </div>
    `);

    const saveBtn = document.getElementById('save-tenant-status');
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      try {
        await fetchJSON(`${API}/admin/tenants/${tenantId}/status`, { method: 'PATCH', body: JSON.stringify({ status: document.getElementById('tenant-status').value }) });
        toast('Tenant status updated', 'success');
        closeOverlay();
        route();
      } catch (err) { toast(err.message, 'error'); }
    });

    document.querySelectorAll('[data-impersonate]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!confirm('Start an impersonation session? This is fully logged.')) return;
      try {
        const result = await fetchJSON(`${API}/admin/impersonate/start`, {
          method: 'POST',
          body: JSON.stringify({ tenantId, targetUserId: btn.dataset.impersonate }),
        });
        setToken(result.token);
        setSession({ user: result.user, tenant: null });
        location.href = '/app.html';
      } catch (err) { toast(err.message, 'error'); }
    }));
  }

  // ---------- Cross-tenant tickets ----------
  async function renderTickets(container) {
    container.innerHTML = `
      <div class="view-header"><div><h2>Support Tickets</h2><p>Across every tenant.</p></div></div>
      <div class="panel">
        <table class="data-table"><thead><tr><th>Tenant</th><th>Subject</th><th>Severity</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody id="tickets-tbody"><tr><td colspan="5" class="empty-note">Loading…</td></tr></tbody></table>
      </div>
    `;
    const tickets = await fetchJSON(`${API}/admin/tickets`);
    document.getElementById('tickets-tbody').innerHTML = tickets.map((t) => `
      <tr style="cursor:pointer;" data-id="${t.id}">
        <td>${escapeHTML(t.tenant_name)}</td>
        <td>${escapeHTML(t.subject)}</td>
        <td>${escapeHTML(t.severity)}</td>
        <td><span class="badge ${t.status === 'Resolved' ? 'badge-active' : 'badge-inactive'}">${t.status}</span></td>
        <td class="mono">${formatDate(t.updated_at)}</td>
      </tr>
    `).join('') || '<tr><td colspan="5" class="empty-note">No tickets yet.</td></tr>';

    document.querySelectorAll('#tickets-tbody tr[data-id]').forEach((row) => row.addEventListener('click', () => openTicketDetail(row.dataset.id)));
  }

  async function openTicketDetail(ticketId) {
    const { ticket, messages } = await fetchJSON(`${API}/admin/tickets/${ticketId}`);
    openOverlay(`
      <h3>${escapeHTML(ticket.subject)} <span class="mono" style="font-size:11px;color:var(--text-dimmer);">${escapeHTML(ticket.tenant_name)}</span></h3>
      <div class="detail-field"><label>Status</label>
        <select id="ticket-status">${['Open', 'In Progress', 'Resolved'].map((s) => `<option ${s === ticket.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
      </div>
      <div class="detail-field"><label>Description</label><div class="readonly-text">${escapeHTML(ticket.description)}</div></div>
      <div class="detail-field"><label>Conversation</label>
        <div id="admin-ticket-messages" style="display:flex;flex-direction:column;gap:8px;">
          ${messages.map((m) => `<div style="padding:8px 10px;border-radius:7px;background:${m.sender_type === 'stradigi' ? 'var(--brand)22' : 'var(--bg)'};border:1px solid var(--border);font-size:12.5px;">${escapeHTML(m.message)}</div>`).join('') || '<p class="empty-note">No messages yet.</p>'}
        </div>
      </div>
      <form id="admin-reply-form" style="display:flex;gap:8px;margin-top:10px;">
        <input type="text" id="admin-reply-input" placeholder="Reply to the tenant…" style="flex:1;" />
        <button type="submit" class="btn btn-primary">Send</button>
      </form>
      <div class="detail-actions"><button class="btn btn-primary" id="save-ticket-status">Save status</button></div>
    `);

    document.getElementById('save-ticket-status').addEventListener('click', async () => {
      try {
        await fetchJSON(`${API}/admin/tickets/${ticketId}/status`, { method: 'PATCH', body: JSON.stringify({ status: document.getElementById('ticket-status').value }) });
        toast('Status updated', 'success');
        closeOverlay();
        route();
      } catch (err) { toast(err.message, 'error'); }
    });

    document.getElementById('admin-reply-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('admin-reply-input');
      if (!input.value.trim()) return;
      try {
        await fetchJSON(`${API}/admin/tickets/${ticketId}/messages`, { method: 'POST', body: JSON.stringify({ message: input.value.trim() }) });
        openTicketDetail(ticketId);
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  // ---------- Stradigi staff ----------
  async function renderStaff(container) {
    if (window.__session.user.role !== 'StradigiAdmin') {
      container.innerHTML = '<p class="empty-note">Only Stradigi Admins can manage staff accounts.</p>';
      return;
    }
    container.innerHTML = `
      <div class="view-header"><div><h2>Stradigi Staff</h2><p>Internal accounts with cross-tenant access.</p></div></div>
      <div class="panel">
        <form id="staff-form" class="grid-2">
          <label>Email <input type="email" id="s-email" required /></label>
          <label>Name <input type="text" id="s-name" /></label>
          <label>Role <select id="s-role"><option value="StradigiSupport">Stradigi Support</option><option value="StradigiAdmin">Stradigi Admin</option></select></label>
          <label>Password <input type="password" id="s-password" required minlength="8" /></label>
          <button type="submit" class="btn btn-primary" style="grid-column:1/-1;">Create staff account</button>
        </form>
      </div>
      <div class="panel">
        <table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody id="staff-tbody"></tbody></table>
      </div>
    `;
    document.getElementById('staff-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchJSON(`${API}/admin/staff`, {
          method: 'POST',
          body: JSON.stringify({
            email: document.getElementById('s-email').value.trim(),
            name: document.getElementById('s-name').value.trim(),
            role: document.getElementById('s-role').value,
            password: document.getElementById('s-password').value,
          }),
        });
        toast('Staff account created', 'success');
        e.target.reset();
        await loadStaffTable();
      } catch (err) { toast(err.message, 'error'); }
    });
    await loadStaffTable();
  }

  async function loadStaffTable() {
    const staff = await fetchJSON(`${API}/admin/staff`);
    document.getElementById('staff-tbody').innerHTML = staff.map((s) => `
      <tr><td>${escapeHTML(s.name || '')}</td><td>${escapeHTML(s.email)}</td><td><span class="badge badge-role-${s.role}">${s.role}</span></td></tr>
    `).join('') || '<tr><td colspan="3" class="empty-note">No staff yet.</td></tr>';
  }

  init();
})();
