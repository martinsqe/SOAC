const nodemailer = require('nodemailer');

const APP_URL    = process.env.CLIENT_URL || 'https://soac-txy7.vercel.app';
const APP_LOGIN  = `${APP_URL}/login`;

/* ─────────────────────────────────────────────────────────────────────────
   Transporter factory
   Priority 1 – Resend SMTP relay   (set RESEND_API_KEY in Railway)
     Uses Resend's dedicated servers — never blocked by cloud providers,
     excellent deliverability, free tier 3 000 emails / month.
     Get a free key at https://resend.com → API Keys → Create API Key
     Then add it as RESEND_API_KEY in Railway Variables.
   Priority 2 – Gmail SMTP          (works with app password)
     Uses the credentials already baked in as fallback.
────────────────────────────────────────────────────────────────────────── */
function buildTransporter() {
  if (process.env.RESEND_API_KEY) {
    return {
      transport: nodemailer.createTransport({
        host:   'smtp.resend.com',
        port:   587,
        secure: false,
        auth: {
          user: 'resend',
          pass: process.env.RESEND_API_KEY,
        },
        connectionTimeout: 10000,
        greetingTimeout:   10000,
        socketTimeout:     15000,
      }),
      from: process.env.EMAIL_FROM || 'SOAC RKU <onboarding@resend.dev>',
      via:  'Resend',
    };
  }

  // Gmail fallback — port 465 SSL (more cloud-provider friendly than 587 STARTTLS)
  const gmailUser = process.env.SMTP_USER || 'mjjemba9@gmail.com';
  const gmailPass = (process.env.SMTP_PASS || 'yhzx logi zuug sylj').replace(/\s+/g, '');
  return {
    transport: nodemailer.createTransport({
      host:   process.env.SMTP_HOST || 'smtp.gmail.com',
      port:   465,
      secure: true,
      auth:   { user: gmailUser, pass: gmailPass },
      tls:    { rejectUnauthorized: false },
      connectionTimeout: 10000,
      greetingTimeout:   10000,
      socketTimeout:     15000,
    }),
    from: process.env.EMAIL_FROM || `SOAC RKU <${gmailUser}>`,
    via:  'Gmail',
  };
}

let _cached = null;
function getMailer() {
  if (!_cached) _cached = buildTransporter();
  return _cached;
}

/* Verify on first boot */
(function verifyOnBoot() {
  const { transport, via } = buildTransporter();
  transport.verify()
    .then(() => console.log(`✉️  Email ready via ${via}`))
    .catch(err => console.warn(`⚠️  Email (${via}) verify failed: ${err.message}`));
})();

/* ── Shared send wrapper ─────────────────────────────────────────────────── */
async function send(opts) {
  const { transport, from } = getMailer();
  await transport.sendMail({ from, ...opts });
}

/* ── HTML header / footer helpers ────────────────────────────────────────── */
const header = (gradient = '#635BFF,#a78bfa') => `
  <div style="background:linear-gradient(135deg,${gradient});border-radius:12px;padding:20px 24px;margin-bottom:24px;text-align:center">
    <p style="margin:0;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px">SOAC · RK University</p>
    <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.7)">Student Organizations Advisory Council</p>
  </div>`;
const footer = () => `
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
  <p style="color:#bbb;font-size:12px">SOAC · Student Organizations Advisory Council · RK University</p>`;
const wrap = (body) => `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">${body}</div>`;

/* ═══════════════════════════════════════════════════════════════════════════
   Public email functions
═══════════════════════════════════════════════════════════════════════════ */

const sendCredentials = async ({ toEmail, toName, password, clubName = null }) => {
  const intro = clubName
    ? `<p style="color:#555;line-height:1.6">Your request to join <strong style="color:#635BFF">${clubName}</strong> has been approved. Use the credentials below to sign in.</p>`
    : `<p style="color:#555;line-height:1.6">Your SOAC RKU account has been created. Use the credentials below to sign in.</p>`;

  await send({
    to:      toEmail,
    subject: clubName ? `You're in! Welcome to ${clubName} — SOAC RKU` : 'Your SOAC RKU Account Credentials',
    html: wrap(`
      ${header()}
      <h2 style="color:#1a1040;margin-bottom:8px">Welcome, ${toName}!</h2>
      ${intro}
      <div style="background:#f8f7ff;border:1.5px solid #e8e5ff;border-radius:12px;padding:20px 24px;margin:24px 0">
        <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Login URL</p>
        <p style="margin:0 0 16px;font-weight:700;color:#635BFF">${APP_LOGIN}</p>
        <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Email</p>
        <p style="margin:0 0 16px;font-weight:700;color:#1a1040">${toEmail}</p>
        <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Temporary Password</p>
        <p style="margin:0;font-weight:800;color:#D32F2F;font-size:20px;letter-spacing:3px;font-family:monospace">${password}</p>
      </div>
      <p style="color:#888;font-size:13px;line-height:1.6">Please change your password after your first login. Students can join up to <strong>3 clubs</strong>.</p>
      ${footer()}
    `),
  });
};

