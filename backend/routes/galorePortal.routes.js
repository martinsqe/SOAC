/* Galore portal API — its own login, separate from /api/auth (club accounts).
   See services/galorePortal.js. */
const router    = require('express').Router();
const portal    = require('../services/galorePortal');
const { pgPool } = require('../config/db');
const { sendGalorePasswordReset } = require('../config/email');
const galoreForm = require('../services/galoreForm');
const soty       = require('../services/galoreSoty');
const gallery    = require('../services/galoreGallery');
const drafts     = require('../services/galoreDraft');
const schedule   = require('../services/galoreSchedule');
const teamsSvc   = require('../services/galoreTeams');
const results    = require('../services/galoreResults');
const selection  = require('../services/galoreSelection');
const { uploadClubFeedMedia } = require('../config/multer');
const cache      = require('../services/cache');
const { uploadDocumentSingle, uploadDocumentBuffer } = require('../config/multer');
/* the admin's own save path, so both apply the same rules and send the same emails */
const evCtrl     = require('../controllers/events.controller');

const handle = (fn) => async (req, res, next) => {
  try { await fn(req, res); }
  catch (err) {
    if (err instanceof portal.PortalError || err instanceof soty.SotyError || err instanceof gallery.GalleryError || err instanceof drafts.DraftError || err instanceof schedule.ScheduleError || err instanceof teamsSvc.TeamError || err instanceof results.ResultError || err instanceof selection.SelectionError) return res.status(err.status).json({ message: err.message });
    if (err instanceof galoreForm.GaloreFormError) return res.status(err.status || 400).json({ message: err.message });
    next(err);
  }
};

/* Per email (students all log in from the same campus IP at once), plus a
   per-IP ceiling sized for a campus */
const { perField, ipCeiling } = require('../middleware/rateLimits');
const loginLimiter = [
  ipCeiling(15, 4000, 'Too many login attempts from this network — please wait a few minutes and try again.'),
  perField(15, 10, 'email', 'Too many login attempts for this email — please wait a few minutes and try again.'),
];
const forgotLimiter = [
  ipCeiling(60, 600, 'Too many password requests from this network — please try again later.'),
  perField(60, 4, 'email', 'Too many password requests for this email — please try again later.'),
];

/* GET /api/galore-portal/status — public: is Galore closed? (the login page shows "Event closed") */
router.get('/status', handle(async (req, res) => { res.json(await portal.portalStatus()); }));

/* POST /api/galore-portal/login  { email, password } */
router.post('/login', loginLimiter, handle(async (req, res) => {
  const st = await portal.portalStatus();
  if (st.closed) return res.status(403).json({ message: `${st.title} is closed.`, closed: true });
  res.json(await portal.login(req.body?.email, req.body?.password));
}));

/* POST /api/galore-portal/forgot  { email } — emails a new temporary password.
   Works for anyone with Galore registrations or assignments, even if their
   portal account doesn't exist yet. The new password only replaces the old one
   once the email has actually been sent. Same answer whether or not the email
   belongs to anyone, so this can't be used to find out who's registered. */
router.post('/forgot', forgotLimiter, handle(async (req, res) => {
  const generic = { message: 'If that email is registered for Galore, a new temporary password is on its way. Check your inbox (and spam).' };
  const st = await portal.portalStatus();
  if (st.closed) return res.status(403).json({ message: `${st.title} is closed.`, closed: true });
  const target = await portal.forgotTarget(req.body?.email);
  if (!target) return res.json(generic);
  const pwd = portal.tempPassword();
  try {
    await sendGalorePasswordReset({ toEmail: target.email, toName: target.name, tempPassword: pwd });
  } catch (err) {
    console.error(`[galorePortal] reset email to ${target.email} failed:`, err.message);
    return res.status(502).json({ message: "We couldn't send the email right now — your current password still works. Please try again in a moment." });
  }
  await portal.setTempPassword(target, pwd);
  res.json(generic);
}));

