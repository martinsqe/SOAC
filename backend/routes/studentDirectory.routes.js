const router    = require('express').Router();
const multer    = require('multer');
const rateLimit = require('express-rate-limit');
const ctrl      = require('../controllers/studentDirectory.controller');
const { verifyToken, optionalAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');

/* Excel only, kept in memory — the file is parsed and thrown away, never stored */
const uploadSheet = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.xlsx$/i.test(file.originalname);
    cb(ok ? null : Object.assign(new Error('Upload an Excel workbook (.xlsx).'), { status: 400 }), ok);
  },
});

/* Lookups are public, so cap them per IP — stops anyone walking through
   enrollment numbers to harvest names. Sending links is capped tighter still. */
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many lookups from this network — please try again in a few minutes.' },
});
const codeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many verification attempts — please try again in a few minutes.' },
});

router.post('/lookup',      lookupLimiter, optionalAuth, ctrl.lookup);
router.post('/send-link',   codeLimiter, ctrl.sendLink);
router.post('/verify-link', lookupLimiter, ctrl.verifyLink);

router.get   ('/departments',     verifyToken, requireAdmin, ctrl.listDepartments);
router.post  ('/departments',     verifyToken, requireAdmin, ctrl.createDepartment);
router.patch ('/departments/:id', verifyToken, requireAdmin, ctrl.renameDepartment);
router.delete('/departments/:id', verifyToken, requireAdmin, ctrl.deleteDepartment);
router.post  ('/import',          verifyToken, requireAdmin, uploadSheet.array('files', 40), ctrl.importFile);
router.get   ('/',                verifyToken, requireAdmin, ctrl.search);

module.exports = router;
