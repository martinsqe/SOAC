const router    = require('express').Router();
const multer    = require('multer');
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
/* Per number (so a whole campus on one Wi-Fi IP isn't blocked together), and a
   per-IP ceiling high enough for that campus but not for someone walking
   through every number. */
const { perField, ipCeiling } = require('../middleware/rateLimits');
const lookupIpCap   = ipCeiling(15, 3000, 'Too many lookups from this network — please try again in a few minutes.');
const lookupPerId   = perField(15, 20, 'id', 'Too many lookups for this number — please try again in a few minutes.');
const lookupLimiter = [lookupIpCap, lookupPerId];
const codeIpCap     = ipCeiling(15, 3000, 'Too many verification attempts from this network — please try again in a few minutes.');
const codeLimiter   = [codeIpCap, perField(15, 6, 'id', 'Too many verification attempts for this number — please try again in a few minutes.')];
const accessLimiter = [codeIpCap, perField(15, 6, 'id', 'Too many login emails asked for this number — please wait a few minutes.')];

router.post('/lookup',      lookupLimiter, optionalAuth, ctrl.lookup);
router.post('/send-link',   codeLimiter, ctrl.sendLink);
/* Galore: verified number → the Galore portal login by email (the one email) */
router.post('/galore-access', accessLimiter, async (req, res, next) => {
  const sel = require('../services/galoreSelection');
  try { res.json(await sel.grantAccess(req.body?.id, req.body?.eventId)); }
  catch (err) { if (err instanceof sel.SelectionError) return res.status(err.status).json({ message: err.message }); next(err); }
});
router.post('/verify-link', lookupLimiter, ctrl.verifyLink);

router.get   ('/departments',     verifyToken, requireAdmin, ctrl.listDepartments);
router.post  ('/departments',     verifyToken, requireAdmin, ctrl.createDepartment);
router.patch ('/departments/:id', verifyToken, requireAdmin, ctrl.renameDepartment);
router.delete('/departments/:id', verifyToken, requireAdmin, ctrl.deleteDepartment);
router.post  ('/import',          verifyToken, requireAdmin, uploadSheet.array('files', 40), ctrl.importFile);
router.get   ('/',                verifyToken, requireAdmin, ctrl.search);

module.exports = router;
