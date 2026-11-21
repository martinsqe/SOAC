const router      = require('express').Router();
const ctrl        = require('../controllers/events.controller');
const teamCtrl    = require('../controllers/eventTeams.controller');
const groupCtrl   = require('../controllers/eventGroups.controller');
const certCtrl    = require('../controllers/certificates.controller');
const attendCtrl  = require('../controllers/eventAttendance.controller');
const cd          = require('../controllers/clubDetail.controller');
const sotyCtrl    = require('../controllers/galoreSoty.controller');
const galleryCtrl = require('../controllers/galoreGallery.controller');
const { verifyToken, optionalAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { uploadEvent, uploadEventMemory, uploadCertTemplate, uploadDocumentSingle, uploadClubFeedMedia } = require('../config/multer');
const { eventRegisterLimiter } = require('../middleware/rateLimits');

const requireCoordOrAdmin = (req, res, next) => {
  if (req.user?.role !== 'coordinator' && req.user?.role !== 'faculty_coordinator' && req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Coordinator or admin access required.' });
  }
  next();
};

/* After a successful change to teams, members, groups or the stage schedule, bring
   the event's report up to date (only if one has been generated and not submitted) */
const { autoRefreshReportIfExists } = require('../controllers/reports.controller');
/* A closed Galore event (or one of its activities) is read-only — its data stays for the admin to see */
const galoreOpen = async (req, res, next) => {
  try {
    const { pgPool } = require('../config/db');
    const { rows } = await pgPool.query(
      `SELECT 1 FROM events e LEFT JOIN events u ON u.id = e.parent_event_id
       WHERE e.id = $1 AND (e.galore_closed_at IS NOT NULL OR u.galore_closed_at IS NOT NULL)`,
      [req.params.id]
    );
    if (rows.length) return res.status(409).json({ message: 'This Galore event is closed — it can no longer be changed.' });
    next();
  } catch (err) { next(err); }
};
const refreshReportAfter = (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode < 400) autoRefreshReportIfExists(req.params.id).catch(() => {});
  });
  next();
};

/* Public event data can carry a student team captain's email / phone and the
   team roster. Responses (which may come from a cache shared by every viewer)
   are redacted on the way out unless the viewer is staff or the captain. */
