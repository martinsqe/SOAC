const nodemailer   = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');

const APP_URL   = process.env.CLIENT_URL || 'https://soac.info';
const APP_LOGIN = `${APP_URL}/login`;

/* Optional Reply-To. Unset → replies go to the sending account itself. */
const REPLY_TO = process.env.EMAIL_REPLY_TO || undefined;

/* ─────────────────────────────────────────────────────────────────────────
   Priority 1 – Gmail API (Google Workspace account, e.g. soac@rku.ac.in)
     Sends over HTTPS port 443, so it works on hosts that block SMTP (Railway).
     Needs GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN —
     run `node scripts/gmail-auth.js` once to get the refresh token.
   Priority 2 – SMTP fallback (only if SMTP_USER + SMTP_PASS are set)
────────────────────────────────────────────────────────────────────────── */
const GMAIL_USER = process.env.GMAIL_USER || process.env.SMTP_USER;
const FROM = process.env.EMAIL_FROM || `SOAC RKU <${GMAIL_USER}>`;

const hasGmailApi = !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET
  && process.env.GMAIL_REFRESH_TOKEN && GMAIL_USER);
const hasSmtp = !!(process.env.SMTP_USER && process.env.SMTP_PASS);

/* ── Gmail API sender ────────────────────────────────────────────────────── */
let _gmailAccessToken = null;
let _gmailTokenExpiresAt = 0;

