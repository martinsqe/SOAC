const router      = require('express').Router();
const ctrl        = require('../controllers/events.controller');
const teamCtrl    = require('../controllers/eventTeams.controller');
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

/* Team routes (coordinator/admin) */
router.get   ('/:id/teams',                              verifyToken, requireCoordOrAdmin, teamCtrl.getTeams);
router.post  ('/:id/teams',                              verifyToken, requireCoordOrAdmin, teamCtrl.createTeam);
router.put   ('/:id/teams/:teamId',                      verifyToken, requireCoordOrAdmin, teamCtrl.updateTeam);
router.delete('/:id/teams/:teamId',                      verifyToken, requireCoordOrAdmin, teamCtrl.deleteTeam);
router.patch ('/:id/teams/:teamId/clear',                verifyToken, requireCoordOrAdmin, teamCtrl.toggleClear);
router.post  ('/:id/teams/:teamId/members',              verifyToken, requireCoordOrAdmin, teamCtrl.addMember);
router.delete('/:id/teams/:teamId/members/:memberId',    verifyToken, requireCoordOrAdmin, teamCtrl.removeMember);

module.exports = router;
