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
async function sendEmail({ to, subject, text, html }) {
  // 1. AgentMail
  if (process.env.AGENTMAIL_INBOX_ID) {
    return sendViaAgentMail({ to, subject, text, html });
  }

  // 2. SMTP
  const t = getTransporter();
  if (t) {
    return t.sendMail({
      from: process.env.SMTP_FROM || 'no-reply@stradigi-workforce.local',
      to,
      subject,
      text,
      html,
    });
  }

  // 3. Stub
  console.log(`[email:stub] to=${to} subject="${subject}"\n${text || html}`);
  return { stubbed: true };
}

module.exports = { sendEmail };
