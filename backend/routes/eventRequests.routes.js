const router = require('express').Router();
const ctrl   = require('../controllers/eventRequests.controller');
const { verifyToken }  = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { uploadEvent }  = require('../config/multer');

/* Coordinator (Student or Faculty) routes */
router.post('/',      verifyToken, uploadEvent.single('image'), ctrl.createRequest);
router.get('/mine',   verifyToken, ctrl.getMyRequests);
router.put('/:id',    verifyToken, uploadEvent.single('image'), ctrl.updateRequest); /* coordinator (own, still pending) */
router.delete('/:id', verifyToken, ctrl.deleteRequest); /* coordinator (own, reviewed) or admin */

/* Faculty Coordinator review queue (their clubs' SC requests) — admin may also
   view/act here for oversight, per checks inside the controller itself. */
router.get('/fc',            verifyToken, ctrl.getFCQueue);
router.put('/:id/fc-approve', verifyToken, ctrl.fcApproveRequest);
router.put('/:id/fc-reject',  verifyToken, ctrl.fcRejectRequest);

/* Admin routes */
router.get('/',                   verifyToken, requireAdmin, ctrl.getRequests);
router.put('/:id/approve',        verifyToken, requireAdmin, uploadEvent.single('image'), ctrl.approveRequest);
router.put('/:id/reject',         verifyToken, requireAdmin, ctrl.rejectRequest);

module.exports = router;
