const rateLimit = require('express-rate-limit');

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
