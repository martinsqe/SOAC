const router = require('express').Router();
const ctrl   = require('../controllers/clubFeed.controller');
const { verifyToken }  = require('../middleware/auth');
const { uploadClubFeedMedia } = require('../config/multer');

const requireCoordinator = (req, res, next) => {
  if (req.user?.role !== 'coordinator') {
    return res.status(403).json({ message: 'Coordinator access required.' });
  }
  next();
};

/* Student routes */
router.post('/',    verifyToken, uploadClubFeedMedia.single('media'), ctrl.createPost);
router.get('/',      verifyToken, ctrl.getFeed);
router.get('/mine',  verifyToken, ctrl.getMyPosts);

/* Coordinator routes */
router.get('/review',        verifyToken, requireCoordinator, ctrl.getReviewQueue);
router.put('/:id/approve',   verifyToken, requireCoordinator, ctrl.approvePost);
router.put('/:id/reject',    verifyToken, requireCoordinator, ctrl.rejectPost);

/* Owning student, coordinator of that club, or admin */
router.delete('/:id', verifyToken, ctrl.deletePost);

module.exports = router;
