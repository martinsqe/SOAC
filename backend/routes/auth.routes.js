const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { login, logout, me, changePassword, refresh, forgotPassword, resetPassword } = require('../controllers/auth.controller');
const { verifyToken } = require('../middleware/auth');

/* ── Rate limiter for password reset endpoints (prevent spam) ── */
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // 3 requests per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many password reset requests. Try again later.' },
  keyGenerator: (req) => {
    // Rate limit by email if provided, otherwise by IP (IPv6-safe)
    return req.body?.email || ipKeyGenerator(req);
  },
});

router.post('/login',           login);
router.post('/logout',          verifyToken, logout);
router.get('/me',               verifyToken, me);
router.post('/refresh',         refresh);
router.post('/change-password', verifyToken, changePassword);
router.post('/forgot-password', passwordResetLimiter, forgotPassword);
router.post('/reset-password',  passwordResetLimiter, resetPassword);

module.exports = router;