async function getGmailAccessToken() {
  if (_gmailAccessToken && Date.now() < _gmailTokenExpiresAt - 60_000) return _gmailAccessToken;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail token refresh failed: ${data.error_description || data.error || res.status}`);
  _gmailAccessToken   = data.access_token;
  _gmailTokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  return _gmailAccessToken;
}

async function sendViaGmailApi({ to, subject, html }) {
  const mime = await new MailComposer({ from: FROM, to, subject, html, replyTo: REPLY_TO }).compile().build();
  const raw  = mime.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res  = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${await getGmailAccessToken()}`,
      'Content-Type':  'application/json',
    },
    body:   JSON.stringify({ raw }),
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 401) _gmailAccessToken = null; // force a fresh token on the retry
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Gmail API error ${res.status}: ${data.error?.message || 'unknown error'}`);
  }
}

/* ── SMTP fallback ───────────────────────────────────────────────────────── */
let _smtpTransport = null;
function getSmtpTransport() {
  if (!_smtpTransport) {
    _smtpTransport = nodemailer.createTransport({
      host:   process.env.SMTP_HOST || 'smtp.gmail.com',
      port:   465,
      secure: true,
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS.replace(/\s+/g, '') },
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
    });
  }
  return _smtpTransport;
}

async function sendViaSmtp({ to, subject, html }) {
  await getSmtpTransport().sendMail({ from: FROM, to, subject, html, replyTo: REPLY_TO });
}

/* Provider chain, in priority order. */
const PROVIDER_CHAIN = [
  ...(hasGmailApi ? [{ name: 'gmail-api', send: sendViaGmailApi }] : []),
  ...(hasSmtp     ? [{ name: 'smtp',      send: sendViaSmtp }]     : []),
];

console.log(PROVIDER_CHAIN.length
  ? `✉️  Email providers (in order): ${PROVIDER_CHAIN.map(p => p.name).join(' → ')} · from ${FROM}`
  : '✉️  Email not configured — set the GMAIL_* variables (see .env.example)');

/* ── Concurrency-limited, retrying, failing-over send queue ─────────────────
   Mail providers reject/drop requests once too many go out at once (Gmail's per-user
   rate limit and per-account concurrent-connection limit).
   Without this, bulk sends (e.g. team-assignment emails to 50+ students at
   once) blast every request in parallel via Promise.allSettled — the first
   few succeed and the provider starts rejecting the rest outright. Capping
   concurrency and retrying transient failures keeps the whole batch delivering
   instead of silently failing past the first handful. */
const MAX_CONCURRENT_SENDS = 2; // stay well under Gmail's per-user send rate
const FALLBACK_RETRIES = 1; // non-final providers: one quick retry, then move on — a persistent
                             // failure (e.g. a daily quota) won't be fixed by hammering
                             // it with the same 500ms/1500ms/4500ms backoff used for a final leg
const FINAL_RETRIES    = 3; // the last provider in the chain has nowhere left to fail over to,
                             // so it gets the full retry treatment (500ms, 1500ms, 4500ms)
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

async function _sendWithRetries(providerFn, payload, maxRetries) {
  for (let attempt = 0; ; attempt++) {
    try {
      await providerFn(payload);
      return;
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      await _wait(500 * 3 ** attempt); // 500ms, then 1500ms, then 4500ms
    }
  }
}

/* ── Shared send wrapper — tries each provider in PROVIDER_CHAIN in order,
   falling over to the next one if a provider exhausts its retries. Only
   throws once every provider in the chain has failed. Returns the name of
   whichever provider actually succeeded, so callers/diagnostics can tell
   when a send only went through because of the fallback. ── */
async function send({ to, subject, html }) {
  if (!PROVIDER_CHAIN.length) throw new Error('Email is not configured on the server.');
  await _acquireSendSlot();
  try {
    let lastErr;
    for (let i = 0; i < PROVIDER_CHAIN.length; i++) {
      const { name, send: providerFn } = PROVIDER_CHAIN[i];
      const isLast = i === PROVIDER_CHAIN.length - 1;
      try {
        await _sendWithRetries(providerFn, { to, subject, html }, isLast ? FINAL_RETRIES : FALLBACK_RETRIES);
        return name;
      } catch (err) {
        lastErr = err;
        console.error(`[email] ${name} failed${isLast ? '' : ' — falling back to next provider'}:`, err.message);
      }
    }
    throw lastErr;
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

/* Sent when a coordinator/admin clears pending join requests in bulk. One email per
   student, listing every club whose request was removed, since the student is free to
   request those same clubs again. */
const sendRequestsRemoved = async ({ toEmail, toName, clubNames = [] }) => {
  const list = clubNames.map(n =>
    `<li style="margin:4px 0;font-weight:700;color:#1a1040">${n}</li>`).join('');
  await send({
    to:      toEmail,
    subject: clubNames.length === 1
      ? `Your request to join ${clubNames[0]} was removed — SOAC RKU`
      : 'Your club join requests were removed — SOAC RKU',
    html: wrap(`
      ${header()}
      <h2 style="color:#1a1040;margin-bottom:8px">Hi ${toName},</h2>
      <p style="color:#555;line-height:1.6">Your pending request to join the following ${clubNames.length === 1 ? 'club has' : 'clubs have'} been removed by the club coordinator:</p>
      <div style="background:#fff7ed;border:1.5px solid #fdba74;border-radius:12px;padding:16px 24px;margin:24px 0">
        <ul style="margin:0;padding-left:18px">${list}</ul>
      </div>
      <p style="color:#555;line-height:1.6">This doesn't stop you from joining. Please contact the club coordinator, or send a new request to join the ${clubNames.length === 1 ? 'club' : 'clubs'} again.</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${APP_URL}/clubs" style="display:inline-block;background:#635BFF;color:#fff;text-decoration:none;font-weight:700;padding:12px 28px;border-radius:10px">Request to Join Again</a>
      </div>
      ${footer()}
    `),
  });
};

/* Sent to students whose accounts were cleared by admin ("Delete all students")
   when admin announces the date club join requests open again — or that they're
   open right now (opensOnLabel null) — so they can request to join and renew
   their membership. */
const sendJoinRequestsReopening = async ({ toEmail, toName, opensOnLabel = null }) => {
  await send({
    to:      toEmail,
    subject: opensOnLabel
      ? `Club join requests open on ${opensOnLabel} — SOAC RKU`
      : 'Club join requests are open — SOAC RKU',
    html: wrap(`
      ${header()}
      <h2 style="color:#1a1040;margin-bottom:8px">Hi ${toName || 'there'},</h2>
      <p style="color:#555;line-height:1.6">Club memberships have been reset for the new session, so your previous club membership and account have ended.</p>
      <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:16px 24px;margin:24px 0;text-align:center">
        <p style="margin:0;font-size:13px;color:#15803d">${opensOnLabel ? 'You can start sending join requests on' : 'Join requests are'}</p>
        <p style="margin:6px 0 0;font-size:20px;font-weight:800;color:#15803d">${opensOnLabel || 'open now'}</p>
      </div>
      <p style="color:#555;line-height:1.6">To renew your membership, send a new request to join your club${opensOnLabel ? ' from that date' : ''}. Once it's approved you'll receive a fresh account with new login details by email.</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${APP_URL}/clubs" style="display:inline-block;background:#635BFF;color:#fff;text-decoration:none;font-weight:700;padding:12px 28px;border-radius:10px">View Clubs</a>
      </div>
      ${footer()}
    `),
  });
};

/* roleLabel lets the exact same template serve both club staff roles — the
   (Student) Coordinator and, one tier up, the Faculty Coordinator — so a
   role assigned from either the admin dashboard or a Faculty Coordinator's
   own "Assign Student Coordinator" action gets an identical-looking email,
   just naming the correct role. */
const sendCoordinatorCredentials = async ({ toEmail, toName, password, clubName, roleLabel = 'Coordinator' }) => {
  await send({
    to:      toEmail,
    subject: `You've been appointed ${roleLabel} of ${clubName} — SOAC RKU`,
    html: wrap(`
      ${header('#4c44e0,#a78bfa')}
      <h2 style="color:#1a1040;margin-bottom:8px">Congratulations, ${toName}!</h2>
      <p style="color:#555;line-height:1.6">You have been appointed as <strong style="color:#4c44e0">${roleLabel}</strong> for <strong style="color:#4c44e0">${clubName}</strong> on the SOAC RKU Platform.</p>
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

const sendCoordinatorAssignment = async ({ toEmail, toName, clubName, roleLabel = 'Coordinator' }) => {
  await send({
    to:      toEmail,
    subject: `You've been assigned as ${roleLabel} of ${clubName} — SOAC RKU`,
    html: wrap(`
      ${header('#4c44e0,#a78bfa')}
      <h2 style="color:#1a1040;margin-bottom:8px">Hello, ${toName}!</h2>
      <p style="color:#555;line-height:1.6">You have been appointed as <strong style="color:#4c44e0">${roleLabel}</strong> for <strong style="color:#4c44e0">${clubName}</strong>.</p>
      <div style="background:#f0fff8;border:1.5px solid #86efac;border-radius:12px;padding:20px 24px;margin:24px 0;text-align:center">
        <p style="margin:0;font-size:16px;font-weight:800;color:#15803d">${roleLabel} of ${clubName}</p>
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

/* Sent to a coordinator the moment an admin assigns them to run a specific
   Galore activity (at event-creation time — every activity always has a
   coordinator assigned before the event can be created, so this fires once
   per activity, right after the whole event is committed). */
const sendGaloreActivityAssignment = async ({ toEmail, toName, activityTitle, category, umbrellaTitle }) => {
  const categoryLabel = category ? category.charAt(0).toUpperCase() + category.slice(1) : '';
  await send({
    to:      toEmail,
    subject: `You've been assigned to coordinate ${activityTitle} — ${umbrellaTitle}`,
    html: wrap(`
      ${header('#4c44e0,#a78bfa')}
      <h2 style="color:#1a1040;margin-bottom:8px">Hello, ${toName}!</h2>
      <p style="color:#555;line-height:1.6">You have been assigned as <strong style="color:#4c44e0">Coordinator</strong> for <strong style="color:#4c44e0">${activityTitle}</strong>${categoryLabel ? ` (${categoryLabel})` : ''}, part of <strong>${umbrellaTitle}</strong>.</p>
      <div style="background:#f0fff8;border:1.5px solid #86efac;border-radius:12px;padding:20px 24px;margin:24px 0;text-align:center">
        <p style="margin:0;font-size:16px;font-weight:800;color:#15803d">Coordinator of ${activityTitle}</p>
        <p style="margin:6px 0 0;font-size:13px;color:#555">Log in to your SOAC Coordinator Portal to view registrations for this activity and build boys'/girls' teams once students sign up.</p>
      </div>
      <p style="color:#888;font-size:13px;line-height:1.6">Your existing credentials are unchanged. Visit <strong>${APP_LOGIN}</strong> to access your portal.</p>
      ${footer()}
    `),
  });
};

