const router = require('express').Router();
const ctrl   = require('../controllers/activityMonitor.controller');
const { verifyToken }  = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');

router.use(verifyToken, requireAdmin);

router.get('/filters',          ctrl.getFilters);
router.get('/summary',          ctrl.getSummary);
router.get('/members',          ctrl.getMembers);
router.get('/members/:userId',  ctrl.getMemberDetail);
router.get('/clubs',            ctrl.getClubs);
router.get('/coordinators',     ctrl.getCoordinators);

module.exports = router;
