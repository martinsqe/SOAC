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

/* Separate-account note, used when this email already has its other account */
const otherAccountBox = (text) => text
  ? `<div style="background:#fffbeb;border:1.5px solid #fcd34d;border-radius:12px;padding:14px 18px;margin:0 0 20px;font-size:13px;color:#92400e;line-height:1.6">${text}</div>`
  : '';

/* otherAccountNote — set when the student also has a coordinator / advisor account */
const sendCredentials = async ({ toEmail, toName, password, clubName = null, otherAccountNote = null }) => {
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
      ${otherAccountBox(otherAccountNote)}
      <p style="color:#888;font-size:13px;line-height:1.6">Please change your password after your first login. Students can join up to <strong>3 clubs</strong>.</p>
      ${footer()}
    `),
  });
};

/* switchNote — set for someone who signs in as a coordinator / advisor, telling
   them how to reach the student dashboard with that same login */
const sendApproval = async ({ toEmail, toName, clubName, switchNote = null }) => {
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
      ${otherAccountBox(switchNote)}
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

/* Text an admin typed, shown safely in an email: HTML escaped, line breaks kept */
const escapeHtml = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const asParagraphs = (s = '') => escapeHtml(s).replace(/\r?\n/g, '<br/>');

/* Category label above the heading — plain text on the white background, like
   a person would type it */
const categoryLine = (label) =>
  `<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7280">${escapeHtml(label)}</p>`;

/* Admin broadcast → emailed to every club member, category clearly labelled.
   Written to read like a normal typed email: no badges or boxes. */
const sendBroadcastEmail = async ({ toEmail, toName, title, body, category = 'Announcement' }) => {
  await send({
    to:      toEmail,
    subject: `[${category}] ${title} — SOAC RKU`,
    html: wrap(`
      ${header()}
      ${categoryLine(category)}
      <h2 style="color:#1a1040;margin:0 0 18px">${escapeHtml(title)}</h2>
      <p style="color:#333;font-size:15px;line-height:1.7;margin:0 0 14px">Hi ${escapeHtml(toName || 'there')},</p>
      ${body ? `<p style="color:#333;font-size:15px;line-height:1.7;margin:0 0 14px">${asParagraphs(body)}</p>` : ''}
      <p style="color:#333;font-size:15px;line-height:1.7;margin:22px 0 4px">Regards,<br/>SOAC RKU</p>
      <div style="margin:26px 0">
        <a href="${APP_URL}/student/soac-updates" style="display:inline-block;background:#635BFF;color:#fff;text-decoration:none;font-weight:700;padding:11px 24px;border-radius:8px">View SOAC Updates</a>
      </div>
      ${footer()}
    `),
  });
};

/* Admin event reminder. kind: 'venue' | 'countdown' | 'register' | 'custom'.
   event: { id, title, dateLabel, time, venue, organizer, registrationType, registrationUrl },
   daysToGo for countdown. */
const sendEventReminder = async ({ toEmail, toName, kind, event, daysToGo = null, message = '' }) => {
  const external = event.registrationType === 'external' && event.registrationUrl;
  const eventUrl = kind === 'register' && external ? event.registrationUrl : `${APP_URL}/events/${event.id}`;
  const when = daysToGo === 0 ? 'today' : daysToGo === 1 ? 'tomorrow' : `in ${daysToGo} days`;
  const SUBJECT = {
    venue:     `Venue update: ${event.title} — ${event.venue}`,
    countdown: daysToGo === 0 ? `Today: ${event.title}` : `${daysToGo === 1 ? '1 day' : `${daysToGo} days`} to go: ${event.title}`,
    register:  `Don't miss out — register for ${event.title}`,
    custom:    `Reminder: ${event.title}`,
  };
  const INTRO = {
    venue:     `The venue for <strong>${escapeHtml(event.title)}</strong> has been confirmed.`,
    countdown: `<strong>${escapeHtml(event.title)}</strong> is ${when}! Get ready.`,
    register:  external
      ? `Registration is open for <strong>${escapeHtml(event.title)}</strong> on the organizer's website — save your spot before it closes.`
      : `Registration is open for <strong>${escapeHtml(event.title)}</strong> and you haven't registered yet — save your spot before it closes.`,
    custom:    `A reminder about <strong>${escapeHtml(event.title)}</strong>.`,
  };
  /* One plain "Label: value" line; the venue is bold in a venue update */
  const row = (label, value, highlight = false) => value
    ? `${label}: ${highlight ? `<strong>${escapeHtml(value)}</strong>` : escapeHtml(value)}<br/>`
    : '';
  await send({
    to:      toEmail,
    subject: `${SUBJECT[kind] || SUBJECT.custom} — SOAC RKU`,
    html: wrap(`
      ${header()}
      ${categoryLine('Event reminder')}
      <h2 style="color:#1a1040;margin:0 0 18px">${escapeHtml(event.title)}</h2>
      <p style="color:#333;font-size:15px;line-height:1.7;margin:0 0 14px">Hi ${escapeHtml(toName || 'there')},</p>
      <p style="color:#333;font-size:15px;line-height:1.7;margin:0 0 14px">${INTRO[kind] || INTRO.custom}</p>
      ${message ? `<p style="color:#333;font-size:15px;line-height:1.7;margin:0 0 14px">${asParagraphs(message)}</p>` : ''}
      <p style="color:#333;font-size:15px;line-height:1.9;margin:0 0 14px">
        ${row('Date', event.dateLabel)}${row('Time', event.time)}${row('Venue', event.venue, kind === 'venue')}${row('Organizer', event.organizer)}
      </p>
      <p style="color:#333;font-size:15px;line-height:1.7;margin:22px 0 4px">Regards,<br/>SOAC RKU</p>
      <div style="margin:26px 0">
        <a href="${escapeHtml(eventUrl)}" style="display:inline-block;background:#635BFF;color:#fff;text-decoration:none;font-weight:700;padding:11px 24px;border-radius:8px">${kind === 'register' ? (external ? 'Register on website' : 'Register now') : 'View event'}</a>
      </div>
      ${footer()}
    `),
  });
};

/* ═══ Plain "typed" emails with clearly arranged details ═══════════════════════
   Shared pieces for the request / proposal / announcement / message emails:
   a category line, heading, greeting, paragraphs, label-value tables and a
   sign-off — no coloured boxes or badges, so they read like a typed email. */
const para = (html) => `<p style="color:#333;font-size:15px;line-height:1.7;margin:0 0 14px">${html}</p>`;
const signOff = () => para('Regards,<br/>SOAC RKU');
const actionButton = (href, label) => `
  <div style="margin:26px 0">
    <a href="${href}" style="display:inline-block;background:#635BFF;color:#fff;text-decoration:none;font-weight:700;padding:11px 24px;border-radius:8px">${escapeHtml(label)}</a>
  </div>`;
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

/* rows: [label, value] — blank values are skipped. Values are escaped, line breaks kept. */
const detailTable = (heading, rows) => {
  const body = rows
    .filter(([, v]) => !isBlank(v))
    .map(([label, v]) => `
      <tr>
        <td style="padding:8px 14px 8px 0;border-bottom:1px solid #f0f0f3;color:#6b7280;font-size:13px;vertical-align:top;width:38%">${escapeHtml(label)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #f0f0f3;color:#1f2937;font-size:14px;line-height:1.6;vertical-align:top">${asParagraphs(String(v))}</td>
      </tr>`)
    .join('');
  if (!body) return '';
  return `
    ${heading ? `<p style="margin:24px 0 4px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#1a1040">${escapeHtml(heading)}</p>` : ''}
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 6px">${body}</table>`;
};

const plainEmail = ({ category, title, toName, intro = [], sections = '', outro = [], button = null }) => wrap(`
  ${header()}
  ${categoryLine(category)}
  <h2 style="color:#1a1040;margin:0 0 18px">${escapeHtml(title)}</h2>
  ${para(`Hi ${escapeHtml(toName || 'there')},`)}
  ${intro.map(para).join('')}
  ${sections}
  ${outro.length ? `<div style="margin-top:18px">${outro.map(para).join('')}</div>` : ''}
  ${signOff()}
  ${button ? actionButton(button.href, button.label) : ''}
  ${footer()}
`);

const fmtLongDate = (d) => {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
};
const ROLE_NAME = { coordinator: 'Student Coordinator', faculty_coordinator: 'Faculty Advisor', admin: 'SOAC Admin', student: 'Student' };

/* ── Event requests ────────────────────────────────────────────────────────── */
/* Every field the Student Coordinator / Faculty Advisor filled in */
const eventRequestSections = (r) => {
  const tags = Array.isArray(r.tags) ? r.tags.join(', ') : (r.tags || '');
  const fee  = r.is_free === false || r.is_free === 'false' ? `Paid — ₹${Number(r.fee_amount) || 0}` : 'Free';
  return detailTable('Event details', [
    ['Event',             r.title],
    ['Club',              r.club_name],
    ['Submitted by',      r.coordinator_name ? `${r.coordinator_name} (${ROLE_NAME[r.submitted_by_role] || 'Student Coordinator'})` : ''],
    ['Category',          r.category ? r.category.charAt(0).toUpperCase() + r.category.slice(1) : ''],
    ['Date',              fmtLongDate(r.start_date) || r.date],
    ['Time',              r.time],
    ['Venue',             r.venue],
    ['Seats',             r.seats],
    ['Entry',             fee],
    ['Registration',      r.registration_type === 'external' ? 'On an external website'
                          : r.registration_type === 'none'     ? 'No registration needed'
                          : 'On SOAC (registration form)'],
    ['Registration link', r.registration_type === 'none' ? '' : r.registration_url],
    ['Note for students', r.registration_type === 'none' ? r.registration_note : ''],
    ['Tags',              tags],
    ['Highlight',         r.highlight],
    ['Special day',       r.is_special_day ? (r.special_day_name || 'Yes') : ''],
    ['Poster',            r.image && String(r.image).startsWith('http') ? r.image : ''],
  ]) + detailTable('About the event', [
    ['Description',                     r.description],
    ['Objective',                       r.objective],
    ['Expected outcome',                r.expected_outcome],
    ['Who can participate',             r.target_audience],
    ['Expectations from the university', r.university_expectations],
  ]);
};

/* stage: 'fa_review' → to the club's Faculty Advisor; 'admin_review' → to admins */
const sendEventRequestForReview = async ({ toEmail, toName, stage, request, forwardedBy = '' }) => {
  const forAdmin = stage === 'admin_review';
  const intro = forAdmin
    ? [forwardedBy
        ? `${escapeHtml(forwardedBy)} (Faculty Advisor) has approved an event request from <strong>${escapeHtml(request.club_name)}</strong> and forwarded it to you for final approval.`
        : `<strong>${escapeHtml(request.club_name)}</strong> has submitted a new event request for your approval.`]
    : [`${escapeHtml(request.coordinator_name || 'Your Student Coordinator')} has submitted an event request for <strong>${escapeHtml(request.club_name)}</strong>. Please review it — once you approve, it goes to the SOAC admin for final approval.`];
  await send({
    to:      toEmail,
    subject: `Event request for review: ${request.title} (${request.club_name}) — SOAC RKU`,
    html: plainEmail({
      category: 'Event request',
      title:    request.title,
      toName,
      intro,
      sections: eventRequestSections(request),
      outro:    ['You can approve or decline it from your dashboard.'],
      button:   { href: `${APP_URL}${forAdmin ? '/admin/events' : '/coordinator/events'}`, label: 'Review request' },
    }),
  });
};

/* outcome: 'forwarded' (FA approved → admin) | 'approved' (admin, event live) |
   'declined_fa' | 'declined_admin'. note = reviewer's reason (declines). */
const sendEventRequestDecision = async ({ toEmail, toName, outcome, request, event = null, note = '', reviewerName = '' }) => {
  const t = escapeHtml(request.title);
  const COPY = {
    forwarded:      { subject: `Approved by your Faculty Advisor: ${request.title}`, intro: [`Good news — ${escapeHtml(reviewerName || 'your Faculty Advisor')} approved your event request <strong>${t}</strong> and forwarded it to the SOAC admin for final approval. You'll get another email once the admin decides.`] },
    approved:       { subject: `Event approved: ${request.title}`,                   intro: [`The SOAC admin has approved <strong>${t}</strong> for ${escapeHtml(request.club_name)}. The event is now live and on the Events page of your coordinator dashboard — you can start your arrangements.`] },
    declined_fa:    { subject: `Event request declined: ${request.title}`,           intro: [`${escapeHtml(reviewerName || 'Your Faculty Advisor')} has declined the event request <strong>${t}</strong>.`] },
    declined_admin: { subject: `Event request declined: ${request.title}`,           intro: [`The SOAC admin has declined the event request <strong>${t}</strong>.`] },
  };
  const c = COPY[outcome] || COPY.approved;
  const intro = [...c.intro];
  if (note) intro.push(`Reason given: ${asParagraphs(note)}`);
  /* An approved event shows its final (admin-reviewed) details */
  const shown = event ? { ...request, ...event, club_name: event.club || request.club_name } : request;
  await send({
    to:      toEmail,
    subject: `${c.subject} — SOAC RKU`,
    html: plainEmail({
      category: outcome === 'approved' ? 'Event approved' : 'Event request',
      title:    shown.title,
      toName,
      intro,
      sections: eventRequestSections(shown),
      outro:    outcome === 'approved'
        ? [`<strong>Report required:</strong> please submit the event report from the <strong>Reports</strong> page of your dashboard immediately after the event is done.`, 'Please plan the venue, volunteers and promotion accordingly, and keep your members informed.']
        : [],
      button:   { href: `${APP_URL}${outcome === 'approved' && event?.id ? `/events/${event.id}` : '/coordinator/events'}`, label: outcome === 'approved' ? 'View event' : 'Open dashboard' },
    }),
  });
};

/* An event now sits in a club's coordinator dashboard — sent to the club's Student
   Coordinators and Faculty Advisors. reason: 'created' (admin published it for the
   club) | 'assigned' (an existing event was moved to this club). */
const REG_LABEL = { internal: 'On SOAC (registration form)', external: 'On an external website', none: 'No registration needed' };
const sendEventPublishedToCoordinator = async ({ toEmail, toName, event, reason = 'created', publishedBy = 'The SOAC admin' }) => {
  const t    = escapeHtml(event.title);
  const club = escapeHtml(event.club || 'your club');
  const regType = event.registrationType || 'internal';
  await send({
    to:      toEmail,
    subject: `New event in your dashboard: ${event.title} — SOAC RKU`,
    html: plainEmail({
      category: 'Event published',
      title:    event.title,
      toName,
      intro: [reason === 'assigned'
        ? `<strong>${t}</strong> has been assigned to <strong>${club}</strong> and is now on the Events page of your coordinator dashboard.`
        : `${escapeHtml(publishedBy)} has published <strong>${t}</strong> for <strong>${club}</strong>. It is now on the Events page of your coordinator dashboard.`],
      sections: detailTable('Event details', [
        ['Event',             event.title],
        ['Club',              event.club],
        ['Date',              fmtLongDate(event.startDate) || event.date],
        ['Time',              event.time],
        ['Venue',             event.venue],
        ['Registration',      REG_LABEL[regType] || REG_LABEL.internal],
        ['Registration link', regType === 'external' ? event.registrationUrl : ''],
      ]),
      outro: [
        `<strong>Report required:</strong> please submit the event report from the <strong>Reports</strong> page of your dashboard immediately after the event is done.`,
        'Please plan the venue, volunteers and promotion accordingly, and keep your members informed.',
      ],
      button: { href: `${APP_URL}/coordinator/events`, label: 'Open your Events dashboard' },
    }),
  });
};

/* Sent to each volunteer once the event's report is submitted to the admin */
const sendVolunteerThanks = async ({ toEmail, toName, role = '', event }) => {
  const t = escapeHtml(event.title);
  await send({
    to:      toEmail,
    subject: `Thank you for volunteering — ${event.title} — SOAC RKU`,
    html: plainEmail({
      category: 'Thank you',
      title:    event.title,
      toName,
      intro: [
        `Thank you for volunteering at <strong>${t}</strong>${event.club ? ` organised by <strong>${escapeHtml(event.club)}</strong>` : ''}. Your help made the event possible.`,
        `It has been added to your SOAC activity as <strong>Volunteer of ${t}</strong>.`,
      ],
      sections: detailTable('Event details', [
        ['Event',  event.title],
        ['Club',   event.club],
        ['Date',   event.date || fmtLongDate(event.startDate)],
        ['Your role', role],
      ]),
      outro: ['We hope to see you at the next one.'],
      button: { href: `${APP_URL}/student/profile`, label: 'View your activity' },
    }),
  });
};

/* ── Direct messages — content deliberately not included ──────────────────── */
const sendDirectMessageNotice = async ({ toEmail, toName, fromLabel, senderName, url }) => {
  await send({
    to:      toEmail,
    subject: `You have a message from ${fromLabel} by ${senderName} — SOAC RKU`,
    html: plainEmail({
      category: 'Direct message',
      title:    `New message from ${senderName}`,
      toName,
      intro:    [`You have a message from <strong>${escapeHtml(fromLabel)}</strong> by <strong>${escapeHtml(senderName)}</strong>. Log in to SOAC to read it and reply.`],
      button:   { href: `${APP_URL}${url || '/login'}`, label: 'Open messages' },
    }),
  });
};

/* ── Club announcements — full details ─────────────────────────────────────── */
const sendClubAnnouncementEmail = async ({ toEmail, toName, clubName, clubId, title, body, category = 'Announcement', postedBy = '' }) => {
  await send({
    to:      toEmail,
    subject: `[${category}] ${title} — ${clubName}`,
    html: plainEmail({
      category: `${clubName} · ${category}`,
      title,
      toName,
      intro:    [body ? asParagraphs(body) : `${escapeHtml(clubName)} posted a new ${escapeHtml(category.toLowerCase())}.`],
      sections: detailTable('', [
        ['Club',      clubName],
        ['Category',  category],
        ['Posted by', postedBy],
        ['Posted on', fmtLongDate(new Date())],
      ]),
      button:   { href: `${APP_URL}/student/clubs/${clubId}`, label: 'Open club page' },
    }),
  });
};

/* ── Join requests — every 5 new requests, names only ──────────────────────── */
const sendJoinRequestsDigest = async ({ toEmail, toName, clubName, campus, names, pendingTotal }) => {
  const list = names.map((n, i) => `${i + 1}. ${escapeHtml(n)}`).join('<br/>');
  await send({
    to:      toEmail,
    subject: `${names.length} new join requests for ${clubName} — SOAC RKU`,
    html: plainEmail({
      category: 'Join requests',
      title:    `${names.length} new join requests`,
      toName,
      intro: [
        `${names.length} more students have asked to join <strong>${escapeHtml(clubName)}</strong>${campus ? ` (${escapeHtml(campus)})` : ''}:`,
        list,
        `There ${pendingTotal === 1 ? 'is' : 'are'} now <strong>${pendingTotal}</strong> pending request${pendingTotal === 1 ? '' : 's'} in total. Their full details are in your dashboard, where you can approve or decline them.`,
      ],
      button: { href: `${APP_URL}/coordinator/requests`, label: 'Review requests' },
    }),
  });
};

/* ── Club proposals — every section of the application form ───────────────── */
const PROPOSAL_SECTION_TITLES = {
  organization: 'Organization',
  applicant:    'Primary applicant',
  advisor:      'Faculty advisor',
  coordinator:  'Student coordinator',
  plan:         'Activity plan',
};
const sendClubProposalEmail = async ({ toEmail, toName, proposal }) => {
  const p = proposal;
  const list = (v) => (Array.isArray(v) ? v.join('\n') : (v || ''));
  let details = p.details || {};
  if (typeof details === 'string') { try { details = JSON.parse(details); } catch { details = {}; } }
  const extra = Object.entries(details)
    .map(([key, value]) => (value && typeof value === 'object'
      ? detailTable(PROPOSAL_SECTION_TITLES[key] || key, Object.entries(value))
      : detailTable('', [[key, value]])))
    .join('');
  await send({
    to:      toEmail,
    subject: `New club proposal: ${p.club_name} — SOAC RKU`,
    html: plainEmail({
      category: 'Club proposal',
      title:    p.club_name,
      toName,
      intro:    [`${escapeHtml(p.proposed_by_name || 'Someone')} has proposed a new club, <strong>${escapeHtml(p.club_name)}</strong>. The full application is below.`],
      sections: detailTable('Proposed club', [
        ['Club name',          p.club_name],
        ['Category',           p.category ? p.category.charAt(0).toUpperCase() + p.category.slice(1) : ''],
        ['Description',        p.description],
        ['Objectives / vision', p.vision],
        ['Reason for proposing', p.reason && p.reason !== p.vision ? p.reason : ''],
        ['Meeting schedule',   p.schedule],
        ['Founded year',       p.founded_year],
        ['Tags',               list(p.tags).replace(/\n/g, ', ')],
        ['Rules',              list(p.rules)],
      ]) + detailTable('Submitted by', [
        ['Name',      p.proposed_by_name],
        ['Email',     p.proposed_by_email],
        ['Role',      ROLE_NAME[p.proposed_by_role] || (p.proposed_by_role === 'guest' ? 'Guest (no account)' : p.proposed_by_role)],
        ['Submitted', fmtLongDate(p.created_at || new Date())],
      ]) + extra,
      outro:    ['You can approve or decline it from Approvals → Club proposals.'],
      button:   { href: `${APP_URL}/admin/approvals?tab=proposals`, label: 'Review proposal' },
    }),
  });
};

/* Club group chat — a coordinator / Faculty Advisor / admin posted. Deliberately
   doesn't include the message: members log in to read it. */
const sendClubChatNotice = async ({ toEmail, toName, clubName, clubId, senderRole }) => {
  await send({
    to:      toEmail,
    subject: `New message in the ${clubName} chat — SOAC RKU`,
    html: wrap(`
      ${header()}
      ${categoryLine('Club chat')}
      <h2 style="color:#1a1040;margin:0 0 18px">${escapeHtml(clubName)}</h2>
      <p style="color:#333;font-size:15px;line-height:1.7;margin:0 0 14px">Hi ${escapeHtml(toName || 'there')},</p>
      <p style="color:#333;font-size:15px;line-height:1.7;margin:0 0 14px">${escapeHtml(senderRole)} has posted a new message in the ${escapeHtml(clubName)} group chat. Log in to SOAC to read it and reply.</p>
      <p style="color:#333;font-size:15px;line-height:1.7;margin:22px 0 4px">Regards,<br/>SOAC RKU</p>
      <div style="margin:26px 0">
        <a href="${APP_URL}/student/clubs/${clubId}" style="display:inline-block;background:#635BFF;color:#fff;text-decoration:none;font-weight:700;padding:11px 24px;border-radius:8px">Open club chat</a>
      </div>
      ${footer()}
    `),
  });
};

/* Club Feed — a member submitted a photo / video for review. Sent to the club's
   Student Coordinator and Faculty Advisor, with a preview and a link that opens
   the submission in their review screen. */
const feedPreviewImage = (mediaType, mediaUrl) => {
  if (!mediaUrl) return '';
  if (mediaType !== 'video') return mediaUrl;
  /* Cloudinary can serve a still frame of the video as a JPEG */
  return /\/video\/upload\//.test(mediaUrl)
    ? mediaUrl.replace('/video/upload/', '/video/upload/so_1,w_560,c_limit/').replace(/\.[a-z0-9]+(\?.*)?$/i, '.jpg')
    : '';
};
const sendClubFeedReviewRequest = async ({ toEmail, toName, clubName, clubId, studentName, mediaType = 'image', caption = '', mediaUrl = '', postId }) => {
  const what = mediaType === 'video' ? 'video' : 'photo';
  const reviewUrl = `${APP_URL}/coordinator/club-feed${postId ? `?review=${encodeURIComponent(postId)}${clubId ? `&club=${encodeURIComponent(clubId)}` : ''}` : ''}`;
  const previewSrc = feedPreviewImage(mediaType, mediaUrl);
  const preview = previewSrc
    ? `<a href="${reviewUrl}" style="display:block;margin:4px 0 18px"><img src="${escapeHtml(previewSrc)}" alt="${what} preview" style="max-width:100%;max-height:320px;border-radius:10px;display:block"/></a>`
    : '';
  await send({
    to:      toEmail,
    subject: `New ${what} submitted for review — ${clubName} Club Feed`,
    html: plainEmail({
      category: 'Club feed review',
      title:    `A ${what} is waiting for your review`,
      toName,
      intro:    [`${escapeHtml(studentName || 'A member')} has submitted a ${what} to the <strong>${escapeHtml(clubName)}</strong> Club Feed. It goes live for the club once you approve it.`],
      sections: preview + detailTable('', [
        ['Submitted by', studentName],
        ['Club',         clubName],
        ['Type',         what.charAt(0).toUpperCase() + what.slice(1)],
        ['Caption',      caption],
      ]),
      outro:    [`Open it to ${mediaType === 'video' ? 'watch the video' : 'view the photo'} full size, then approve or reject it.`],
      button:   { href: reviewUrl, label: `Review the ${what}` },
    }),
  });
};

/* Club Feed — something new went live. Sent to the club's members; deliberately
   never names who posted it (member or coordinator). */
const sendClubFeedUpdate = async ({ toEmail, toName, clubName, mediaType = 'image' }) => {
  const what = mediaType === 'video' ? 'video' : 'photo';
  await send({
    to:      toEmail,
    subject: `New ${what} in the ${clubName} Club Feed — SOAC RKU`,
    html: wrap(`
      ${header()}
      <h2 style="color:#1a1040;margin-bottom:8px">Hi ${toName || 'there'},</h2>
      <p style="color:#555;line-height:1.6">A new ${what} was just added to the <strong style="color:#635BFF">${clubName}</strong> Club Feed. Take a look at what your club has been up to!</p>
      <div style="text-align:center;margin:26px 0">
        <a href="${APP_URL}/student/clubs-feed" style="display:inline-block;background:#635BFF;color:#fff;text-decoration:none;font-weight:700;padding:12px 28px;border-radius:10px">Open the Club Feed</a>
      </div>
      <div style="background:#f8f7ff;border:1.5px solid #e8e5ff;border-radius:12px;padding:16px 20px;margin:0 0 20px">
        <p style="margin:0;font-size:14px;font-weight:800;color:#1a1040">Got something to share?</p>
        <p style="margin:6px 0 0;font-size:13px;color:#555;line-height:1.6">Add your own photos and videos from club activities, events and practice sessions — tap <strong>Submit</strong> in the Club Feed and your club coordinator will add it for everyone to see.</p>
      </div>
      ${footer()}
    `),
  });
};

/* Club Feed — a member's own submission went live. Encourages them to keep sharing. */
const sendClubFeedPostLive = async ({ toEmail, toName, clubName, mediaType = 'image' }) => {
  const what = mediaType === 'video' ? 'video' : 'photo';
  await send({
    to:      toEmail,
    subject: `Your ${what} is live in the ${clubName} Club Feed 🎉 — SOAC RKU`,
    html: wrap(`
      ${header()}
      <h2 style="color:#1a1040;margin-bottom:8px">Nice one, ${toName || 'there'}!</h2>
      <p style="color:#555;line-height:1.6">Your ${what} has been added to the <strong style="color:#635BFF">${clubName}</strong> Club Feed, and every member of the club can now see it.</p>
      <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:16px 20px;margin:24px 0">
        <p style="margin:0;font-size:14px;font-weight:800;color:#15803d">Keep it coming</p>
        <p style="margin:6px 0 0;font-size:13px;color:#555;line-height:1.6">The Club Feed is where your club's story gets told. Share more from your practice sessions, events and wins — showcase what you do, inspire your teammates and get your work seen.</p>
      </div>
      <div style="text-align:center;margin:26px 0">
        <a href="${APP_URL}/student/clubs-feed" style="display:inline-block;background:#635BFF;color:#fff;text-decoration:none;font-weight:700;padding:12px 28px;border-radius:10px">See it &amp; add more</a>
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
const sendCoordinatorCredentials = async ({ toEmail, toName, password, clubName, roleLabel = 'Coordinator', otherAccountNote = null }) => {
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
      ${otherAccountBox(otherAccountNote)}
      <p style="color:#888;font-size:13px;line-height:1.6">Please change your password after your first login using Profile settings.</p>
      ${footer()}
    `),
  });
};

/* switchNote — set when the role was added to the person's member login:
   explains they switch dashboards instead of using new credentials */
const sendCoordinatorAssignment = async ({ toEmail, toName, clubName, roleLabel = 'Coordinator', switchNote = null }) => {
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
      ${otherAccountBox(switchNote)}
      <p style="color:#888;font-size:13px;line-height:1.6">Your existing credentials are unchanged. Visit <strong>${APP_LOGIN}</strong> to access your portal.</p>
      ${footer()}
    `),
  });
};

/* accountLabel — set when this email has two accounts (member + coordinator /
   advisor), so each reset link says which account it resets */
const sendPasswordReset = async ({ toEmail, toName, token, accountLabel = null }) => {
  const resetUrl = `${APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await send({
    to:      toEmail,
    subject: accountLabel ? `Reset your SOAC RKU password — ${accountLabel}` : 'Reset your SOAC RKU password',
    html: wrap(`
      ${header()}
      <h2 style="color:#1a1040;margin-bottom:8px">Password reset request</h2>
      <p style="color:#555;line-height:1.6">Hi ${toName || 'there'}, we received a request to reset your SOAC account password.</p>
      ${accountLabel ? `<p style="color:#555;line-height:1.6">This link resets your <strong>${accountLabel}</strong>. Your other SOAC account has its own reset email, and the two accounts must have different passwords.</p>` : ''}
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
      <p style="color:#333;font-size:14px;line-height:1.6"><strong>Report required:</strong> please submit the event report from the <strong>Reports</strong> page of your dashboard immediately after the activity is done.</p>
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
  sendClubFeedUpdate,
  sendClubFeedPostLive,
  sendBroadcastEmail,
  sendEventReminder,
  sendClubChatNotice,
  sendClubFeedReviewRequest,
  sendEventRequestForReview,
  sendEventRequestDecision,
  sendDirectMessageNotice,
  sendClubAnnouncementEmail,
  sendJoinRequestsDigest,
  sendClubProposalEmail,
  sendCoordinatorCredentials,
  sendCoordinatorAssignment,
  sendPasswordReset,
  sendTeamAssignment,
  sendGaloreActivityAssignment,
  sendEventPublishedToCoordinator,
  sendVolunteerThanks,
  sendActivityReport,
  sendTestEmail,
};