/* POST /api/galore-portal/change-password  { current, next } */
router.post('/change-password', portal.requireGalore, handle(async (req, res) => {
  const token = await portal.changePassword(req.galore.id, req.body?.current, req.body?.next);
  res.json({ message: 'Password changed.', token });
}));

/* GET /api/galore-portal/events/:id/coordinators — the "Coordinators" page every
   portal role has: the overall Galore coordinator, each department's
   coordinator and each activity's coordinator (+ the club running it). Only for
   someone in this Galore event (registered student, or assigned staff / head). */
router.get('/events/:id/coordinators', portal.requireGalore, handle(async (req, res) => {
  const email = req.galore.email;
  const [student, staff, head] = await Promise.all([portal.studentView(email), portal.staffView(email), portal.headView(email)]);
  const inEvent = [...student, ...staff, ...head].some(x => String(x.event.id) === String(req.params.id));
  if (!inEvent) throw new portal.PortalError('You are not part of this Galore event.', 403);
  const form = await galoreForm.getGaloreForm(req.params.id, { withStaff: true });
  const person = (name, email) => (email ? { name: name || '', email } : null);
  res.json({
    head: person(form.head?.name, form.head?.email),
    departments: form.departments.map(d => ({ name: d.name, coordinator: person(d.coordName, d.coordEmail) })),
    activities: form.categories.flatMap(c => c.activities.map(a => ({
      id: a.id, title: a.title, categoryName: c.name, clubName: a.clubName || '', coordinator: person(a.coordinatorName, a.coordinatorEmail),
      studentCoordinators: a.studentCoordinators || [],
    }))),
    /* each club running a Galore activity, with its Student Coordinators */
    studentCoordinators: (() => {
      const byClub = new Map();
      for (const a of form.categories.flatMap(c => c.activities)) {
        if (!a.clubId) continue;
        if (!byClub.has(a.clubId)) byClub.set(a.clubId, { clubName: a.clubName || '', activities: [], people: a.studentCoordinators || [] });
        byClub.get(a.clubId).activities.push(a.title);
      }
      return [...byClub.values()].sort((x, y) => x.clubName.localeCompare(y.clubName));
    })(),
  });
}));

/* GET /api/galore-portal/me — everything this person sees: their registrations
   (as a student) and/or the activities and departments assigned to them (staff) */
router.get('/me', portal.requireGalore, handle(async (req, res) => {
  const [student0, staff0, head0, { rows: closedRows }] = await Promise.all([
    portal.studentView(req.galore.email), portal.staffView(req.galore.email), portal.headView(req.galore.email),
    pgPool.query(`SELECT id FROM events WHERE event_format = 'galore' AND parent_event_id IS NULL AND galore_closed_at IS NOT NULL`),
  ]);
  /* a closed Galore event isn't shown to anyone in the portal */
  const closed = new Set(closedRows.map(r => String(r.id)));
  const open = (list) => list.filter(x => !closed.has(String(x.event.id)));
  const [student, staff, head] = [open(student0), open(staff0), open(head0)];
  res.json({
    account: { name: req.galore.name, email: req.galore.email, mustChangePassword: req.galore.must_change_password },
    student, staff, head,
  });
}));

/* Student → Event selection → Activity selection: their verified university
   record and the activity checklist; confirming registers them (once only) */
router.get('/student/events/:id/selection', portal.requireGalore, handle(async (req, res) => {
  res.json(await selection.selection(req.galore.email, req.params.id));
}));
router.post('/student/events/:id/register', portal.requireGalore, handle(async (req, res) => {
  const { student } = await selection.studentFor(req.galore.email, req.params.id);
  await evCtrl.registerGaloreFromPortal(req.params.id, student, req, res);
}));

/* GET /api/galore-portal/events/:id/registrations — an activity coordinator's
   activities (every department) + a department coordinator's department (every activity) */