const CONTACT_KEYS = ['captainEmail', 'captainPhone', 'teamMembers'];
const redactEventContacts = (req, res, next) => {
  const role = req.user?.role;
  if (role === 'admin' || role === 'coordinator' || role === 'faculty_coordinator') return next();
  const me = String(req.user?.email || '').toLowerCase();
  const scrub = (v, depth = 0) => {
    if (depth > 6 || !v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(x => scrub(x, depth + 1));
    const out = {};
    const isOwnTeam = me && String(v.captainEmail || '').toLowerCase() === me;
    for (const [k, val] of Object.entries(v)) {
      if (CONTACT_KEYS.includes(k) && !isOwnTeam) {
        out[k] = Array.isArray(val) ? [] : '';
      } else {
        out[k] = scrub(val, depth + 1);
      }
    }
    return out;
  };
  const json = res.json.bind(res);
  res.json = (body) => json(scrub(body));
  next();
};

/* Public, but reads the token when sent so an admin gets their campus's events */
router.get('/',                  optionalAuth, redactEventContacts, ctrl.getAll);
router.get('/live-scores',       optionalAuth, redactEventContacts, ctrl.getLiveScores);
router.get('/past-scores',       optionalAuth, redactEventContacts, ctrl.getPastScores);
router.get('/galore/template',       verifyToken, requireAdmin, ctrl.getGaloreTemplate);
router.get('/galore/coordinators',   verifyToken, requireAdmin, ctrl.getGaloreCoordinators);
router.post('/galore',               verifyToken, requireAdmin, uploadEventMemory.single('image'), ctrl.createGaloreEvent);
router.post('/galore/rules-upload',  verifyToken, requireAdmin, uploadDocumentSingle('file'), ctrl.uploadGaloreRules);
router.get('/my-assignments',       verifyToken, requireCoordOrAdmin, ctrl.getMyAssignments);
router.get('/:id',               optionalAuth, redactEventContacts, ctrl.getOne);
router.get('/:id/activities',    optionalAuth, redactEventContacts, ctrl.getActivities); /* public — Galore umbrella's child activities */
router.get('/:id/galore-form',   ctrl.getGaloreFormPublic); /* public — builds the Galore registration form */
router.get('/:id/galore-setup',  verifyToken, requireAdmin, ctrl.getGaloreSetup);
router.get('/:id/galore-deadline', ctrl.getGaloreDeadline); /* public — "Last Date of Registration" line */
router.put('/:id/galore-deadline', verifyToken, requireAdmin, galoreOpen, ctrl.updateGaloreDeadline);
/* Student of the Year — the admin creates / publishes it and sees the contestants */
router.get('/:id/soty',                     verifyToken, requireAdmin, sotyCtrl.get);
router.put('/:id/soty',                     verifyToken, requireAdmin, sotyCtrl.save);
router.put('/:id/soty/dates',               verifyToken, requireAdmin, sotyCtrl.saveDates);
router.delete('/:id/soty/entries/:entryId', verifyToken, requireAdmin, sotyCtrl.removeEntry);
router.put('/:id/galore-form',   verifyToken, requireAdmin, galoreOpen, ctrl.updateGaloreForm);
router.put('/:id/galore-head',   verifyToken, requireAdmin, galoreOpen, ctrl.updateGaloreHead);
router.post('/:id/galore-close', verifyToken, requireAdmin, ctrl.closeGaloreEvent); /* Close event — for good */  /* the admin's part: the overall coordinator */
router.put('/:id/galore-about',  verifyToken, requireAdmin, ctrl.updateGaloreAbout); /* About Galore text */
/* the overall coordinator's unsaved Galore form draft, so the admin sees work in progress */
/* the Galore schedule — every activity and match (admin's Schedule page) */
/* the admin declares (or takes back) the schedule and fixtures to students { schedule, fixtures } */
router.patch('/:id/galore-declare', verifyToken, requireAdmin, galoreOpen, async (req, res, next) => {
  try {
    res.json(await require('../services/galoreSchedule').setDeclared(req.params.id, req.body || {}));
    req.app.get('io')?.emit('galore:schedule:changed', { eventId: String(req.params.id) }); // open Schedule pages refresh
  }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); next(err); }
});
router.get('/:id/galore-schedule', verifyToken, requireAdmin, async (req, res, next) => {
  try { res.json(await require('../services/galoreSchedule').eventSchedule(req.params.id)); } catch (err) { next(err); }
});
/* Galore results (admin) — the same as the main coordinator's Results page */
router.get('/:id/galore-results', verifyToken, requireAdmin, async (req, res, next) => {
  try { res.json(await require('../services/galoreResults').view(req.params.id)); }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); next(err); }
});
router.put('/:id/galore-results', verifyToken, requireAdmin, galoreOpen, async (req, res, next) => {
  try {
    const svc = require('../services/galoreResults');
    await svc.setPlace(req.params.id, req.body || {});
    req.app.get('io')?.emit('galore:results:changed', { eventId: String(req.params.id) });
    res.json(await svc.view(req.params.id));
  }
  catch (err) { if (err.status) return res.status(err.status).json({ message: err.message }); next(err); }
});
router.get('/:id/galore-draft',  verifyToken, requireAdmin, async (req, res, next) => {
  try { res.json({ draft: await require('../services/galoreDraft').get(req.params.id) }); } catch (err) { next(err); }
});
/* Gallery — the admin (and the overall coordinator, in the Galore portal) add photos / videos */
router.get('/:id/gallery',                   verifyToken, requireAdmin, galleryCtrl.list);
router.post('/:id/gallery/upload-signature', verifyToken, requireAdmin, galleryCtrl.signature);
router.post('/:id/gallery',                  verifyToken, requireAdmin, uploadClubFeedMedia.single('media'), galleryCtrl.create);
router.delete('/:id/gallery/:postId',        verifyToken, requireAdmin, galleryCtrl.remove);
router.get('/:id/department-registrations', verifyToken, requireCoordOrAdmin, ctrl.getDepartmentRegistrations);
router.post('/',       verifyToken, requireCoordOrAdmin, uploadEvent.single('image'), ctrl.create);
router.post('/past-report', verifyToken, requireCoordOrAdmin, ctrl.createPastEventForReport); /* report for an event held outside the system */
router.put('/:id',     verifyToken, requireAdmin, uploadEvent.single('image'), ctrl.update);
router.patch('/:id/registration', verifyToken, requireAdmin, galoreOpen, ctrl.toggleRegistration);
/* Admin emails a reminder about the event (venue update, days to go, register now, custom) */
router.post('/:id/remind',       verifyToken, requireAdmin, ctrl.sendReminder);
router.delete('/:id',  verifyToken, requireAdmin, ctrl.remove);

/* Registration routes */
router.post('/:id/register',     eventRegisterLimiter, ctrl.register);                                         /* public            */
router.post('/:id/team-roster',  eventRegisterLimiter, ctrl.submitTeamRoster);                                  /* public — Sports Fiesta captain */
router.get('/:id/registrations', verifyToken, requireCoordOrAdmin, ctrl.listRegistrations); /* admin + coord */
router.patch ('/:id/registrations/:regId', verifyToken, requireAdmin, ctrl.updateRegistration); /* admin only */
router.delete('/:id/registrations/:regId', verifyToken, requireAdmin, ctrl.deleteRegistration); /* admin only */

