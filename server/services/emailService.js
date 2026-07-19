// Thin email abstraction. If SMTP_HOST/SMTP_USER/SMTP_PASS are set in env,
// sends real mail via nodemailer. Otherwise falls back to console logging so
// the app runs end-to-end without requiring an email provider to be
// configured first — swap in a real provider (Postmark/Resend/SendGrid SMTP,
// or Gmail SMTP for quick testing) by setting those three secrets.

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;

  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

async function sendEmail({ to, subject, text, html }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[email:stub] to=${to} subject="${subject}"\n${text || html}`);
    return { stubbed: true };
  }
  return t.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@stradigi-workforce.local',
    to,
    subject,
    text,
    html,
  });
}

module.exports = { sendEmail };
