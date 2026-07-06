const router = require('express').Router();
const ctrl   = require('../controllers/explore.controller');
const { verifyToken } = require('../middleware/auth');
const { uploadExplore } = require('../config/multer');

const requireCoordOrAdmin = (req, res, next) => {
  if (req.user?.role !== 'coordinator' && req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Coordinator or admin access required.' });
  }
  next();
};

router.get   ('/',    ctrl.getPosts);
router.post  ('/',    verifyToken, requireCoordOrAdmin, uploadExplore.single('image'), ctrl.createPost);
router.delete('/:id', verifyToken, requireCoordOrAdmin, ctrl.deletePost);

module.exports = router;
