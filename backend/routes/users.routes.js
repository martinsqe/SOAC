const router      = require('express').Router();
const ctrl        = require('../controllers/users.controller');
const { verifyToken }  = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { uploadAvatar } = require('../config/multer');

router.get('/',  verifyToken, requireAdmin, ctrl.getAll);
router.post('/', verifyToken, requireAdmin, ctrl.create);

// Specific /me and /meta routes MUST come before /:id to avoid Express matching 'me'/'meta' as an id
router.get('/me/clubs',   verifyToken, ctrl.myClubs);
router.get('/me/coins',   verifyToken, ctrl.myCoins);
router.put('/me/profile', verifyToken, uploadAvatar.single('avatar'), ctrl.updateProfile);

router.get('/meta/stats', verifyToken, requireAdmin, ctrl.stats);
router.get('/meta/audit', verifyToken, requireAdmin, ctrl.auditLog);

// Dynamic :id routes last
router.put('/:id',             verifyToken, requireAdmin, ctrl.update);
router.put('/:id/assign-club', verifyToken, requireAdmin, ctrl.assignClub);
router.delete('/:id',          verifyToken, requireAdmin, ctrl.remove);

module.exports = router;