router.get('/events/:id/registrations', portal.requireGalore, handle(async (req, res) => {
  res.json({ registrations: await portal.staffRegistrations(req.galore.email, req.params.id) });
}));


/* GET /api/galore-portal/activities/:id/teams — the activity coordinator (or
   the overall Galore coordinator): the teams the club has made, with members */
router.get('/activities/:id/teams', portal.requireGalore, handle(async (req, res) => {
  res.json({ teams: await portal.activityTeams(req.galore.email, req.params.id) });
}));

/* ── Teams / duos of one activity: made from its registrations by the main
   coordinator, the activity coordinator, or a department coordinator (their
   department only). See services/galoreTeams.js. ── */
/* after any team change: every open dashboard showing this activity refreshes */
const teamsChanged = (req) => { const io = req.app.get('io'); if (io) io.emit('galore:teams:changed', { activityId: String(req.params.id) }); };
router.get('/activities/:id/team-manager', portal.requireGalore, handle(async (req, res) => {
  res.json(await teamsSvc.overview(req.galore.email, req.params.id, String(req.query.dept || '')));
}));
router.post('/activities/:id/teams', portal.requireGalore, handle(async (req, res) => {
  res.status(201).json(await teamsSvc.createTeam(req.galore.email, req.params.id, req.body || {}));
  teamsChanged(req);
}));
/* Student → My activities: everyone registered for the student's own activities
   (every department) and the selected teams / duos / individuals */
router.get('/events/:id/my-activities', portal.requireGalore, handle(async (req, res) => {
  res.json(await teamsSvc.studentRosters(req.galore.email, req.params.id));
}));

/* individual activities: select a student (a one-person entry); unselect = DELETE the team */
router.post('/activities/:id/selected', portal.requireGalore, handle(async (req, res) => {
  await teamsSvc.selectIndividual(req.galore.email, req.params.id, req.body || {});
  res.status(201).json({ ok: true });
  teamsChanged(req);
}));
/* main coordinator: declare an activity's selection to students { declared } */
router.patch('/activities/:id/teams-declared', portal.requireGalore, handle(async (req, res) => {
  res.json(await teamsSvc.setTeamsDeclared(req.galore.email, req.params.id, !!req.body?.declared));
  teamsChanged(req);
}));
router.patch('/activities/:id/teams/:teamId', portal.requireGalore, handle(async (req, res) => {
  await teamsSvc.renameTeam(req.galore.email, req.params.id, req.params.teamId, req.body || {});
  res.json({ ok: true });
  teamsChanged(req);
}));
router.delete('/activities/:id/teams/:teamId', portal.requireGalore, handle(async (req, res) => {
  await teamsSvc.deleteTeam(req.galore.email, req.params.id, req.params.teamId);
  res.json({ ok: true });
  teamsChanged(req);
}));
router.post('/activities/:id/teams/:teamId/members', portal.requireGalore, handle(async (req, res) => {
  await teamsSvc.addMember(req.galore.email, req.params.id, req.params.teamId, req.body || {});
  res.status(201).json({ ok: true });
  teamsChanged(req);
}));
router.delete('/activities/:id/teams/:teamId/members/:memberId', portal.requireGalore, handle(async (req, res) => {
  await teamsSvc.removeMember(req.galore.email, req.params.id, req.params.teamId, req.params.memberId);
  res.json({ ok: true });
  teamsChanged(req);
}));

/* ── Overall Galore coordinator — everything the admin's Galore tab does for
   their event, except creating or deleting it ── */
const head = (fn) => [portal.requireGalore, handle(async (req, res) => {
  await portal.assertHead(req.galore.email, req.params.id);
  await fn(req, res);
})];

/* GET  /head/events/:id — the event's details + its whole form (with who's assigned) */
router.get('/head/events/:id', ...head(async (req, res) => {
  const [details, form] = await Promise.all([portal.headEventDetails(req.params.id), galoreForm.getGaloreForm(req.params.id, { withStaff: true })]);
  res.json({ details, form });
}));

