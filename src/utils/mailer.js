const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || 'procurement@drainpulse.local';
const PROCUREMENT_EMAIL = process.env.PROCUREMENT_EMAIL || 'procurement@drainpulse.local';

function createTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

async function sendEmail({ to, subject, text, html, attachments }) {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn('[EMAIL] No SMTP transport configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS to enable.');
    console.log(`[EMAIL] Would send to ${to}:\nSubject: ${subject}\n${text}`);
    return { accepted: [], rejected: [], skipped: true };
  }
  const info = await transporter.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    text,
    html,
    attachments
  });
  return info;
}

function getProcurementEmail() {
  return PROCUREMENT_EMAIL;
}

module.exports = { sendEmail, getProcurementEmail };
