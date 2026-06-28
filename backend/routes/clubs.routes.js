const router = require('express').Router();
const ctrl   = require('../controllers/clubs.controller');
const cd     = require('../controllers/clubDetail.controller');
const perf   = require('../controllers/clubPerformance.controller');
const { verifyToken }  = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { requireCoordinatorOwnership } = require('../middleware/requireCoordinatorOwnership');
const { uploadLogo, uploadLeadership } = require('../config/multer');
const msgRateLimit     = require('../middleware/msgRateLimit');

const requireCoordOrAdmin = (req, res, next) => {
  const role = String(req.user?.role || '').toLowerCase();
  if (role !== 'coordinator' && role !== 'admin') {
    return res.status(403).json({ message: 'Coordinator or admin access required.' });
  }
  next();
};

/* ── Static-path routes must come before /:id ── */
router.get('/',         ctrl.getAll);
router.get('/public/stats', ctrl.publicStats);
router.get('/stats',    verifyToken, requireAdmin, ctrl.stats);
router.post('/seed',    verifyToken, requireAdmin, ctrl.seed);
router.get('/mine',        verifyToken, requireCoordOrAdmin, ctrl.mine);
router.get('/members',     verifyToken, requireAdmin, ctrl.getAllMembers);   // admin: all clubs
router.get('/leaderboard',    ctrl.getLeaderboard);                            // public: coin leaderboard
router.get('/coins-overview', verifyToken, requireAdmin, ctrl.coinsOverview); // admin: per-club top-3

router.get('/coordinator-assignments', verifyToken, requireAdmin, ctrl.getCoordinatorAssignments);

/* ── Single club ── */
router.get('/:id',      ctrl.getOne);

/* ── Members: open to any authenticated user ── */
router.get('/:id/members', verifyToken, ctrl.getMembers);

/* ── Membership check (student/coord/admin) ── */
router.get('/:id/membership', verifyToken, cd.getMembership);

/* ── Leadership (public read, coord/admin write) ── */
router.get('/:id/leadership', cd.getLeadership);
router.put('/:id/leadership', verifyToken, requireCoordinatorOwnership, uploadLeadership.any(), cd.setLeadership);

/* ── Chat messages ── */
router.get('/:id/messages',  verifyToken, cd.getMessages);
router.post('/:id/messages', verifyToken, msgRateLimit(), cd.postMessage);

/* ── Tasks ── */
router.get('/:id/tasks',                             verifyToken, cd.getTasks);
router.post('/:id/tasks',                            verifyToken, requireCoordinatorOwnership, cd.createTask);
router.patch('/:id/tasks/:taskId',                   verifyToken, requireCoordinatorOwnership, cd.updateTask);
router.delete('/:id/tasks/:taskId',                  verifyToken, requireCoordinatorOwnership, cd.deleteTask);
router.get('/:id/tasks/:taskId/completions',         verifyToken, requireCoordinatorOwnership, cd.getTaskCompletions);
router.post('/:id/tasks/:taskId/completions',        verifyToken, requireCoordinatorOwnership, cd.saveTaskCompletions);

/* ── Overview (coordinator self-service) ── */
router.patch('/:id/overview', verifyToken, requireCoordinatorOwnership, cd.updateOverview);

/* ── Attendance ── */
router.get('/:id/attendance',                       verifyToken, requireCoordinatorOwnership, cd.getAttendance);
router.get('/:id/attendance/:sessionId/records',    verifyToken, requireCoordinatorOwnership, cd.getAttendanceSession);
router.post('/:id/attendance',                      verifyToken, requireCoordinatorOwnership, cd.createAttendanceSession);
router.patch('/:id/attendance/records/:recordId',   verifyToken, requireCoordinatorOwnership, cd.updateAttendanceRecord);
router.delete('/:id/attendance/:sessionId',         verifyToken, requireCoordinatorOwnership, cd.deleteAttendanceSession);

/* ── Member progress (XP/level management) ── */
router.get('/:id/progress',             verifyToken, requireCoordinatorOwnership, cd.getProgress);
router.put('/:id/progress/:userId',     verifyToken, requireCoordinatorOwnership, cd.upsertProgress);

/* ── Advanced performance tracking ── */
router.get('/:id/performance/params',                     verifyToken, requireCoordinatorOwnership, perf.getParams);
router.post('/:id/performance/params',                    verifyToken, requireCoordinatorOwnership, perf.createParam);
router.put('/:id/performance/params/:paramId',            verifyToken, requireCoordinatorOwnership, perf.updateParam);
router.delete('/:id/performance/params/:paramId',         verifyToken, requireCoordinatorOwnership, perf.deleteParam);
router.post('/:id/performance/records',                   verifyToken, requireCoordinatorOwnership, perf.recordAssessment);
router.get('/:id/performance/dashboard',                  verifyToken, requireCoordinatorOwnership, perf.getProgressDashboard);
router.get('/:id/performance/player/:userId',             verifyToken, requireCoordinatorOwnership, perf.getPlayerTimeline);

/* ── Live scoreboards ── */
router.get('/:id/live-scores',               verifyToken, requireCoordinatorOwnership, cd.getLiveScores);
router.post('/:id/live-scores',              verifyToken, requireCoordinatorOwnership, cd.createLiveScore);
router.patch('/:id/live-scores/:scoreId',    verifyToken, requireCoordinatorOwnership, cd.updateLiveScore);
router.delete('/:id/live-scores/:scoreId',   verifyToken, requireCoordinatorOwnership, cd.deleteLiveScore);
router.post('/:id/live-scores/:scoreId/start', verifyToken, requireCoordinatorOwnership, cd.startLiveScore);
router.post('/:id/live-scores/:scoreId/end',   verifyToken, requireCoordinatorOwnership, cd.endLiveScore);
router.post('/:id/live-scores/:scoreId/timer/start', verifyToken, requireCoordinatorOwnership, cd.startLiveTimer);
router.post('/:id/live-scores/:scoreId/timer/stop',  verifyToken, requireCoordinatorOwnership, cd.stopLiveTimer);
router.post('/:id/live-scores/:scoreId/timer/reset', verifyToken, requireCoordinatorOwnership, cd.resetLiveTimer);
router.get('/:id/live-scores/:scoreId/events', verifyToken, requireCoordinatorOwnership, cd.getBasketballEvents);
router.post('/:id/live-scores/:scoreId/events', verifyToken, requireCoordinatorOwnership, cd.logBasketballEvent);
router.patch('/:id/live-scores/:scoreId/events/:eventId', verifyToken, requireCoordinatorOwnership, cd.editBasketballEvent);
router.post('/:id/live-scores/:scoreId/undo', verifyToken, requireCoordinatorOwnership, cd.undoBasketballEvent);
router.post('/:id/live-scores/:scoreId/redo', verifyToken, requireCoordinatorOwnership, cd.redoBasketballEvent);

/* ── Admin-only club CRUD ── */
router.post('/:id/assign-coordinator', verifyToken, requireAdmin, ctrl.assignCoordinator);
router.post('/',      verifyToken, requireAdmin, uploadLogo.single('logo'), ctrl.create);
router.put('/:id',    verifyToken, requireAdmin, uploadLogo.single('logo'), ctrl.update);
router.delete('/:id', verifyToken, requireAdmin, ctrl.remove);

module.exports = router;