/* Results — winner and runner-up of every activity (per Boys / Girls), set by
   the main coordinator; a played final fills them in until then */
router.get('/head/events/:id/results', ...head(async (req, res) => {
  res.json(await results.view(req.params.id));
}));
router.put('/head/events/:id/results', ...head(async (req, res) => {
  await results.setPlace(req.params.id, req.body || {});
  req.app.get('io')?.emit('galore:results:changed', { eventId: String(req.params.id) });
  res.json(await results.view(req.params.id));
}));

/* GET  /head/events/:id/registrations — every activity, every department */
router.get('/head/events/:id/registrations', ...head(async (req, res) => {
  res.json({ registrations: await portal.allRegistrations(req.params.id) });
}));

/* GET  /head/events/:id/staff-options — coordinators / FAs for the form's dropdowns */
router.get('/head/events/:id/staff-options', ...head(async (req, res) => {
  const { campus } = await portal.headEventDetails(req.params.id);
  res.json(await galoreForm.listStaffOptions(campus));
}));

/* PUT  /head/events/:id/form { form, detailsChanged } — departments/FAs, categories,
   activities/coordinators, schedule, guidelines (not who the Galore coordinator is) */
router.put('/head/events/:id/form', ...head(async (req, res) => {
  try {
    const { saved } = await evCtrl.applyGaloreFormUpdate(req.params.id, req.body.form, { detailsChanged: !!req.body.detailsChanged, byHead: true });
    /* saved from the form editor → its draft is now the real form */
    if (req.body.clearDraft) await drafts.clear(req.params.id);
    res.json(saved);
  } catch (err) {
    if (err instanceof galoreForm.GaloreFormError) return res.status(err.status || 400).json({ message: err.message });
    throw err;
  }
}));

/* Draft of the Galore form — kept as the coordinator types, complete or not,
   so nothing is lost before publishing. GET → { draft: { data, updatedBy, updatedAt } | null } */
router.get('/head/events/:id/form-draft', ...head(async (req, res) => {
  res.json({ draft: await drafts.get(req.params.id) });
}));
router.put('/head/events/:id/form-draft', ...head(async (req, res) => {
  res.json(await drafts.save(req.params.id, req.body?.data, req.galore.email));
}));
router.delete('/head/events/:id/form-draft', ...head(async (req, res) => {
  await drafts.clear(req.params.id);
  res.json({ ok: true });
}));

/* PUT  /head/events/:id/details — the event's own title, dates, venue, description */
router.put('/head/events/:id/details', ...head(async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 255);
  if (!title) return res.status(400).json({ message: 'Event title is required.' });
  const status = ['upcoming', 'past'].includes(b.status) ? b.status : 'upcoming';
  await pgPool.query(
    `UPDATE events SET title = $1, date = $2, start_date = $3, time = $4, venue = $5, description = $6, seats = $7,
            highlight = $8, status = $9, updated_at = NOW()
     WHERE id = $10`,
    [title, String(b.date || '').slice(0, 100), /^\d{4}-\d{2}-\d{2}$/.test(b.startDate || '') ? `${b.startDate}T00:00:00` : null,
     String(b.time || '').slice(0, 100), String(b.venue || '').slice(0, 255), String(b.description || ''),
     String(b.seats || '').slice(0, 255), String(b.highlight || '').slice(0, 255), status, req.params.id]
  );
  await cache.delPattern('events:*');
  res.json({ details: await portal.headEventDetails(req.params.id) });
}));


/* POST /head/events/:id/guidelines-upload — a guidelines file for the form */
router.post('/head/events/:id/guidelines-upload', portal.requireGalore, uploadDocumentSingle('file'), handle(async (req, res) => {
  await portal.assertHead(req.galore.email, req.params.id);
  if (!req.file) return res.status(400).json({ message: 'Choose a file.' });
  res.json({ url: await uploadDocumentBuffer(req.file, 'galore-rules'), name: req.file.originalname.slice(0, 255) });
}));

