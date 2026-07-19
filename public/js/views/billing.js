(function () {
  async function render(container) {
    const session = window.__session;
    if (!(session.user.role === 'Owner' || session.user.role === 'Admin')) {
      container.innerHTML = '<p class="empty-note">Only Owners and Admins can manage billing.</p>';
      return;
    }

    container.innerHTML = `
      <div class="view-header"><div><h2>Billing</h2><p>Subscription and usage for this workspace.</p></div></div>
      <div class="grid-2">
        <div class="panel">
          <h3 class="panel-title">Subscription</h3>
          <div id="billing-status"><p class="empty-note">Loading…</p></div>
        </div>
        <div class="panel">
          <h3 class="panel-title">AI Usage (this month)</h3>
          <div id="usage-summary"><p class="empty-note">Loading…</p></div>
        </div>
      </div>
    `;
    window.__refreshCurrentView = () => render(container);

    const [billing, usage] = await Promise.all([
      fetchJSON(`${API}/billing/status`).catch((e) => ({ error: e.message })),
      fetchJSON(`${API}/usage/summary`).catch((e) => ({ error: e.message })),
    ]);

    const statusEl = document.getElementById('billing-status');
    if (billing.error) {
      statusEl.innerHTML = `<div class="auth-error">${escapeHTML(billing.error)}</div>`;
    } else {
      statusEl.innerHTML = `
        <div class="detail-field"><label>Plan</label><div class="readonly-text">${escapeHTML(billing.plan)}</div></div>
        <div class="detail-field"><label>Status</label><span class="badge ${billing.subscriptionStatus === 'active' ? 'badge-active' : 'badge-inactive'}">${escapeHTML(billing.subscriptionStatus)}</span></div>
        <div class="detail-actions">
          ${billing.stripeConfigured ? `
            <button class="btn btn-primary" id="checkout-btn">Start / change subscription</button>
            ${billing.hasStripeCustomer ? '<button class="btn btn-ghost" id="portal-btn">Manage billing</button>' : ''}
          ` : '<p class="empty-note">Stripe is not configured yet — set STRIPE_SECRET_KEY.</p>'}
        </div>
      `;

      const checkoutBtn = document.getElementById('checkout-btn');
      if (checkoutBtn) checkoutBtn.addEventListener('click', async () => {
        const priceId = prompt('Stripe Price ID to subscribe to:');
        if (!priceId) return;
        try {
          const { url } = await fetchJSON(`${API}/billing/checkout-session`, { method: 'POST', body: JSON.stringify({ priceId }) });
          location.href = url;
        } catch (err) { toast(err.message, 'error'); }
      });
      const portalBtn = document.getElementById('portal-btn');
      if (portalBtn) portalBtn.addEventListener('click', async () => {
        try {
          const { url } = await fetchJSON(`${API}/billing/portal-session`, { method: 'POST' });
          location.href = url;
        } catch (err) { toast(err.message, 'error'); }
      });
    }

    const usageEl = document.getElementById('usage-summary');
    if (usage.error) {
      usageEl.innerHTML = `<div class="auth-error">${escapeHTML(usage.error)}</div>`;
    } else {
      const pct = usage.usageCapMonthlyTokens ? Math.min(100, Math.round((usage.monthToDateTokens / usage.usageCapMonthlyTokens) * 100)) : 0;
      usageEl.innerHTML = `
        <div class="detail-field"><label>Tokens used</label><div class="readonly-text">${usage.monthToDateTokens.toLocaleString()} / ${usage.usageCapMonthlyTokens.toLocaleString()} (${pct}%)</div></div>
        <div class="detail-field"><label>Estimated cost</label><div class="readonly-text">$${usage.monthToDateEstimatedCostUsd.toFixed(2)}</div></div>
        ${usage.capWarningActive ? '<div class="auth-error">Approaching your soft usage cap this month.</div>' : ''}
      `;
    }
  }

  window.ViewBilling = { render };
})();
