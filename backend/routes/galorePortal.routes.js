/* Galore portal API — its own login, separate from /api/auth (club accounts).
   See services/galorePortal.js. */
const router    = require('express').Router();
const rateLimit = require('express-rate-limit');
const portal    = require('../services/galorePortal');
const { pgPool } = require('../config/db');
const { sendGalorePasswordReset } = require('../config/email');
const galoreForm = require('../services/galoreForm');
const soty       = require('../services/galoreSoty');
const gallery    = require('../services/galoreGallery');
const drafts     = require('../services/galoreDraft');
const { uploadClubFeedMedia } = require('../config/multer');
const cache      = require('../services/cache');
const { uploadDocumentSingle, uploadDocumentBuffer } = require('../config/multer');
/* the admin's own save path, so both apply the same rules and send the same emails */
const evCtrl     = require('../controllers/events.controller');

const handle = (fn) => async (req, res, next) => {
  try { await fn(req, res); }
  catch (err) {
    if (err instanceof portal.PortalError || err instanceof soty.SotyError || err instanceof gallery.GalleryError || err instanceof drafts.DraftError) return res.status(err.status).json({ message: err.message });
    if (err instanceof galoreForm.GaloreFormError) return res.status(err.status || 400).json({ message: err.message });
    next(err);
  }
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many login attempts — please wait a few minutes and try again.' },
});
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many password requests — please try again later.' },
});

/* POST /api/galore-portal/login  { email, password } */
router.post('/login', loginLimiter, handle(async (req, res) => {
  res.json(await portal.login(req.body?.email, req.body?.password));
}));

/* POST /api/galore-portal/forgot  { email } — emails a new temporary password.
   Works for anyone with Galore registrations or assignments, even if their
   portal account doesn't exist yet. The new password only replaces the old one
   once the email has actually been sent. Same answer whether or not the email
   belongs to anyone, so this can't be used to find out who's registered. */
router.post('/forgot', forgotLimiter, handle(async (req, res) => {
  const generic = { message: 'If that email is registered for Galore, a new temporary password is on its way. Check your inbox (and spam).' };
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
      title: a.title, categoryName: c.name, clubName: a.clubName || '', coordinator: person(a.coordinatorName, a.coordinatorEmail),
    }))),
  });
}));

/* GET /api/galore-portal/me — everything this person sees: their registrations
   (as a student) and/or the activities and departments assigned to them (staff) */
router.get('/me', portal.requireGalore, handle(async (req, res) => {
  const [student, staff, head] = await Promise.all([
    portal.studentView(req.galore.email), portal.staffView(req.galore.email), portal.headView(req.galore.email),
  ]);
  res.json({
    account: { name: req.galore.name, email: req.galore.email, mustChangePassword: req.galore.must_change_password },
    student, staff, head,
  });
}));

/* GET /api/galore-portal/events/:id/registrations — an activity coordinator's
   activities (every department) + a department coordinator's department (every activity) */
router.get('/events/:id/registrations', portal.requireGalore, handle(async (req, res) => {
  res.json({ registrations: await portal.staffRegistrations(req.galore.email, req.params.id) });
}));

/* GET /api/galore-portal/activities/:id/fixtures — only for an activity the caller
   registered for (student) or looks after (its coordinator, or an FA of that
   Galore event). A student who's been put in a team sees just their team's
   matches; staff see them all. */
router.get('/activities/:id/fixtures', portal.requireGalore, handle(async (req, res) => {
  const email = req.galore.email;
  const { rows: [access] } = await pgPool.query(
    `SELECT
       (SELECT json_build_object('name', t.name, 'division', t.division)
          FROM event_registrations er
          LEFT JOIN event_team_members m ON m.registration_id = er.id
          LEFT JOIN event_teams t ON t.id = m.team_id
         WHERE er.event_id = a.id AND LOWER(er.email) = $2
         ORDER BY t.id NULLS LAST LIMIT 1) AS reg_team,
       EXISTS (SELECT 1 FROM event_registrations er WHERE er.event_id = a.id AND LOWER(er.email) = $2) AS is_registered,
       (LOWER(a.galore_coord_email) = $2
        OR EXISTS (SELECT 1 FROM galore_departments d WHERE d.event_id = a.parent_event_id AND LOWER(d.coord_email) = $2)
        OR EXISTS (SELECT 1 FROM galore_heads h WHERE h.event_id = a.parent_event_id AND LOWER(h.email) = $2)) AS is_staff
     FROM events a
     WHERE a.id = $1 AND a.is_active = true AND a.parent_event_id IS NOT NULL`,
    [req.params.id, email]
  );
  if (!access || (!access.is_registered && !access.is_staff)) {
    return res.status(403).json({ message: "You can only see fixtures for your own activities." });
  }
  const team = !access.is_staff && access.reg_team?.name ? access.reg_team : null;
  const { rows } = await pgPool.query(
    `SELECT team_a_name, team_b_name, match_date, match_time, venue, round, score_a, score_b, winner_name, division
     FROM event_fixtures
     WHERE event_id = $1 AND ($2::text IS NULL OR ((team_a_name = $2 OR team_b_name = $2) AND division = $3))
     ORDER BY sort_order ASC, created_at ASC`,
    [req.params.id, team?.name || null, team?.division || null]
  );
  res.json({
    team: team ? team.name : null,
    fixtures: rows.map(f => ({
      teamA: f.team_a_name, teamB: f.team_b_name,
      date: f.match_date ? new Date(f.match_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
      time: f.match_time || '', venue: f.venue || '', round: f.round || '',
      scoreA: f.score_a ?? null, scoreB: f.score_b ?? null, winner: f.winner_name || null, division: f.division,
    })),
  });
}));

/* GET /api/galore-portal/activities/:id/teams — the activity coordinator (or
   the overall Galore coordinator): the teams the club has made, with members */
router.get('/activities/:id/teams', portal.requireGalore, handle(async (req, res) => {
  res.json({ teams: await portal.activityTeams(req.galore.email, req.params.id) });
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

/* PATCH /head/events/:id/activities/:activityId/registration { closed } */
router.patch('/head/events/:id/activities/:activityId/registration', ...head(async (req, res) => {
  const { rows } = await pgPool.query(
    `UPDATE events SET registration_closed = $1, updated_at = NOW() WHERE id = $2 AND parent_event_id = $3 RETURNING id`,
    [!!req.body?.closed, req.params.activityId, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ message: 'Activity not found.' });
  await cache.delPattern('events:*');
  res.json({ registrationClosed: !!req.body?.closed });
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
  res.json({ description: await evCtrl.setGaloreAbout(req.params.id, req.body?.description) });
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
router.post('/events/:id/soty', portal.requireGalore, soty.uploadPdf('document'), handle(async (req, res) => {
  res.json({ entry: await soty.submitEntry(req.galore.email, req.params.id, req.body, req.file) });
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
  res.json({ contest: await soty.setDates(req.params.id, { ...('opensOn' in b ? { opensOn: b.opensOn } : {}), ...('deadline' in b ? { deadline: b.deadline } : {}) }) });
}));

module.exports = router;
