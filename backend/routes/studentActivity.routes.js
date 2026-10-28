const router = require('express').Router();
const ctrl   = require('../controllers/studentActivity.controller');
const { verifyToken } = require('../middleware/auth');
const { uploadDocumentMemory } = require('../config/multer');
const { activityClaimLimiter } = require('../middleware/rateLimits');

const requireCoordinator = (req, res, next) => {
  if (req.user?.role !== 'coordinator' && req.user?.role !== 'faculty_coordinator') {
    return res.status(403).json({ message: 'Coordinator access required.' });
  }
  next();
};

/* Proof upload (PDF, Word or image, 15 MB) — multer's own errors (file too
   large, wrong type) come back as a plain 400 the form can show */
const proofUpload = (req, res, next) => {
  uploadDocumentMemory.single('proof')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'The proof file is too large — please keep it under 15 MB.'
      : err.message || 'The proof file could not be read.';
    res.status(400).json({ message });
  });
};

/* Student */
router.get('/clubs', verifyToken, ctrl.clubOptions);
router.get('/mine',  verifyToken, ctrl.myClaims);
router.post('/',     verifyToken, activityClaimLimiter, proofUpload, ctrl.submitClaim);

/* A fresh one-hour link to a claim's proof (owner, the club's SC / FA, admin) */
router.get('/:id/proof', verifyToken, ctrl.proofLink);

/* Coordinator (Student Coordinator / Faculty Advisor of the club) */
router.get('/review',      verifyToken, requireCoordinator, ctrl.reviewQueue);
router.put('/:id/approve', verifyToken, requireCoordinator, ctrl.approveClaim);
router.put('/:id/reject',  verifyToken, requireCoordinator, ctrl.rejectClaim);

/* Owning student (pending / rejected) or a coordinator of the club */
router.delete('/:id', verifyToken, ctrl.deleteClaim);

module.exports = router;
