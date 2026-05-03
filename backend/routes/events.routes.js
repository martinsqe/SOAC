const router      = require('express').Router();
const ctrl        = require('../controllers/events.controller');
const { verifyToken }  = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { uploadEvent }  = require('../config/multer');

const requireCoordOrAdmin = (req, res, next) => {
  if (req.user?.role !== 'coordinator' && req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Coordinator or admin access required.' });
  }
  next();
};

router.get('/',             ctrl.getAll);
router.get('/live-scores',  ctrl.getLiveScores);
router.get('/past-scores',  ctrl.getPastScores);
router.get('/:id',          ctrl.getOne);
router.post('/',       verifyToken, requireCoordOrAdmin, uploadEvent.single('image'), ctrl.create);
router.put('/:id',     verifyToken, requireCoordOrAdmin, uploadEvent.single('image'), ctrl.update);
router.delete('/:id',  verifyToken, requireAdmin, ctrl.remove);

/* Registration routes */
router.post('/:id/register',     ctrl.register);                                         /* public            */
router.get('/:id/registrations', verifyToken, requireCoordOrAdmin, ctrl.listRegistrations); /* admin + coord */

module.exports = router;
