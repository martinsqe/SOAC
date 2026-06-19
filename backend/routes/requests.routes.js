const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/requests.controller');
const { verifyToken }  = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');

/* Public — student submits a join request */
router.post('/', ctrl.create);

/* Protected — coordinator / admin views requests */
router.get('/', verifyToken, ctrl.getAll);

/* Protected — approve / decline (coordinator or admin) */
const requireCoordOrAdmin = (req, res, next) => {
  if (req.user?.role !== 'coordinator' && req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Coordinator or admin access required.' });
  }
  next();
};

router.post('/:id/approve',      verifyToken, requireCoordOrAdmin, ctrl.approve);
router.post('/:id/decline',      verifyToken, requireCoordOrAdmin, ctrl.decline);
router.post('/:id/resend-email', verifyToken, requireCoordOrAdmin, ctrl.resendEmail);

module.exports = router;
