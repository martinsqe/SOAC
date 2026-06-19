const nodemailer = require('nodemailer');

// Fallback to Vercel production URL so email links work on Railway
const APP_LOGIN_URL = `${process.env.CLIENT_URL || 'https://soac-txy7.vercel.app'}/login`;

// Build transporter lazily on first use so it always reads the current
// process.env values (Railway sets them before the process starts).
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const smtpUser = process.env.SMTP_USER || 'mjjemba9@gmail.com';
  const smtpPass = (process.env.SMTP_PASS || 'yhzx logi zuug sylj').replace(/\s+/g, '');
  const smtpFrom = process.env.EMAIL_FROM || `SOAC RKU <${smtpUser}>`;
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);

  _transporter = nodemailer.createTransport({
    host:       smtpHost,
    port:       smtpPort,
    secure:     smtpPort === 465,
    requireTLS: smtpPort !== 465,
    auth:       { user: smtpUser, pass: smtpPass },
    tls:        { rejectUnauthorized: false },
  });

  // Store resolved from address on the transporter for reuse
  _transporter._fromAddr = smtpFrom;

  _transporter.verify().then(() => {
    console.log(`✉️  SMTP ready — ${smtpHost}:${smtpPort} as ${smtpUser}`);
  }).catch(err => {
    console.warn(`⚠️  SMTP verify failed (${smtpHost}): ${err.message}`);
    _transporter = null; // force retry on next send
  });

  return _transporter;
}

/**
 * Send login credentials to a newly created user.
 */
