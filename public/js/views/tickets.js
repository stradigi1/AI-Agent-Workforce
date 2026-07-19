(function () {
  async function render(container, params) {
    if (params && params[0]) return renderThread(container, params[0]);
    return renderList(container);
  }

  async function renderList(container) {
    container.innerHTML = `
      <div class="view-header">
        <div><h2>Support</h2><p>Submit a ticket or check on one you already sent.</p></div>
        <button class="btn btn-primary" id="new-ticket-btn">New ticket</button>
      </div>
      <div class="panel">
        <table class="data-table"><thead><tr><th>Subject</th><th>Category</th><th>Severity</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody id="tickets-tbody"><tr><td colspan="5" class="empty-note">Loading…</td></tr></tbody></table>
      </div>
    `;
    window.__refreshCurrentView = () => renderList(container);

    document.getElementById('new-ticket-btn').addEventListener('click', () => openNewTicketModal());

    const tickets = await fetchJSON(`${API}/tickets`);
    const tbody = document.getElementById('tickets-tbody');
    tbody.innerHTML = tickets.length ? tickets.map((t) => `
      <tr style="cursor:pointer;" data-id="${t.id}">
        <td>${escapeHTML(t.subject)}</td>
        <td>${escapeHTML(t.category)}</td>
        <td>${escapeHTML(t.severity)}</td>
        <td><span class="badge ${t.status === 'Resolved' ? 'badge-active' : 'badge-inactive'}">${t.status}</span></td>
        <td class="mono">${formatDate(t.updated_at)}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="empty-note">No tickets yet.</td></tr>';

    tbody.querySelectorAll('tr[data-id]').forEach((row) => {
      row.addEventListener('click', () => { location.hash = `#/tickets/${row.dataset.id}`; });
    });
  }

  function openNewTicketModal() {
    const overlay = document.getElementById('task-detail-overlay');
    const content = document.getElementById('task-detail-content');
    content.innerHTML = `
      <h3>New support ticket</h3>
      <form id="new-ticket-form">
        <div class="detail-field"><label>Subject</label><input type="text" id="ticket-subject" required /></div>
        <div class="detail-field"><label>Description</label><textarea id="ticket-description" rows="4" required></textarea></div>
        <div class="detail-field"><label>Category</label>
          <select id="ticket-category"><option value="general">General</option><option value="bug">Bug</option><option value="billing">Billing</option></select>
        </div>
        <div class="detail-field"><label>Severity</label>
          <select id="ticket-severity"><option value="low">Low</option><option value="normal" selected>Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select>
        </div>
        <div class="detail-actions">
          <button type="submit" class="btn btn-primary">Submit</button>
          <button type="button" class="btn btn-ghost" id="cancel-new-ticket">Cancel</button>
        </div>
      </form>
    `;
    overlay.classList.remove('hidden');
    document.getElementById('cancel-new-ticket').addEventListener('click', () => overlay.classList.add('hidden'));
    document.getElementById('new-ticket-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchJSON(`${API}/tickets`, {
          method: 'POST',
          body: JSON.stringify({
            subject: document.getElementById('ticket-subject').value.trim(),
            description: document.getElementById('ticket-description').value.trim(),
            category: document.getElementById('ticket-category').value,
            severity: document.getElementById('ticket-severity').value,
          }),
        });
        toast('Ticket submitted — we\'ll follow up soon', 'success');
        overlay.classList.add('hidden');
        if (window.__refreshCurrentView) window.__refreshCurrentView();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  async function renderThread(container, ticketId) {
    container.innerHTML = '<p class="empty-note">Loading…</p>';
    let data;
    try {
      data = await fetchJSON(`${API}/tickets/${ticketId}`);
    } catch (err) {
      container.innerHTML = `<div class="auth-error">${escapeHTML(err.message)}</div>`;
      return;
    }
    window.__refreshCurrentView = () => renderThread(container, ticketId);

    const { ticket, messages } = data;
    container.innerHTML = `
      <div class="view-header">
        <div><h2>${escapeHTML(ticket.subject)}</h2><p>${escapeHTML(ticket.category)} · ${escapeHTML(ticket.severity)} · <span class="badge ${ticket.status === 'Resolved' ? 'badge-active' : 'badge-inactive'}">${ticket.status}</span></p></div>
        <a class="btn btn-ghost" href="#/tickets">Back to list</a>
      </div>
      <div class="panel">
        <div class="detail-field"><label>Original description</label><div class="readonly-text">${escapeHTML(ticket.description)}</div></div>
        <div class="detail-field"><label>Conversation</label>
          <div id="ticket-messages" style="display:flex;flex-direction:column;gap:10px;"></div>
        </div>
        <form id="reply-form" style="display:flex;gap:8px;">
          <input type="text" id="reply-message" placeholder="Add a reply…" style="flex:1;" />
          <button type="submit" class="btn btn-primary">Send</button>
        </form>
      </div>
    `;

    const msgWrap = document.getElementById('ticket-messages');
    msgWrap.innerHTML = messages.map((m) => `
      <div style="padding:9px 12px;border-radius:8px;background:${m.sender_type === 'stradigi' ? 'var(--bg)' : '#5B8FA822'};border:1px solid var(--border);">
        <div class="mono" style="font-size:10.5px;color:var(--text-dimmer);margin-bottom:4px;">${m.sender_type === 'stradigi' ? 'Support' : escapeHTML(m.sender_name || m.sender_email || 'You')} · ${formatDate(m.created_at)}</div>
        ${escapeHTML(m.message)}
      </div>
    `).join('') || '<p class="empty-note">No replies yet.</p>';

    document.getElementById('reply-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('reply-message');
      const message = input.value.trim();
      if (!message) return;
      try {
        await fetchJSON(`${API}/tickets/${ticketId}/messages`, { method: 'POST', body: JSON.stringify({ message }) });
        input.value = '';
        await renderThread(container, ticketId);
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  window.ViewTickets = { render };
})();