/* Anyone in this Galore event: a registered student, assigned staff or the head */
async function assertInEvent(email, eventId) {
  const [student, staff, heads] = await Promise.all([portal.studentView(email), portal.staffView(email), portal.headView(email)]);
  if (![...student, ...staff, ...heads].some(x => String(x.event.id) === String(eventId))) {
    throw new portal.PortalError('You are not part of this Galore event.', 403);
  }
}

/* PATCH /head/events/:id/publish { published } — the overall coordinator
   publishes Galore once departments and activities are in */
router.patch('/head/events/:id/publish', ...head(async (req, res) => {
  res.json({ published: await evCtrl.setGalorePublished(req.params.id, !!req.body?.published) });
}));

/* GET /head/events/:id/template — the usual departments, categories and
   activities, to start an empty form from */
router.get('/head/events/:id/template', ...head(async (req, res) => {
  res.json(galoreForm.DEFAULT_TEMPLATE);
}));

/* PUT /head/events/:id/about { description } — About Galore text */
router.put('/head/events/:id/about', ...head(async (req, res) => {
  res.json({ about: await evCtrl.setGaloreAbout(req.params.id, req.body?.about ?? req.body?.description) });
}));

/* ── Gallery (services/galoreGallery.js): everyone in the event sees it; only
   the overall coordinator (and the admin, on the admin side) adds to it ── */
router.get('/events/:id/gallery', portal.requireGalore, handle(async (req, res) => {
  await assertInEvent(req.galore.email, req.params.id);
  res.json({ posts: await gallery.list(req.params.id) });
}));
router.post('/head/events/:id/gallery/upload-signature', ...head(async (req, res) => {
  res.json(gallery.signature(req.body?.kind));
}));
router.post('/head/events/:id/gallery', portal.requireGalore, uploadClubFeedMedia.single('media'), handle(async (req, res) => {
  await portal.assertHead(req.galore.email, req.params.id);
  res.status(201).json({ post: await gallery.create(req.params.id, req.body, req.file, { name: req.galore.name || req.galore.email, role: 'head' }) });
}));
router.delete('/head/events/:id/gallery/:postId', ...head(async (req, res) => {
  await gallery.remove(req.params.id, req.params.postId);
  res.json({ message: 'Removed.' });
}));

/* ── Schedule (services/galoreSchedule.js): every activity's date, time and
   venue + the matches between the teams the clubs formed. Everyone in the
   event sees it; only the overall coordinator makes the matches. ── */
router.get('/events/:id/schedule', portal.requireGalore, handle(async (req, res) => {
  const [student, staff, heads] = await Promise.all([portal.studentView(req.galore.email), portal.staffView(req.galore.email), portal.headView(req.galore.email)]);
  const inEv = (list) => list.some(x => String(x.event.id) === String(req.params.id));
  if (!inEv(student) && !inEv(staff) && !inEv(heads)) throw new portal.PortalError('You are not part of this Galore event.', 403);
  /* coordinators see everything; a student only what's been declared. The
     student dashboard asks for the student view (?view=student) — someone who is
     also a coordinator still sees there exactly what students see. */
  const asStudent = req.query.view === 'student' || (!inEv(staff) && !inEv(heads));
  res.json(await schedule.eventSchedule(req.params.id, { forStudent: asStudent }));
}));

/* after any change to the schedule (declare, sessions, fixtures): every open
   Schedule page refreshes */
const SCHEDULE_WRITE = /^\/head\/events\/(\d+)\/(declare|sessions|fixtures)/;
router.use((req, res, next) => {
  const m = req.method !== 'GET' && req.path.match(SCHEDULE_WRITE);
  if (m) res.on('finish', () => { if (res.statusCode < 400) req.app.get('io')?.emit('galore:schedule:changed', { eventId: m[1] }); });
  next();
});

