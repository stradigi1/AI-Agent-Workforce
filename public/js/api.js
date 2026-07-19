// Shared fetch wrapper + auth/session helpers used by every page.
const API = '/api';

function getToken() { return localStorage.getItem('token'); }
function setToken(t) { localStorage.setItem('token', t); }
function clearSession() { localStorage.removeItem('token'); localStorage.removeItem('session'); }
function getSession() {
  try { return JSON.parse(localStorage.getItem('session') || 'null'); } catch { return null; }
}
function setSession(session) { localStorage.setItem('session', JSON.stringify(session)); }

async function fetchJSON(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...opts, headers });

  if (res.status === 401) {
    clearSession();
    if (!location.pathname.endsWith('login.html') && !location.pathname.endsWith('index.html') && location.pathname !== '/') {
      location.href = '/login.html';
    }
    throw new Error('Session expired — please log in again');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleString();
}

function requireAuth() {
  if (!getToken()) {
    location.href = '/login.html';
    return null;
  }
  return getSession();
}

function requireStradigiAuth() {
  const session = getSession();
  if (!getToken() || !session || session.user.user_type !== 'stradigi') {
    location.href = '/stradigi-login.html';
    return null;
  }
  return session;
}

// Applies a tenant's brand colors + logo to the page via CSS custom
// properties (see :root in css/style.css) — this is the mechanism behind
// Section 11's white-labeling.
function applyBranding(tenant) {
  if (!tenant) return;
  if (tenant.brand_primary_color) document.documentElement.style.setProperty('--brand', tenant.brand_primary_color);
  if (tenant.brand_secondary_color) document.documentElement.style.setProperty('--brand-2', tenant.brand_secondary_color);
  document.querySelectorAll('[data-tenant-name]').forEach((el) => { el.textContent = tenant.name; });
  document.querySelectorAll('[data-tenant-logo]').forEach((el) => {
    if (tenant.logo_url) el.innerHTML = `<img src="${escapeHTML(tenant.logo_url)}" alt="${escapeHTML(tenant.name)}" />`;
  });
}

let toastStack;
function toast(message, type = 'info') {
  if (!toastStack) {
    toastStack = document.createElement('div');
    toastStack.className = 'toast-stack';
    document.body.appendChild(toastStack);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  toastStack.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function logout() {
  clearSession();
  location.href = '/login.html';
}
