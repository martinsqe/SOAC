const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { galoreSecret } = require('../config/secrets');

/* ── Keys for limits that must not lump a whole campus together ──────────────
   On campus Wi-Fi every student reaches us from the same public IP (NAT), so a
   plain per-IP limit lets the first handful through and blocks everyone else —
   exactly when hundreds register for Galore at once. So:
     • signed-in requests (SOAC or Galore portal) count per person — the token's
       signature is checked (cheap HMAC), so a made-up token is just an IP;
     • public forms count per thing being asked for (an enrollment number, an
       email), with a much higher per-IP ceiling on top against abuse. */
const ipKey = (req) => `ip:${ipKeyGenerator(req.ip || '')}`;
const signedInKey = (req) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  const token = h.slice(7);
  for (const secret of [process.env.JWT_SECRET, galoreSecret()]) {
    if (!secret) continue;
    try {
      const p = jwt.verify(token, secret, { algorithms: ['HS256'] });
      const who = p.gid ? `g:${p.gid}` : p.id ? `u:${p.id}` : null;
      if (who) return who;
    } catch { /* not this secret */ }
  }
  return null;
};
const userOrIpKey = (req) => signedInKey(req) || ipKey(req);
const norm = (v) => String(v ?? '').trim().toLowerCase().slice(0, 120);

/* per value of a body field (e.g. the enrollment number), falling back to the IP */
const perField = (windowMinutes, max, field, message) => rateLimit({
  windowMs: windowMinutes * 60 * 1000, limit: max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (norm(req.body?.[field]) ? `${field}:${norm(req.body[field])}` : ipKey(req)),
  message: { message },
});
/* a generous per-IP ceiling (a whole campus behind one IP still fits) */
const ipCeiling = (windowMinutes, max, message) => rateLimit({
  windowMs: windowMinutes * 60 * 1000, limit: max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: ipKey,
  message: { message },
});

/* Per-IP limits for public endpoints that send email or write data, on top of
   the global limiter in server.js. Each returns a JSON message the forms show. */
const limiter = (windowMinutes, max, message) => rateLimit({
  windowMs: windowMinutes * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message },
});

module.exports = {
  ipKey, signedInKey, userOrIpKey, perField, ipCeiling,
  /* "My Activity" lookup mails a report — stop it being used to spam inboxes */
  activityEmailLimiter: limiter(60, 5, 'Too many activity requests from this network — please try again in an hour.'),
  /* Join requests (each one emails a confirmation link) */
  joinRequestLimiter:   limiter(60, 10, 'Too many join requests from this network — please try again in an hour.'),
  joinConfirmLimiter:   limiter(15, 30, 'Too many attempts — please try again in a few minutes.'),
  joinCheckLimiter:     limiter(15, 60, 'Too many requests — please try again in a few minutes.'),
  /* Public event registration / team rosters */
  eventRegisterLimiter: limiter(60, 30, 'Too many registrations from this network — please try again later.'),
  /* Logged-in uploads with personal documents */
  activityClaimLimiter: limiter(60, 20, 'Too many submissions — please try again later.'),
};
