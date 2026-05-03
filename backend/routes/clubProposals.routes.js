const router       = require('express').Router();
const ctrl         = require('../controllers/clubProposals.controller');
const { verifyToken }  = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { uploadLogo }   = require('../config/multer');

/* Any authenticated user can propose a club */
router.post('/', verifyToken, ctrl.submit);

/* Admin-only operations */
router.get('/',                  verifyToken, requireAdmin, ctrl.list);
router.post('/:id/reject',       verifyToken, requireAdmin, ctrl.reject);
router.post('/:id/approve',      verifyToken, requireAdmin, uploadLogo.single('logo'), ctrl.approve);

module.exports = router;
