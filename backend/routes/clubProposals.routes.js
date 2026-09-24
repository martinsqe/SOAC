const router       = require('express').Router();
const jwt          = require('jsonwebtoken');
const rateLimit    = require('express-rate-limit');
const ctrl         = require('../controllers/clubProposals.controller');
const { verifyToken }  = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { uploadLogo }   = require('../config/multer');
const tokenBlacklist   = require('../services/tokenBlacklist');

/* Identify the proposer when they're logged in, but never block a guest —
   the public /clubs page lets anyone apply (same as join requests). A missing,
   expired or revoked token just means the submission is treated as a guest's. */
const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const revoked = await tokenBlacklist.isRevoked(token)
      || await tokenBlacklist.wasRevokedByUser(decoded.id, decoded.iat);
    if (!revoked) req.user = decoded;
  } catch { /* treat as guest */ }
  next();
};

/* Submissions are public, so cap them per IP to keep the admin queue spam-free. */
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many club proposals from this network — please try again later.' },
});

/* Anyone (guest, student, coordinator) can propose a club */
router.post('/', submitLimiter, optionalAuth, ctrl.submit);

/* Admin-only operations */
router.get('/',                  verifyToken, requireAdmin, ctrl.list);
router.get('/counts',            verifyToken, requireAdmin, ctrl.counts);
router.get('/:id',               verifyToken, requireAdmin, ctrl.getOne);
router.post('/:id/reject',       verifyToken, requireAdmin, ctrl.reject);
router.post('/:id/approve',      verifyToken, requireAdmin, uploadLogo.single('logo'), ctrl.approve);

module.exports = router;
