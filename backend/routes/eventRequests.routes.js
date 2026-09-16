const router = require('express').Router();
const ctrl   = require('../controllers/eventRequests.controller');
const { verifyToken }  = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { uploadEvent }  = require('../config/multer');

/* Coordinator routes */
router.post('/',      verifyToken, uploadEvent.single('image'), ctrl.createRequest);
router.get('/mine',   verifyToken, ctrl.getMyRequests);
router.put('/:id',    verifyToken, uploadEvent.single('image'), ctrl.updateRequest); /* coordinator (own, still pending) */
router.delete('/:id', verifyToken, ctrl.deleteRequest); /* coordinator (own, reviewed) or admin */

/* Admin routes */
router.get('/',                   verifyToken, requireAdmin, ctrl.getRequests);
router.put('/:id/approve',        verifyToken, requireAdmin, uploadEvent.single('image'), ctrl.approveRequest);
router.put('/:id/reject',         verifyToken, requireAdmin, ctrl.rejectRequest);

module.exports = router;
