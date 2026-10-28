/* Galore portal API — its own login, separate from /api/auth (club accounts).
   See services/galorePortal.js. */
const router    = require('express').Router();
const rateLimit = require('express-rate-limit');
const portal    = require('../services/galorePortal');
const { pgPool } = require('../config/db');
const { sendGalorePasswordReset } = require('../config/email');
const galoreForm = require('../services/galoreForm');
const cache      = require('../services/cache');
const { uploadDocumentMemory, uploadDocumentBuffer } = require('../config/multer');
/* the admin's own save path, so both apply the same rules and send the same emails */
const evCtrl     = require('../controllers/events.controller');

const handle = (fn) => async (req, res, next) => {
  try { await fn(req, res); }
  catch (err) {
    if (err instanceof portal.PortalError) return res.status(err.status).json({ message: err.message });
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
    res.json(saved);
  } catch (err) {
    if (err instanceof galoreForm.GaloreFormError) return res.status(err.status || 400).json({ message: err.message });
    throw err;
  }
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
router.post('/head/events/:id/guidelines-upload', portal.requireGalore, uploadDocumentMemory.single('file'), handle(async (req, res) => {
  await portal.assertHead(req.galore.email, req.params.id);
  if (!req.file) return res.status(400).json({ message: 'Choose a file.' });
  res.json({ url: await uploadDocumentBuffer(req.file, 'galore-rules'), name: req.file.originalname.slice(0, 255) });
}));

module.exports = router;
