const router = require('express').Router();
const ctrl   = require('../controllers/eventRequests.controller');
const { verifyToken }  = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');

/* Coordinator routes */
router.post('/',      verifyToken, ctrl.createRequest);
router.get('/mine',   verifyToken, ctrl.getMyRequests);

/* Admin routes */
router.get('/',                   verifyToken, requireAdmin, ctrl.getRequests);
router.put('/:id/approve',        verifyToken, requireAdmin, ctrl.approveRequest);
router.put('/:id/reject',         verifyToken, requireAdmin, ctrl.rejectRequest);

module.exports = router;
