const router = require('express').Router();
const ctrl   = require('../controllers/fame.controller');
const { verifyToken }  = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { uploadFame }   = require('../config/multer');

// Accept cover photo + up to 5 achievement gallery photos
const fameUpload = uploadFame.fields([
  { name: 'image',   maxCount: 1 },
  { name: 'gallery', maxCount: 5 },
]);

router.get('/',       verifyToken,               ctrl.getAll);
router.post('/',      verifyToken, requireAdmin, fameUpload, ctrl.create);
router.put('/:id',    verifyToken, requireAdmin, fameUpload, ctrl.update);
router.delete('/:id', verifyToken, requireAdmin,             ctrl.remove);

module.exports = router;