/* Student status route */
router.get   ('/:id/my-status',                          verifyToken, teamCtrl.getMyStatus);

/* Team routes (coordinator/admin) */
router.get   ('/:id/teams',                              verifyToken, requireCoordOrAdmin, teamCtrl.getTeams);
router.post  ('/:id/teams',                              verifyToken, requireCoordOrAdmin, refreshReportAfter, teamCtrl.createTeam);
router.put   ('/:id/teams/:teamId',                      verifyToken, requireCoordOrAdmin, refreshReportAfter, teamCtrl.updateTeam);
router.delete('/:id/teams/:teamId',                      verifyToken, requireCoordOrAdmin, refreshReportAfter, teamCtrl.deleteTeam);
router.patch ('/:id/teams/:teamId/clear',                verifyToken, requireCoordOrAdmin, teamCtrl.toggleClear);
router.post  ('/:id/teams/:teamId/members',              verifyToken, requireCoordOrAdmin, refreshReportAfter, teamCtrl.addMember);
router.delete('/:id/teams/:teamId/members/:memberId',    verifyToken, requireCoordOrAdmin, refreshReportAfter, teamCtrl.removeMember);

/* Fixtures routes */
router.get  ('/:id/public-fixtures',                    teamCtrl.getPublicFixtures);                                    /* public */
router.get  ('/:id/fixtures',                           verifyToken, requireCoordOrAdmin, teamCtrl.getFixtures);         /* coord  */
router.post ('/:id/fixtures/save-declare',              verifyToken, requireCoordOrAdmin, teamCtrl.saveAndDeclare);      /* coord  */
router.patch ('/:id/fixtures/:fixtureId/result',        verifyToken, requireCoordOrAdmin, teamCtrl.recordResult);        /* coord  */
router.delete('/:id/fixtures/:fixtureId',               verifyToken, requireCoordOrAdmin, teamCtrl.deleteFixture);       /* coord  */

/* Stage schedule routes (estimated date/venue per later bracket round) */
router.get('/:id/stage-schedule', verifyToken, requireCoordOrAdmin, teamCtrl.getStageSchedule);
router.put('/:id/stage-schedule', verifyToken, requireCoordOrAdmin, refreshReportAfter, teamCtrl.saveStageSchedule);

router.get('/:id/mvp', cd.getEventMvp); /* public — MVP card for any completed match in this event */

/* Groups routes */
router.get   ('/:id/public-groups',                       groupCtrl.getPublicGroups);                              /* public */
router.get   ('/:id/groups',                              verifyToken, requireCoordOrAdmin, groupCtrl.getGroups);   /* coord  */
router.post  ('/:id/groups',                              verifyToken, requireCoordOrAdmin, refreshReportAfter, groupCtrl.createGroup);
router.patch ('/:id/groups/:groupId',                     verifyToken, requireCoordOrAdmin, refreshReportAfter, groupCtrl.renameGroup);
router.delete('/:id/groups/:groupId',                     verifyToken, requireCoordOrAdmin, refreshReportAfter, groupCtrl.deleteGroup);
router.post  ('/:id/groups/:groupId/assign',              verifyToken, requireCoordOrAdmin, refreshReportAfter, groupCtrl.assignTeam);
router.delete('/:id/groups/:groupId/teams/:teamId',       verifyToken, requireCoordOrAdmin, refreshReportAfter, groupCtrl.unassignTeam);

/* Certificate template routes (admin only — only AdminEvents.jsx does event creation/uploads) */
router.get ('/:id/certificate-templates',                   verifyToken, requireAdmin, certCtrl.listTemplates);
router.post('/:id/certificate-templates/:category',         verifyToken, requireAdmin, uploadCertTemplate.single('image'), certCtrl.uploadTemplate);
router.put ('/:id/certificate-templates/:category/anchors', verifyToken, requireAdmin, certCtrl.saveAnchors);

/* Certifications preview + finalize (coordinator/admin) */
router.get ('/:id/certifications/preview',  verifyToken, requireCoordOrAdmin, certCtrl.previewCertifications);
router.post('/:id/certifications/finalize', verifyToken, requireCoordOrAdmin, certCtrl.finalizeCertifications);

/* Event attendance — every active club member, recorded per day of the event (coordinator/admin) */
router.get   ('/:id/attendance',                        verifyToken, requireCoordOrAdmin, attendCtrl.getAttendance);
router.post  ('/:id/attendance/sessions',                verifyToken, requireCoordOrAdmin, attendCtrl.createSession);
router.delete('/:id/attendance/sessions/:sessionId',     verifyToken, requireCoordOrAdmin, attendCtrl.deleteSession);
router.patch ('/:id/attendance/sessions/:sessionId',     verifyToken, requireCoordOrAdmin, attendCtrl.recordAttendance);

module.exports = router;