const sendCredentials = async ({ toEmail, toName, password, clubName = null }) => {
  const clubLine = clubName
    ? `<p style="color:#555;line-height:1.6">Your request to join <strong style="color:#635BFF">${clubName}</strong> has been approved by the coordinator. Use the credentials below to sign in to the SOAC platform.</p>`
    : `<p style="color:#555;line-height:1.6">Your account on the SOAC RKU Platform has been created. Use the credentials below to sign in.</p>`;

  const t = getTransporter();
  await t.sendMail({
    from:    t._fromAddr,
    to:      toEmail,
    subject: clubName ? `You're in! Welcome to ${clubName} — SOAC RKU` : 'Your SOAC RKU Account Credentials',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
        <div style="background:linear-gradient(135deg,#635BFF,#a78bfa);border-radius:12px;padding:20px 24px;margin-bottom:24px;text-align:center">
          <p style="margin:0;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px">SOAC · RK University</p>
          <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.7)">Student Organizations Advisory Council</p>
        </div>
        <h2 style="color:#1a1040;margin-bottom:8px">Welcome, ${toName}! 🎉</h2>
        ${clubLine}
        <div style="background:#f8f7ff;border:1.5px solid #e8e5ff;border-radius:12px;padding:20px 24px;margin:24px 0">
          <p style="margin:0 0 6px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Login URL</p>
          <p style="margin:0 0 16px;font-weight:700;color:#635BFF">${APP_LOGIN_URL}</p>
          <p style="margin:0 0 6px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Email</p>
          <p style="margin:0 0 16px;font-weight:700;color:#1a1040">${toEmail}</p>
          <p style="margin:0 0 6px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Temporary Password</p>
          <p style="margin:0;font-weight:800;color:#D32F2F;font-size:20px;letter-spacing:3px;font-family:monospace">${password}</p>
        </div>
        <p style="color:#888;font-size:13px;line-height:1.6">⚠️ Please change your password after your first login. Students can join up to <strong>3 clubs</strong> on the platform.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#bbb;font-size:12px">SOAC · Student Organizations Advisory Council · RK University</p>
      </div>
    `,
  });
};

/**
 * Send club-approval notification to an existing user (no new credentials).
 */
const sendApproval = async ({ toEmail, toName, clubName }) => {
  const t = getTransporter();
  await t.sendMail({
    from:    t._fromAddr,
    to:      toEmail,
    subject: `You're approved! Welcome to ${clubName} — SOAC RKU`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
        <div style="background:linear-gradient(135deg,#635BFF,#a78bfa);border-radius:12px;padding:20px 24px;margin-bottom:24px;text-align:center">
          <p style="margin:0;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px">SOAC · RK University</p>
          <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.7)">Student Organizations Advisory Council</p>
        </div>
        <h2 style="color:#1a1040;margin-bottom:8px">Congratulations, ${toName}! 🎉</h2>
        <p style="color:#555;line-height:1.6">Your request to join <strong style="color:#635BFF">${clubName}</strong> has been approved by the coordinator. You are now an official member!</p>
        <div style="background:#f0fff8;border:1.5px solid #86efac;border-radius:12px;padding:20px 24px;margin:24px 0;text-align:center">
          <p style="margin:0;font-size:16px;font-weight:800;color:#15803d">✓ Member of ${clubName}</p>
          <p style="margin:6px 0 0;font-size:13px;color:#555">Log in to your SOAC dashboard to access your club, connect with members, and stay updated.</p>
        </div>
        <p style="color:#888;font-size:13px;line-height:1.6">You can join up to <strong>3 clubs</strong> on the platform. Check your student dashboard to explore more clubs.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#bbb;font-size:12px">SOAC · Student Organizations Advisory Council · RK University</p>
      </div>
    `,
  });
};

/**
 * Send coordinator credentials to a brand-new coordinator account.
 */
const sendCoordinatorCredentials = async ({ toEmail, toName, password, clubName }) => {
  const t = getTransporter();
  await t.sendMail({
    from:    t._fromAddr,
    to:      toEmail,
    subject: `You've been appointed Coordinator of ${clubName} — SOAC RKU`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
        <div style="background:linear-gradient(135deg,#4c44e0,#a78bfa);border-radius:12px;padding:20px 24px;margin-bottom:24px;text-align:center">
          <p style="margin:0;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px">SOAC · RK University</p>
          <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.7)">Student Organizations Advisory Council</p>
        </div>
        <h2 style="color:#1a1040;margin-bottom:8px">Congratulations, ${toName}! 👔</h2>
        <p style="color:#555;line-height:1.6">You have been appointed as <strong style="color:#4c44e0">Club Coordinator</strong> for <strong style="color:#4c44e0">${clubName}</strong> on the SOAC RKU Platform. A coordinator account has been created for you.</p>
        <div style="background:#f5f3ff;border:1.5px solid #c4b5fd;border-radius:12px;padding:20px 24px;margin:24px 0">
          <p style="margin:0 0 6px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Login URL</p>
          <p style="margin:0 0 16px;font-weight:700;color:#4c44e0">${APP_LOGIN_URL}</p>
          <p style="margin:0 0 6px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Email</p>
          <p style="margin:0 0 16px;font-weight:700;color:#1a1040">${toEmail}</p>
          <p style="margin:0 0 6px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;font-weight:700">Temporary Password</p>
          <p style="margin:0;font-weight:800;color:#D32F2F;font-size:20px;letter-spacing:3px;font-family:monospace">${password}</p>
        </div>
        <div style="background:#f0f7ff;border:1.5px solid #93c5fd;border-radius:12px;padding:16px 20px;margin-bottom:24px">
          <p style="margin:0;font-size:14px;font-weight:700;color:#1d4ed8">📋 Your Responsibilities as Coordinator</p>
          <ul style="margin:8px 0 0;padding-left:20px;color:#555;font-size:13px;line-height:1.8">
            <li>Review and approve student membership requests</li>
            <li>Post club news and announcements</li>
            <li>Create and manage club events</li>
            <li>Manage club leadership and hierarchy</li>
          </ul>
        </div>
        <p style="color:#888;font-size:13px;line-height:1.6">⚠️ Please change your password after your first login using the <strong>Profile</strong> settings in your dashboard.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#bbb;font-size:12px">SOAC · Student Organizations Advisory Council · RK University</p>
      </div>
    `,
  });
};

/**
 * Notify an existing user that they have been assigned as coordinator of a club.
 */
const sendCoordinatorAssignment = async ({ toEmail, toName, clubName }) => {
  const t = getTransporter();
  await t.sendMail({
    from:    t._fromAddr,
    to:      toEmail,
    subject: `You've been assigned as Coordinator of ${clubName} — SOAC RKU`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
        <div style="background:linear-gradient(135deg,#4c44e0,#a78bfa);border-radius:12px;padding:20px 24px;margin-bottom:24px;text-align:center">
          <p style="margin:0;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px">SOAC · RK University</p>
          <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.7)">Student Organizations Advisory Council</p>
        </div>
        <h2 style="color:#1a1040;margin-bottom:8px">Hello, ${toName}! 👔</h2>
        <p style="color:#555;line-height:1.6">You have been appointed as <strong style="color:#4c44e0">Club Coordinator</strong> for <strong style="color:#4c44e0">${clubName}</strong> on the SOAC RKU Platform.</p>
        <div style="background:#f0fff8;border:1.5px solid #86efac;border-radius:12px;padding:20px 24px;margin:24px 0;text-align:center">
          <p style="margin:0;font-size:16px;font-weight:800;color:#15803d">✓ Coordinator of ${clubName}</p>
          <p style="margin:6px 0 0;font-size:13px;color:#555">Log in to your SOAC Coordinator Portal to manage your club, members, and events.</p>
        </div>
        <div style="background:#f0f7ff;border:1.5px solid #93c5fd;border-radius:12px;padding:16px 20px;margin-bottom:24px">
          <p style="margin:0;font-size:14px;font-weight:700;color:#1d4ed8">📋 Your Responsibilities as Coordinator</p>
          <ul style="margin:8px 0 0;padding-left:20px;color:#555;font-size:13px;line-height:1.8">
            <li>Review and approve student membership requests</li>
            <li>Post club news and announcements</li>
            <li>Create and manage club events</li>
            <li>Manage club leadership and hierarchy</li>
          </ul>
        </div>
        <p style="color:#888;font-size:13px;line-height:1.6">Your existing login credentials remain unchanged. Visit <strong>${APP_LOGIN_URL}</strong> to access your Coordinator Portal.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#bbb;font-size:12px">SOAC · Student Organizations Advisory Council · RK University</p>
      </div>
    `,
  });
};

const sendPasswordReset = async ({ toEmail, toName, token }) => {
  const resetUrl = `${process.env.CLIENT_URL || 'https://soac-txy7.vercel.app'}/reset-password?token=${encodeURIComponent(token)}`;
  const t = getTransporter();
  await t.sendMail({
    from: t._fromAddr,
    to: toEmail,
    subject: 'Reset your SOAC RKU password',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
        <div style="background:linear-gradient(135deg,#635BFF,#a78bfa);border-radius:12px;padding:20px 24px;margin-bottom:24px;text-align:center">
          <p style="margin:0;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.5px">SOAC · RK University</p>
          <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.7)">Student Organizations Advisory Council</p>
        </div>
        <h2 style="color:#1a1040;margin-bottom:8px">Password reset request</h2>
        <p style="color:#555;line-height:1.6">Hi ${toName || 'there'}, we received a request to reset your SOAC account password.</p>
        <div style="background:#f8f7ff;border:1.5px solid #e8e5ff;border-radius:12px;padding:20px 24px;margin:24px 0;text-align:center">
          <a href="${resetUrl}" style="display:inline-block;padding:12px 20px;background:#635BFF;color:#fff;text-decoration:none;border-radius:10px;font-weight:700">Reset Password</a>
          <p style="margin:14px 0 0;font-size:12px;color:#6b7280;line-height:1.6">This link expires in 30 minutes. If the button does not work, copy and paste this URL:</p>
          <p style="margin:8px 0 0;font-size:12px;color:#4f46e5;word-break:break-all">${resetUrl}</p>
        </div>
        <p style="color:#888;font-size:13px;line-height:1.6">If you did not request this, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#bbb;font-size:12px">SOAC · Student Organizations Advisory Council · RK University</p>
      </div>
    `,
  });
};

module.exports = { sendCredentials, sendApproval, sendCoordinatorCredentials, sendCoordinatorAssignment, sendPasswordReset };