/* ── "My Activity" report email ──────────────────────────────────────────────
   Sent in place of showing the public lookup's results directly on the guest
   page — see activityByEmail in users.controller.js. Mirrors exactly what the
   My Activity page itself renders (club status, overall event attendance, and
   every event grouped by category with its attendance and any certificate),
   so the email is a faithful copy of the page rather than a trimmed summary. */
const ACT_STATUS_LABEL = { winner: 'Winner', runner_up: 'Runner-up', participation: 'Participation' };
const ACT_STATUS_RANK  = { winner: 0, runner_up: 1, participation: 2 };
const ACT_CLUB_LABEL   = { member: 'Accepted', pending: 'Pending', declined: 'Declined', inactive: 'Inactive' };
const ACT_CLUB_COLOR   = { member: '#15803d', pending: '#b45309', declined: '#b91c1c', inactive: '#6b7280' };
const ACT_STATUS_COLOR = { Winner: '#b45309', 'Runner-up': '#4b5563', Participation: '#059669', Registered: '#6b7280' };

const actFmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const actEventStatus = (achievements) => {
  if (!achievements?.length) return 'Registered';
  const best = [...achievements].sort((a, b) => (ACT_STATUS_RANK[a.category] ?? 9) - (ACT_STATUS_RANK[b.category] ?? 9))[0];
  return ACT_STATUS_LABEL[best.category] || 'Registered';
};

