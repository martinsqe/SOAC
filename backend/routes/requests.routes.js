const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/requests.controller');
const { verifyToken, optionalAuth } = require('../middleware/auth');
const { joinRequestLimiter, joinConfirmLimiter, joinCheckLimiter } = require('../middleware/rateLimits');
const { requireAdmin } = require('../middleware/requireAdmin');

/* Public — student submits a join request (emails a confirmation link unless
   they're logged in as that address), then confirms it from the email */
router.post('/',        joinRequestLimiter, optionalAuth, ctrl.create);
router.post('/confirm', joinConfirmLimiter, ctrl.confirmJoinRequest);

/* Public — pre-submit check; details only for the logged-in owner of the email */
router.get('/check-club-limit', joinCheckLimiter, optionalAuth, ctrl.checkClubLimit);

/* Join requests open/closed — anyone can read it; only admin can change it */
router.get('/join-status', ctrl.getJoinStatus);
router.put('/join-status', verifyToken, requireAdmin, ctrl.setJoinStatus);

/* Protected — coordinator / admin views requests */
router.get('/', verifyToken, ctrl.getAll);

/* Protected — approve / decline (coordinator or admin) */
const requireCoordOrAdmin = (req, res, next) => {
  if (req.user?.role !== 'coordinator' && req.user?.role !== 'faculty_coordinator' && req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Coordinator or admin access required.' });
  }
  next();
};

router.post('/send-stats',       verifyToken, requireAdmin,        ctrl.sendRequestStats);  /* admin: email request statistics */
router.post('/bulk-approve',     verifyToken, requireCoordOrAdmin, ctrl.bulkApprove);
router.post('/bulk-delete',      verifyToken, requireCoordOrAdmin, ctrl.bulkDelete);
router.post('/:id/approve',     verifyToken, requireCoordOrAdmin, ctrl.approve);
router.post('/:id/decline',      verifyToken, requireCoordOrAdmin, ctrl.decline);
router.post('/:id/change-campus', verifyToken, requireAdmin, ctrl.changeCampus);  /* admin: Main ↔ City */
router.post('/:id/resend-email', verifyToken, requireCoordOrAdmin, ctrl.resendEmail);

module.exports = router;