/* PATCH /head/events/:id/declare { schedule?, fixtures? } — main coordinator
   declares the schedule / fixtures to students (or takes them back) */
router.patch('/head/events/:id/declare', ...head(async (req, res) => {
  res.json(await schedule.setDeclared(req.params.id, req.body || {}));
}));

/* GET /head/events/:id/teams — every team of every activity, for the match dropdowns */
router.get('/head/events/:id/teams', ...head(async (req, res) => {
  res.json({ teams: await schedule.eventTeams(req.params.id) });
}));

/* an activity's sessions (stages / rounds): { activityId, label, division, date, reportingTime, duration, venue } */
router.post('/head/events/:id/sessions', ...head(async (req, res) => {
  res.status(201).json({ session: await schedule.addSession(req.params.id, req.body || {}) });
}));
router.patch('/head/events/:id/sessions/:sid', ...head(async (req, res) => {
  res.json({ session: await schedule.updateSession(req.params.id, req.params.sid, req.body || {}) });
}));
router.delete('/head/events/:id/sessions/:sid', ...head(async (req, res) => {
  await schedule.deleteSession(req.params.id, req.params.sid);
  res.json({ ok: true });
}));

/* POST /head/events/:id/fixtures { activityId, teamAId, teamBId, date, time, venue, round } */
router.post('/head/events/:id/fixtures', ...head(async (req, res) => {
  res.status(201).json({ fixture: await schedule.addFixture(req.params.id, req.body) });
}));

/* PATCH /head/events/:id/fixtures/:fixtureId — same fields; teams only before the match starts */
router.patch('/head/events/:id/fixtures/:fixtureId', ...head(async (req, res) => {
  res.json({ fixture: await schedule.updateFixture(req.params.id, req.params.fixtureId, req.body) });
}));

router.delete('/head/events/:id/fixtures/:fixtureId', ...head(async (req, res) => {
  await schedule.deleteFixture(req.params.id, req.params.fixtureId, req.app.get('io'));
  res.json({ message: 'Match removed.' });
}));

/* ── Student of the Year (services/galoreSoty.js) ── */

/* GET /events/:id/soty — the published contest ({ contest: null } until then);
   for a student also who they are and their entry so far. Anyone in the event. */
router.get('/events/:id/soty', portal.requireGalore, handle(async (req, res) => {
  const email = req.galore.email;
  const [student, staff, heads] = await Promise.all([portal.studentView(email), portal.staffView(email), portal.headView(email)]);
  const inEvent = [...student, ...staff, ...heads].some(x => String(x.event.id) === String(req.params.id));
  if (!inEvent) throw new portal.PortalError('You are not part of this Galore event.', 403);
  res.json(await soty.portalView(email, req.params.id));
}));

/* POST /events/:id/soty — a student enters, or changes their entry (multipart,
   `document` = one PDF ≤ 10 MB; optional when changing an entry) */
router.post('/events/:id/soty', portal.requireGalore, soty.uploadEvidence(), handle(async (req, res) => {
  res.json({ entry: await soty.submitEntry(req.galore.email, req.params.id, req.body, req.files || []) });
}));

/* GET   /head/events/:id/soty — the main coordinator: the contestants */
router.get('/head/events/:id/soty', ...head(async (req, res) => {
  const out = await soty.listEntries(req.params.id);
  if (!out.contest?.published) return res.json({ contest: null, entries: [] });
  res.json(out);
}));

/* PATCH /head/events/:id/soty { opensOn, deadline } — when entries are taken */
router.patch('/head/events/:id/soty', ...head(async (req, res) => {
  const b = req.body || {};
  res.json({ contest: await soty.setDates(req.params.id, {
    ...('opensOn' in b ? { opensOn: b.opensOn } : {}), ...('deadline' in b ? { deadline: b.deadline } : {}),
    ...('closed' in b ? { closed: !!b.closed } : {}),
  }) });
}));

module.exports = router;