const sendActivityReport = async ({ toEmail, toName, clubs = [], attendanceSummary, categories = [] }) => {
  /* Two-column rows (name/title left, status right) use a <table> rather than flexbox —
     flexbox is unreliable across email clients (notably the Gmail mobile app), and would
     otherwise render the status jammed right up against the name with no separation. */
  const clubsHtml = clubs.length ? `
    <div style="margin:24px 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-bottom:6px">
        <tr>
          <td style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Your Clubs</td>
          <td style="text-align:right;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Status</td>
        </tr>
      </table>
      ${clubs.map(c => `
        <div style="background:#f8f7ff;border:1px solid #e8e5ff;border-radius:10px;padding:10px 14px;margin-bottom:8px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
            <tr>
              <td style="text-align:left;font-weight:700;color:#1a1040">${c.clubName}</td>
              <td style="text-align:right;white-space:nowrap;padding-left:10px;font-weight:700;font-size:12px;color:${ACT_CLUB_COLOR[c.status] || '#6b7280'}">${ACT_CLUB_LABEL[c.status] || c.status}</td>
            </tr>
          </table>
        </div>`).join('')}
    </div>` : '';

  const attHtml = attendanceSummary?.averagePct != null ? `
    <div style="background:#fff7ed;border:1.5px solid #fed7aa;border-radius:12px;padding:16px 20px;margin:20px 0;text-align:center">
      <p style="margin:0;font-size:12px;color:#9a3412;text-transform:uppercase;letter-spacing:1px;font-weight:700">Overall Event Attendance</p>
      <p style="margin:6px 0 0;font-size:28px;font-weight:800;color:#c2410c">${attendanceSummary.averagePct}%</p>
      <p style="margin:4px 0 0;font-size:12px;color:#9a3412">Average across ${attendanceSummary.eventsCounted} event${attendanceSummary.eventsCounted === 1 ? '' : 's'} with attendance recorded</p>
    </div>` : '';

  const catsHtml = categories.map(cat => {
    if (!cat.events.length) return '';
    const rows = cat.events.map(ev => {
      const status  = actEventStatus(ev.achievements);
      const attLine = ev.attendance
        ? `<p style="margin:4px 0 0;font-size:12px;color:#555">Attendance: <strong>${ev.attendance.percentage}%</strong> (${ev.attendance.presentSessions}/${ev.attendance.totalSessions} days)</p>`
        : `<p style="margin:4px 0 0;font-size:12px;color:#9ca3af">No attendance recorded yet.</p>`;
      const certs = (ev.achievements || []).filter(a => a.fileUrl)
        .map(a => `<a href="${a.fileUrl}" style="color:#635BFF;font-size:12px;font-weight:700;text-decoration:none">Download Certificate of ${ACT_STATUS_LABEL[a.category] || 'Participation'}</a>`)
        .join(' &nbsp;·&nbsp; ');
      return `
        <div style="padding:12px 14px;border:1px solid #eee;border-radius:10px;margin-bottom:8px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
            <tr>
              <td style="text-align:left;vertical-align:top">
                <p style="margin:0;font-weight:700;color:#1a1040">${ev.eventTitle}</p>
                <p style="margin:2px 0 0;font-size:12px;color:#888">${ev.clubName}${ev.venue ? ` · ${ev.venue}` : ''}${ev.eventDate ? ` · ${actFmtDate(ev.eventDate)}` : ''}</p>
              </td>
              <td style="text-align:right;vertical-align:top;white-space:nowrap;padding-left:10px">
                <span style="font-size:11px;font-weight:800;color:${ACT_STATUS_COLOR[status]}">${status}</span>
              </td>
            </tr>
          </table>
          ${attLine}
          ${certs ? `<p style="margin:8px 0 0">${certs}</p>` : ''}
        </div>`;
    }).join('');
    return `
      <div style="margin:20px 0">
        <p style="margin:0 0 10px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">${cat.label} Activity</p>
        ${rows}
      </div>`;
  }).join('');

  await send({
    to:      toEmail,
    subject: 'Your SOAC Activity Summary',
    html: wrap(`
      ${header()}
      <h2 style="color:#1a1040;margin-bottom:8px">Hi ${toName},</h2>
      <p style="color:#555;line-height:1.6">You asked to see your activity on the SOAC platform, so here it is — the clubs you're part of, every event you've taken part in, and your attendance record, all in one place.</p>
      ${clubsHtml}
      ${attHtml}
      ${catsHtml || '<p style="color:#888;font-size:13px;line-height:1.6">You have not participated in any events yet — keep an eye on your club for upcoming ones.</p>'}
      <p style="color:#888;font-size:13px;line-height:1.6;margin-top:24px">Thanks for being part of SOAC — keep up the great work!</p>
      ${footer()}
    `),
  });
};

/* ── Diagnostic: send a test email, return { ok, via, error } ─────────────── */
const sendTestEmail = async (toEmail) => {
  const chain = PROVIDER_CHAIN.map(p => p.name).join(' → ');
  try {
    const via = await send({
      to:      toEmail,
      subject: 'SOAC Email Test',
      html:    wrap(`${header()}<h2 style="color:#1a1040">Email is working!</h2><p style="color:#555">This test email confirms SOAC can send emails (provider chain: <strong>${chain}</strong>).</p>${footer()}`),
    });
    return { ok: true, via };
  } catch (err) {
    return { ok: false, via: chain, error: err.message };
  }
};

module.exports = {
  sendCredentials,
  sendApproval,
  sendRequestsRemoved,
  sendJoinRequestsReopening,
  sendCoordinatorCredentials,
  sendCoordinatorAssignment,
  sendPasswordReset,
  sendTeamAssignment,
  sendGaloreActivityAssignment,
  sendActivityReport,
  sendTestEmail,
};
