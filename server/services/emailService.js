// Email abstraction — uses AgentMail (via Replit Connectors) when
// AGENTMAIL_INBOX_ID is set; otherwise falls back to SMTP (nodemailer) if
// SMTP_HOST/USER/PASS are present; otherwise stubs to console so the app
// runs without any email provider configured.

// ── AgentMail (preferred) ───────────────────────────────────────────────────
async function sendViaAgentMail({ to, subject, text, html }) {
  const { ReplitConnectors } = require('@replit/connectors-sdk');
  const connectors = new ReplitConnectors();
  const inboxId = encodeURIComponent(process.env.AGENTMAIL_INBOX_ID);

  // AgentMail expects `to` as a plain email string (or comma-separated string)
  const body = { to, subject };
  if (html) body.html = html;
  if (text) body.text = text;

  const response = await connectors.proxy(
    'agentmail',
    `/v0/inboxes/${inboxId}/messages/send`,
    { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`AgentMail error ${response.status}: ${err}`);
  }
  return response.json();
}

// ── SMTP / nodemailer (fallback) ────────────────────────────────────────────
let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  const nodemailer = require('nodemailer');
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return _transporter;
}

// ── Public API ──────────────────────────────────────────────────────────────
// Callers (signup, invites, password reset, ticket notifications, billing
// alerts) never check this for success — an email is a side effect of some
// other primary action, not the point of the request. Before this had a real
// provider behind it, that was safe by construction: the stub always
// "succeeded." Now that a real network call to a third-party API sits behind
// it, a provider hiccup, an unauthorized connector, or a bad inbox ID would
// throw and — since most call sites are inside the same try/catch as the
// primary action — take down signup/login-adjacent requests that have
// nothing to do with email. So failures are caught and logged here, once,
// rather than requiring every call site to guard against it individually.
async function sendEmail({ to, subject, text, html }) {
  try {
    if (process.env.AGENTMAIL_INBOX_ID) {
      return await sendViaAgentMail({ to, subject, text, html });
    }

    const t = getTransporter();
    if (t) {
      return await t.sendMail({
        from: process.env.SMTP_FROM || 'no-reply@stradigi-workforce.local',
        to,
        subject,
        text,
        html,
      });
    }

    console.log(`[email:stub] to=${to} subject="${subject}"\n${text || html}`);
    return { stubbed: true };
  } catch (err) {
    console.error(`[email] failed to send to=${to} subject="${subject}":`, err.message);
    return { failed: true, error: err.message };
  }
}

module.exports = { sendEmail };