const sendApproval = async ({ toEmail, toName, clubName }) => {
  await send({
    to:      toEmail,
    subject: `You're approved! Welcome to ${clubName} — SOAC RKU`,
    html: wrap(`
      ${header()}
      <h2 style="color:#1a1040;margin-bottom:8px">Congratulations, ${toName}!</h2>
      <p style="color:#555;line-height:1.6">Your request to join <strong style="color:#635BFF">${clubName}</strong> has been approved. You are now an official member!</p>
      <div style="background:#f0fff8;border:1.5px solid #86efac;border-radius:12px;padding:20px 24px;margin:24px 0;text-align:center">
        <p style="margin:0;font-size:16px;font-weight:800;color:#15803d">Member of ${clubName}</p>
        <p style="margin:6px 0 0;font-size:13px;color:#555">Log in to your SOAC dashboard to access your club and stay updated.</p>
      </div>
      ${footer()}
    `),
  });
};

const sendCoordinatorCredentials = async ({ toEmail, toName, password, clubName }) => {
  await send({
    to:      toEmail,
    subject: `You've been appointed Coordinator of ${clubName} — SOAC RKU`,
    html: wrap(`
      ${header('#4c44e0,#a78bfa')}
      <h2 style="color:#1a1040;margin-bottom:8px">Congratulations, ${toName}!</h2>
      <p style="color:#555;line-height:1.6">You have been appointed as <strong style="color:#4c44e0">Club Coordinator</strong> for <strong style="color:#4c44e0">${clubName}</strong> on the SOAC RKU Platform.</p>
      <div style="background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:12px;padding:20px 24px;margin:24px 0">
        <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Login URL</p>
        <p style="margin:0 0 16px;font-weight:700;color:#4c44e0">${APP_LOGIN}</p>
        <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Email</p>
        <p style="margin:0 0 16px;font-weight:700;color:#1a1040">${toEmail}</p>
        <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Temporary Password</p>
        <p style="margin:0;font-weight:800;color:#D32F2F;font-size:20px;letter-spacing:3px;font-family:monospace">${password}</p>
      </div>
      <p style="color:#888;font-size:13px;line-height:1.6">Please change your password after your first login using Profile settings.</p>
      ${footer()}
    `),
  });
};

const sendCoordinatorAssignment = async ({ toEmail, toName, clubName }) => {
  await send({
    to:      toEmail,
    subject: `You've been assigned as Coordinator of ${clubName} — SOAC RKU`,
    html: wrap(`
      ${header('#4c44e0,#a78bfa')}
      <h2 style="color:#1a1040;margin-bottom:8px">Hello, ${toName}!</h2>
      <p style="color:#555;line-height:1.6">You have been appointed as <strong style="color:#4c44e0">Club Coordinator</strong> for <strong style="color:#4c44e0">${clubName}</strong>.</p>
      <div style="background:#f0fff8;border:1.5px solid #86efac;border-radius:12px;padding:20px 24px;margin:24px 0;text-align:center">
        <p style="margin:0;font-size:16px;font-weight:800;color:#15803d">Coordinator of ${clubName}</p>
        <p style="margin:6px 0 0;font-size:13px;color:#555">Log in to your SOAC Coordinator Portal to manage your club, members, and events.</p>
      </div>
      <p style="color:#888;font-size:13px;line-height:1.6">Your existing credentials are unchanged. Visit <strong>${APP_LOGIN}</strong> to access your portal.</p>
      ${footer()}
    `),
  });
};

const sendPasswordReset = async ({ toEmail, toName, token }) => {
  const resetUrl = `${APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await send({
    to:      toEmail,
    subject: 'Reset your SOAC RKU password',
    html: wrap(`
      ${header()}
      <h2 style="color:#1a1040;margin-bottom:8px">Password reset request</h2>
      <p style="color:#555;line-height:1.6">Hi ${toName || 'there'}, we received a request to reset your SOAC account password.</p>
      <div style="background:#f8f7ff;border:1.5px solid #e8e5ff;border-radius:12px;padding:20px 24px;margin:24px 0;text-align:center">
        <a href="${resetUrl}" style="display:inline-block;padding:12px 20px;background:#635BFF;color:#fff;text-decoration:none;border-radius:10px;font-weight:700">Reset Password</a>
        <p style="margin:14px 0 0;font-size:12px;color:#6b7280;line-height:1.6">This link expires in 30 minutes. If the button does not work, copy and paste:</p>
        <p style="margin:8px 0 0;font-size:12px;color:#4f46e5;word-break:break-all">${resetUrl}</p>
      </div>
      <p style="color:#888;font-size:13px;line-height:1.6">If you did not request this, you can safely ignore this email.</p>
      ${footer()}
    `),
  });
};

/* ── Diagnostic: send a test email, return { ok, via, error } ─────────────── */
const sendTestEmail = async (toEmail) => {
  // Always build a fresh transporter for the test (not the cached one)
  const { transport, from, via } = buildTransporter();
  try {
    await transport.verify();
    await transport.sendMail({
      from,
      to:      toEmail,
      subject: 'SOAC Email Test',
      html:    wrap(`${header()}<h2 style="color:#1a1040">Email is working!</h2><p style="color:#555">This test email confirms SOAC can send emails via <strong>${via}</strong>.</p>${footer()}`),
    });
    return { ok: true, via };
  } catch (err) {
    return { ok: false, via, error: err.message };
  }
};

module.exports = {
  sendCredentials,
  sendApproval,
  sendCoordinatorCredentials,
  sendCoordinatorAssignment,
  sendPasswordReset,
  sendTestEmail,
};
