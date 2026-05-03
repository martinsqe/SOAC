const router = require('express').Router();
const ctrl   = require('../controllers/fame.controller');
const { verifyToken }  = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { uploadFame }   = require('../config/multer');

/* ── Public (All Logged-in Users) ── */
router.get('/', verifyToken, ctrl.getAll);

/* ── Admin Management ── */
router.post('/',   verifyToken, requireAdmin, uploadFame.single('image'), ctrl.create);
router.put('/:id', verifyToken, requireAdmin, uploadFame.single('image'), ctrl.update);
router.delete('/:id', verifyToken, requireAdmin, ctrl.remove);

module.exports = router;
