const nodemailer = require('nodemailer');

const APP_URL   = process.env.CLIENT_URL || 'https://soac.info';
const APP_LOGIN = `${APP_URL}/login`;

/* ─────────────────────────────────────────────────────────────────────────
   Priority 1 – Resend HTTP API  (set RESEND_API_KEY in Railway)
     Uses HTTPS port 443 — never blocked by any cloud provider.
     Free tier: 3 000 emails / month.
     Sign up at https://resend.com → API Keys → Create API Key
   Priority 2 – Gmail SMTP fallback
────────────────────────────────────────────────────────────────────────── */

/* ── Resend HTTP sender ──────────────────────────────────────────────────── */
async function sendViaResend({ to, subject, html }) {
  const from = process.env.EMAIL_FROM || 'SOAC <noreply@soac.info>';
  const res  = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Resend API error ${res.status}`);
  return data;
}

/* ── Gmail SMTP fallback ─────────────────────────────────────────────────── */
let _gmailTransport = null;
function getGmailTransport() {
  if (!_gmailTransport) {
    const gmailUser = process.env.SMTP_USER || 'mjjemba9@gmail.com';
    const gmailPass = (process.env.SMTP_PASS || 'yhzx logi zuug sylj').replace(/\s+/g, '');
    _gmailTransport = {
      transport: nodemailer.createTransport({
        host:   process.env.SMTP_HOST || 'smtp.gmail.com',
        port:   465,
        secure: true,
        auth:   { user: gmailUser, pass: gmailPass },
        tls:    { rejectUnauthorized: false },
        connectionTimeout: 10000,
        greetingTimeout:   10000,
        socketTimeout:     15000,
        /* Gmail rejects/drops connections once too many open at once from the
           same account — pool + a conservative rate cap keeps bulk sends
           (team-assignment emails, broadcasts) from tripping that limit. */
        pool:          true,
        maxConnections: 3,
        maxMessages:    100,
        rateDelta:      1000,
        rateLimit:      3,
      }),
      from: process.env.EMAIL_FROM || `SOAC RKU <${gmailUser}>`,
    };
  }
  return _gmailTransport;
}

/* Log which provider is active on boot */
if (process.env.RESEND_API_KEY) {
  console.log('✉️  Email provider: Resend HTTP API');
} else {
  console.log('✉️  Email provider: Gmail SMTP (fallback)');
}

/* ── Concurrency-limited, retrying send queue ────────────────────────────────
   Both providers reject/drop requests once too many go out at once (Resend's
   free-tier rate limit; Gmail's per-account concurrent-connection limit).
   Without this, bulk sends (e.g. team-assignment emails to 50+ students at
   once) blast every request in parallel via Promise.allSettled — the first
   few succeed and the provider starts rejecting the rest outright. Capping
   concurrency and retrying transient failures keeps the whole batch delivering
   instead of silently failing past the first handful. */
const MAX_CONCURRENT_SENDS = 2; // Resend's free tier is ~2 req/s; stay under it even when responses come back fast
const MAX_SEND_RETRIES     = 3; // 500ms, 1500ms, 4500ms backoff — rides out short-lived 429s
let _activeSends = 0;
const _sendQueue = [];

function _acquireSendSlot() {
  if (_activeSends < MAX_CONCURRENT_SENDS) {
    _activeSends++;
    return Promise.resolve();
  }
  return new Promise(resolve => _sendQueue.push(resolve));
}
function _releaseSendSlot() {
  _activeSends--;
  const next = _sendQueue.shift();
  if (next) { _activeSends++; next(); }
}
const _wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function _sendOnce({ to, subject, html }) {
  if (process.env.RESEND_API_KEY) {
    await sendViaResend({ to, subject, html });
  } else {
    const { transport, from } = getGmailTransport();
    await transport.sendMail({ from, to, subject, html });
  }
}

/* ── Shared send wrapper ─────────────────────────────────────────────────── */
async function send({ to, subject, html }) {
  await _acquireSendSlot();
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await _sendOnce({ to, subject, html });
        return;
      } catch (err) {
        if (attempt >= MAX_SEND_RETRIES) throw err;
        await _wait(500 * 3 ** attempt); // 500ms, then 1500ms
      }
    }
  } finally {
    _releaseSendSlot();
  }
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

/* Sent to each team member (at their registration email) once a coordinator declares
   groups/teams/fixtures for a sports event. Deliberately shows ONLY that student's own
   group + team + teammates — everything else (other teams, the bracket, full fixture
   list) requires logging in and opening the event, per the "log in to see the rest"
   design. */
const sendTeamAssignment = async ({ toEmail, toName, eventTitle, division, groupName, teamName, teammates = [] }) => {
  const liveScoresUrl = `${APP_URL}/events/live`;
  const teammatesList = teammates.map(n => `<li style="margin-bottom:4px">${n}</li>`).join('');
  await send({
    to:      toEmail,
    subject: `Your team for ${eventTitle} is set — SOAC RKU`,
    html: wrap(`
      ${header('#10b981,#059669')}
      <h2 style="color:#1a1040;margin-bottom:8px">Hi ${toName},</h2>
      <p style="color:#555;line-height:1.6">Groups, teams, and fixtures for <strong style="color:#059669">${eventTitle}</strong> have just been declared. Here's your team:</p>
      <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:20px 24px;margin:24px 0">
        ${division ? `<p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Division</p><p style="margin:0 0 16px;font-weight:700;color:#1a1040">${division}</p>` : ''}
        ${groupName ? `<p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Group</p><p style="margin:0 0 16px;font-weight:700;color:#1a1040">${groupName}</p>` : ''}
        <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Team</p>
        <p style="margin:0 0 16px;font-weight:800;color:#15803d;font-size:18px">${teamName}</p>
        <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Team Members</p>
        <ul style="margin:8px 0 0;padding-left:18px;color:#1a1040;font-weight:600">${teammatesList}</ul>
      </div>
      <p style="color:#555;line-height:1.6">Log in to your SOAC dashboard and open this event to see the other teams, groups, full fixture schedule, and bracket.</p>
      <div style="text-align:center;margin:24px 0">
        <a href="${liveScoresUrl}" style="display:inline-block;padding:12px 20px;background:#059669;color:#fff;text-decoration:none;border-radius:10px;font-weight:700">🔴 Watch Live Scores</a>
      </div>
      ${footer()}
    `),
  });
};

/* ── Diagnostic: send a test email, return { ok, via, error } ─────────────── */
const sendTestEmail = async (toEmail) => {
  const via = process.env.RESEND_API_KEY ? 'Resend' : 'Gmail';
  try {
    await send({
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
  sendTeamAssignment,
  sendTestEmail,
};
