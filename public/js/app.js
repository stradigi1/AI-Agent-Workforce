(function () {
  const ROUTES = {
    dashboard: window.ViewDashboard,
    approvals: window.ViewApprovals,
    team: window.ViewTeam,
    tickets: window.ViewTickets,
    billing: window.ViewBilling,
    settings: window.ViewSettings,
  };

  async function init() {
    if (!requireAuth()) return;

    let me;
    try {
      me = await fetchJSON(`${API}/auth/me`);
    } catch {
      return; // fetchJSON already redirects to login on 401
    }

    window.__session = { user: me.user, tenant: me.tenant };
    setSession(window.__session);
    applyBranding(me.tenant);

    document.getElementById('tenant-plan-label').textContent = me.tenant ? `${me.tenant.plan} plan` : '';

    renderSidebar(me.user);
    renderUserMenu(me.user, me.impersonation);
    renderImpersonationBanner(me.impersonation);

    document.querySelectorAll('.nav-link').forEach((link) => {
      link.addEventListener('click', () => { location.hash = `#/${link.dataset.route}`; });
    });

    window.addEventListener('hashchange', route);
    route();

    setupNotifications();
    checkLegalAcceptance();

    if (me.user.role !== 'Owner' && me.user.role !== 'Admin' && !me.user.can_approve) {
      // Members still benefit from the support/billing chatbot.
    }
    initChatWidget('support');

    setInterval(refreshApprovalsBadge, 30000);
    refreshApprovalsBadge();
  }

  function renderSidebar(user) {
    const isOwnerOrAdmin = user.role === 'Owner' || user.role === 'Admin';
    const canApprove = user.role === 'Owner' || user.can_approve;

    document.querySelectorAll('.nav-link').forEach((link) => {
      const route = link.dataset.route;
      if (route === 'approvals' && !canApprove) link.classList.add('hidden');
      if ((route === 'team' || route === 'billing' || route === 'settings') && !isOwnerOrAdmin) link.classList.add('hidden');
    });
  }

  function renderUserMenu(user, impersonation) {
    const wrap = document.getElementById('user-menu-wrap');
    wrap.innerHTML = `
      <button class="user-menu-btn" id="user-menu-btn">${escapeHTML(user.name || user.email)} ▾</button>
      <div class="user-menu-dropdown hidden" id="user-menu-dropdown">
        <div style="padding:8px 10px;font-size:11.5px;color:var(--text-dimmer);">${escapeHTML(user.email)}<br/><span class="badge badge-role-${user.role}">${user.role}</span></div>
        ${impersonation ? '<button id="end-impersonation-btn">Stop impersonating</button>' : ''}
        <button id="logout-btn">Log out</button>
      </div>
    `;
    document.getElementById('user-menu-btn').addEventListener('click', () => {
      document.getElementById('user-menu-dropdown').classList.toggle('hidden');
    });
    document.getElementById('logout-btn').addEventListener('click', logout);

    const endImp = document.getElementById('end-impersonation-btn');
    if (endImp) endImp.addEventListener('click', async () => {
      try {
        const result = await fetchJSON(`${API}/admin/impersonate/end`, { method: 'POST' });
        setToken(result.token);
        location.href = '/admin.html';
      } catch (err) { toast(err.message, 'error'); }
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) document.getElementById('user-menu-dropdown')?.classList.add('hidden');
    });
  }

  function renderImpersonationBanner(impersonation) {
    const slot = document.getElementById('impersonation-banner-slot');
    if (!impersonation) { slot.innerHTML = ''; return; }
    slot.innerHTML = `
      <div class="impersonation-banner">
        You are viewing as ${escapeHTML(window.__session.user.email)} — Stradigi Admin session (${escapeHTML(impersonation.stradigiEmail)})
        <button id="banner-end-impersonation">End session</button>
      </div>
    `;
    document.getElementById('banner-end-impersonation').addEventListener('click', async () => {
      try {
        const result = await fetchJSON(`${API}/admin/impersonate/end`, { method: 'POST' });
        setToken(result.token);
        location.href = '/admin.html';
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  function setupNotifications() {
    const bellBtn = document.getElementById('notif-bell-btn');
    const dropdown = document.getElementById('notif-dropdown');

    bellBtn.addEventListener('click', async () => {
      dropdown.classList.toggle('hidden');
      if (dropdown.classList.contains('hidden')) return;
      const notifications = await fetchJSON(`${API}/notifications`);
      dropdown.innerHTML = notifications.length ? notifications.map((n) => `
        <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}" data-link="${n.link || ''}">
          <span class="notif-time">${formatDate(n.created_at)}</span>${escapeHTML(n.message)}
        </div>
      `).join('') : '<div class="empty-note" style="padding:10px;">No notifications yet.</div>';

      dropdown.querySelectorAll('.notif-item').forEach((item) => {
        item.addEventListener('click', async () => {
          await fetchJSON(`${API}/notifications/${item.dataset.id}/read`, { method: 'POST' });
          if (item.dataset.link) location.hash = item.dataset.link.replace(/^\/app\.html/, '');
          dropdown.classList.add('hidden');
          refreshApprovalsBadge();
        });
      });
      refreshApprovalsBadge();
    });

    document.addEventListener('click', (e) => {
      if (!document.getElementById('notif-wrap').contains(e.target)) dropdown.classList.add('hidden');
    });

    refreshApprovalsBadge();
  }

  async function refreshApprovalsBadge() {
    try {
      const { count } = await fetchJSON(`${API}/notifications/unread-count`);
      document.getElementById('notif-dot').classList.toggle('hidden', count === 0);
    } catch { /* non-fatal */ }

    try {
      const queue = await fetchJSON(`${API}/approvals`);
      const badge = document.getElementById('sidebar-approvals-count');
      if (queue.length > 0) { badge.textContent = queue.length; badge.classList.remove('hidden'); }
      else badge.classList.add('hidden');
    } catch { /* non-fatal, e.g. Member without approval nav visible */ }
  }

  async function checkLegalAcceptance() {
    let status;
    try {
      status = await fetchJSON(`${API}/legal/status/acceptance`);
    } catch { return; }

    if (status.tos.upToDate && status.privacy.upToDate) return;

    const overlay = document.getElementById('legal-reaccept-overlay');
    const content = document.getElementById('legal-reaccept-content');
    const toAccept = [];
    if (!status.tos.upToDate) toAccept.push('tos');
    if (!status.privacy.upToDate) toAccept.push('privacy');

    content.innerHTML = toAccept.map((docType) => `
      <div class="detail-field">
        <label>${docType === 'tos' ? 'Terms of Service' : 'Privacy Policy'}</label>
        <label class="auth-check"><input type="checkbox" class="legal-accept-check" data-doc="${docType}" /> I agree</label>
      </div>
    `).join('') + '<div class="detail-actions"><button class="btn btn-primary" id="legal-accept-btn" disabled>Continue</button></div>';

    const checks = content.querySelectorAll('.legal-accept-check');
    const acceptBtn = document.getElementById('legal-accept-btn');
    checks.forEach((c) => c.addEventListener('change', () => {
      acceptBtn.disabled = ![...checks].every((x) => x.checked);
    }));

    acceptBtn.addEventListener('click', async () => {
      for (const docType of toAccept) {
        await fetchJSON(`${API}/legal/${docType}/accept`, { method: 'POST' });
      }
      overlay.classList.add('hidden');
    });

    overlay.classList.remove('hidden');
  }

  function route() {
    const hash = location.hash.replace(/^#\//, '');
    const [routeName, ...params] = hash.split('/').filter(Boolean);
    const view = ROUTES[routeName] || ROUTES.dashboard;

    document.querySelectorAll('.nav-link').forEach((link) => {
      link.classList.toggle('active', link.dataset.route === (routeName || 'dashboard'));
    });

    const container = document.getElementById('view-container');
    view.render(container, params);
  }

  init();
})();
