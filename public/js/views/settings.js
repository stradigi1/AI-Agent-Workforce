(function () {
  let activeTab = 'branding';

  async function render(container) {
    const session = window.__session;
    if (!(session.user.role === 'Owner' || session.user.role === 'Admin')) {
      container.innerHTML = '<p class="empty-note">Only Owners and Admins can change settings.</p>';
      return;
    }

    container.innerHTML = `
      <div class="view-header"><div><h2>Settings</h2><p>Branding, departments, agent prompts, limits, and data.</p></div></div>
      <div class="tabs">
        <button class="tab-btn ${activeTab === 'branding' ? 'active' : ''}" data-tab="branding">Branding</button>
        <button class="tab-btn ${activeTab === 'departments' ? 'active' : ''}" data-tab="departments">Departments</button>
        <button class="tab-btn ${activeTab === 'prompts' ? 'active' : ''}" data-tab="prompts">Agent Prompts</button>
        <button class="tab-btn ${activeTab === 'limits' ? 'active' : ''}" data-tab="limits">Usage &amp; Limits</button>
        <button class="tab-btn ${activeTab === 'data' ? 'active' : ''}" data-tab="data">Data &amp; Privacy</button>
      </div>
      <div id="settings-tab-content"></div>
    `;
    window.__refreshCurrentView = () => render(container);

    container.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => { activeTab = btn.dataset.tab; render(container); });
    });

    const renderers = { branding: renderBranding, departments: renderDepartments, prompts: renderPrompts, limits: renderLimits, data: renderData };
    await renderers[activeTab]();
  }

  async function renderBranding() {
    const target = document.getElementById('settings-tab-content');
    const branding = await fetchJSON(`${API}/tenants/branding`);
    target.innerHTML = `
      <div class="panel">
        <form id="branding-form">
          <label>Company name <input type="text" id="b-name" value="${escapeHTML(branding.name)}" /></label>
          <label>Logo URL <input type="text" id="b-logo" value="${escapeHTML(branding.logoUrl || '')}" placeholder="https://…" /></label>
          <label>Primary color
            <div class="color-swatch-input"><input type="color" id="b-primary" value="${branding.brandPrimaryColor}" /><span class="mono">${branding.brandPrimaryColor}</span></div>
          </label>
          <label>Secondary color
            <div class="color-swatch-input"><input type="color" id="b-secondary" value="${branding.brandSecondaryColor}" /><span class="mono">${branding.brandSecondaryColor}</span></div>
          </label>
          <button type="submit" class="btn btn-primary">Save branding</button>
        </form>
      </div>
    `;
    document.getElementById('branding-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const updated = await fetchJSON(`${API}/tenants/branding`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: document.getElementById('b-name').value.trim(),
            logoUrl: document.getElementById('b-logo').value.trim(),
            brandPrimaryColor: document.getElementById('b-primary').value,
            brandSecondaryColor: document.getElementById('b-secondary').value,
          }),
        });
        applyBranding(updated);
        toast('Branding updated', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  async function renderDepartments() {
    const target = document.getElementById('settings-tab-content');
    const departments = await fetchJSON(`${API}/tenants/departments`);
    target.innerHTML = `
      <div class="panel">
        ${departments.map((d) => `
          <div style="margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--border);">
            <strong>${escapeHTML(d.name)}</strong>
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">
              ${d.specialistRoles.map((r) => `<span class="badge badge-inactive">${escapeHTML(r.name)}</span>`).join('') || '<span class="empty-note">No specialist roles yet</span>'}
            </div>
            <form data-dept-id="${d.id}" class="add-role-form" style="margin-top:10px;display:flex;gap:8px;">
              <input type="text" placeholder="New specialist role name" style="flex:1;margin-top:0;" required />
              <button type="submit" class="btn btn-sm">Add role</button>
            </form>
          </div>
        `).join('')}
        <form id="add-dept-form" style="display:flex;gap:8px;">
          <input type="text" id="new-dept-name" placeholder="New department name" style="flex:1;margin-top:0;" required />
          <button type="submit" class="btn btn-primary btn-sm">Add department</button>
        </form>
      </div>
    `;

    target.querySelectorAll('.add-role-form').forEach((form) => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = form.querySelector('input').value.trim();
        try {
          await fetchJSON(`${API}/tenants/departments/${form.dataset.deptId}/specialist-roles`, { method: 'POST', body: JSON.stringify({ name }) });
          await renderDepartments();
        } catch (err) { toast(err.message, 'error'); }
      });
    });

    document.getElementById('add-dept-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('new-dept-name').value.trim();
      const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      try {
        await fetchJSON(`${API}/tenants/departments`, { method: 'POST', body: JSON.stringify({ key, name }) });
        await renderDepartments();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  async function renderPrompts() {
    const target = document.getElementById('settings-tab-content');
    const prompts = await fetchJSON(`${API}/tenants/prompts`);
    target.innerHTML = `
      <div class="panel">
        <p class="panel-hint">These are the live system prompts driving each agent tier — editable without a redeploy.</p>
        ${prompts.map((p) => `
          <div class="detail-field">
            <label>${p.tier}${p.department_name ? ` — ${escapeHTML(p.department_name)}` : ''}</label>
            <textarea rows="6" data-tier="${p.tier}" data-dept-id="${p.department_id || ''}" class="prompt-textarea">${escapeHTML(p.system_prompt)}</textarea>
            <button class="btn btn-sm save-prompt-btn" style="margin-top:8px;">Save</button>
          </div>
        `).join('')}
      </div>
    `;
    target.querySelectorAll('.save-prompt-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const textarea = btn.previousElementSibling;
        try {
          await fetchJSON(`${API}/tenants/prompts`, {
            method: 'PUT',
            body: JSON.stringify({ tier: textarea.dataset.tier, departmentId: textarea.dataset.deptId || null, systemPrompt: textarea.value }),
          });
          toast('Prompt saved', 'success');
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  async function renderLimits() {
    const target = document.getElementById('settings-tab-content');
    const usage = await fetchJSON(`${API}/usage/summary`);
    target.innerHTML = `
      <div class="panel">
        <form id="limits-form">
          <label>Monthly soft usage cap (tokens) <input type="number" id="l-cap" value="${usage.usageCapMonthlyTokens}" min="0" /></label>
          <label>Specialist concurrency cap <input type="number" id="l-concurrency" value="${usage.specialistConcurrencyCap}" min="1" max="10" /></label>
          <button type="submit" class="btn btn-primary">Save limits</button>
        </form>
      </div>
    `;
    document.getElementById('limits-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchJSON(`${API}/tenants/limits`, {
          method: 'PATCH',
          body: JSON.stringify({
            usageCapMonthlyTokens: Number(document.getElementById('l-cap').value),
            specialistConcurrencyCap: Number(document.getElementById('l-concurrency').value),
          }),
        });
        toast('Limits updated', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  async function renderData() {
    const target = document.getElementById('settings-tab-content');
    const history = await fetchJSON(`${API}/legal/data-request/history`);
    target.innerHTML = `
      <div class="panel">
        <h3 class="panel-title">Export your data</h3>
        <p class="panel-hint">Downloads all tasks, users, and tickets scoped to this workspace as JSON.</p>
        <button class="btn btn-primary" id="export-btn">Export data</button>
      </div>
      <div class="panel">
        <h3 class="panel-title">Delete this workspace</h3>
        <p class="panel-hint">Submits a deletion request to Stradigi staff — not instant, so billing can be reconciled first.</p>
        <button class="btn btn-danger" id="delete-btn">Request deletion</button>
      </div>
      <div class="panel">
        <h3 class="panel-title">Request history</h3>
        <table class="data-table"><thead><tr><th>Type</th><th>Status</th><th>Requested</th></tr></thead>
        <tbody>${history.map((h) => `<tr><td>${h.type}</td><td>${h.status}</td><td class="mono">${formatDate(h.created_at)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty-note">None yet.</td></tr>'}</tbody></table>
      </div>
    `;

    document.getElementById('export-btn').addEventListener('click', async () => {
      try {
        const data = await fetchJSON(`${API}/legal/data-request/export`, { method: 'POST' });
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `workspace-export-${Date.now()}.json`;
        a.click();
        toast('Export downloaded', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });

    document.getElementById('delete-btn').addEventListener('click', async () => {
      if (!confirm('Request deletion of this entire workspace? Stradigi staff will follow up before anything is removed.')) return;
      try {
        await fetchJSON(`${API}/legal/data-request/deletion`, { method: 'POST' });
        toast('Deletion request submitted', 'success');
        await renderData();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  window.ViewSettings = { render };
})();
