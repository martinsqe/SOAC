const router      = require('express').Router();
const ctrl        = require('../controllers/events.controller');
const teamCtrl    = require('../controllers/eventTeams.controller');
const groupCtrl   = require('../controllers/eventGroups.controller');
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

/* Fixtures routes */
router.get ('/:id/public-fixtures',          teamCtrl.getPublicFixtures);                                   /* public */
router.get ('/:id/fixtures',                 verifyToken, requireCoordOrAdmin, teamCtrl.getFixtures);        /* coord  */
router.post('/:id/fixtures/save-declare',    verifyToken, requireCoordOrAdmin, teamCtrl.saveAndDeclare);     /* coord  */

/* Groups routes */
router.get   ('/:id/public-groups',                       groupCtrl.getPublicGroups);                              /* public */
router.get   ('/:id/groups',                              verifyToken, requireCoordOrAdmin, groupCtrl.getGroups);   /* coord  */
router.post  ('/:id/groups',                              verifyToken, requireCoordOrAdmin, groupCtrl.createGroup);
router.patch ('/:id/groups/:groupId',                     verifyToken, requireCoordOrAdmin, groupCtrl.renameGroup);
router.delete('/:id/groups/:groupId',                     verifyToken, requireCoordOrAdmin, groupCtrl.deleteGroup);
router.post  ('/:id/groups/:groupId/assign',              verifyToken, requireCoordOrAdmin, groupCtrl.assignTeam);
router.delete('/:id/groups/:groupId/teams/:teamId',       verifyToken, requireCoordOrAdmin, groupCtrl.unassignTeam);

module.exports = router;
