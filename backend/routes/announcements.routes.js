const router = require('express').Router();
const ctrl   = require('../controllers/announcements.controller');
const { verifyToken }  = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');

const requireCoordOrAdmin = (req, res, next) => {
  if (req.user?.role !== 'coordinator' && req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Coordinator or admin access required.' });
  }
  next();
};

/* ── Public reads ── */
router.get('/',     ctrl.getClubFeed);   // ?clubId=<id>  → club news feed
router.get('/soac', ctrl.getSOACFeed);   //               → SOAC-wide feed

/* ── Protected writes ── */
router.post('/',     verifyToken, requireCoordOrAdmin, ctrl.createClubAnnouncement);
router.post('/soac', verifyToken, requireAdmin,        ctrl.createSOACAnnouncement);
router.delete('/:id',verifyToken, ctrl.remove);

module.exports = router;
