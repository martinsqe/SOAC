const dir = require('../services/studentDirectory');
const { pgPool } = require('../config/db');
const { sendStudentVerificationLink } = require('../config/email');

/* Maps a DirectoryError to its status; anything else goes to the error handler */
const handle = (fn) => async (req, res, next) => {
  try { await fn(req, res); }
  catch (err) {
    if (err instanceof dir.DirectoryError) return res.status(err.status).json({ message: err.message });
    next(err);
  }
};

/* POST /api/students/lookup  (public)  { id, eventId? }  — id = Enrollment or Admission No.
   Returns enough for the student to recognise themselves (contact details
   masked). A logged-in user whose account email is the record's email is
   verified on the spot — no code needed. */
/* Activities of one Galore event this student has already registered for */
const registeredIn = async (student, eventId) => {
  if (!eventId) return [];
  const { rows } = await pgPool.query(
    `SELECT DISTINCT e.id, e.title FROM event_registrations er JOIN events e ON e.id = er.event_id
     WHERE e.parent_event_id = $1 AND e.is_active = true
       AND (er.student_id = $2 OR ($3 <> '' AND LOWER(er.email) = $3))
     ORDER BY e.title`,
    [eventId, student.id, String(student.email || '').toLowerCase()]
  );
  return rows.map(r => ({ id: String(r.id), title: r.title }));
};

const lookup = handle(async (req, res) => {
  const s = await dir.findStudent(req.body?.id);
  if (!s) {
    return res.status(404).json({ message: "This number isn't in the university student list. Check it, or contact your department's Faculty Advisor." });
  }
  /* With eventId: which of that Galore event's activities they're already in */
  const out = { student: dir.publicView(s), registered: await registeredIn(s, req.body?.eventId) };
  if (req.user?.email && s.email && req.user.email.toLowerCase() === s.email.toLowerCase()) {
    out.verificationToken = dir.issueVerificationToken(s.id);
    out.verified = dir.verifiedView(s);
  }
  res.json(out);
});

/* POST /api/students/send-link  (public)  { id, eventId } — emails a link to the
   address on record (never to an address the visitor types). Opening it brings
   the student back to the event's registration, already verified. */
const APP_URL = (process.env.CLIENT_URL || 'https://soac.info').replace(/\/+$/, '');
const sendLink = handle(async (req, res) => {
  const s = await dir.findStudent(req.body?.id);
  if (!s) return res.status(404).json({ message: 'Student not found.' });
  if (!s.email) {
    return res.status(400).json({ message: "There's no email on your university record, so we can't verify you. Contact your department's Faculty Advisor." });
  }
  let event = null;
  if (req.body?.eventId) {
    const { rows } = await pgPool.query(`SELECT id, title FROM events WHERE id = $1 AND is_active = true`, [req.body.eventId]);
    event = rows[0] || null;
    if (!event) return res.status(404).json({ message: 'Event not found.' });
  }
  const token = await dir.createVerificationLink(s, event?.id);
  const link = `${APP_URL}/events${event ? `/${event.id}` : ''}?verify=${encodeURIComponent(token)}`;
  try {
    await sendStudentVerificationLink({ toEmail: s.email, toName: s.name, link, eventTitle: event?.title, minutes: dir.LINK_MINUTES });
  } catch (err) {
    /* The real reason goes to the server log; outside production it's shown too, to make setup problems obvious */
    console.error(`[studentDirectory] verification email to ${s.email} failed:`, err.message);
    await pgPool.query(`DELETE FROM student_verification_links WHERE student_id = $1 AND created_at > NOW() - INTERVAL '2 minutes'`, [s.id]).catch(() => {});
    return res.status(502).json({
      message: "We couldn't send the email right now — please try again in a moment."
        + (process.env.NODE_ENV === 'production' ? '' : ` (${err.message})`),
    });
  }
  res.json({ message: `Link sent to ${dir.publicView(s).maskedEmail}.` });
});

/* POST /api/students/verify-link  (public)  { token } → verification token + full record */
const verifyLink = handle(async (req, res) => {
  const { student, eventId } = await dir.studentFromLink(req.body?.token);
  res.json({
    verificationToken: dir.issueVerificationToken(student.id), verified: dir.verifiedView(student), eventId,
    registered: await registeredIn(student, eventId),
  });
});

/* ── Admin ── */

/* GET /api/students/departments */
const listDepartments = handle(async (req, res) => {
  res.json({ departments: await dir.listDepartments() });
});

/* POST /api/students/departments  { code, name } — a department before its file arrives */
const createDepartment = handle(async (req, res) => {
  await dir.ready;
  const code = dir.normCode(req.body?.code);
  if (!code) return res.status(400).json({ message: 'Department code is required (e.g. SOE).' });
  const name = String(req.body?.name || '').trim().slice(0, 150);
  const { rows } = await pgPool.query(
    `INSERT INTO university_departments (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING RETURNING id`, [code, name]
  );
  if (!rows.length) return res.status(409).json({ message: `${code} already exists.` });
  res.status(201).json({ departments: await dir.listDepartments() });
});

/* PATCH /api/students/departments/:id  { name } */
const renameDepartment = handle(async (req, res) => {
  await pgPool.query(`UPDATE university_departments SET name = $1 WHERE id = $2`, [String(req.body?.name || '').trim().slice(0, 150), req.params.id]);
  res.json({ departments: await dir.listDepartments() });
});

/* DELETE /api/students/departments/:id — removes the department and its students */
const deleteDepartment = handle(async (req, res) => {
  const { rowCount } = await pgPool.query(`DELETE FROM university_departments WHERE id = $1`, [req.params.id]);
  if (!rowCount) return res.status(404).json({ message: 'Department not found.' });
  res.json({ departments: await dir.listDepartments() });
});

/* POST /api/students/import  (multipart: files[] — one per course —, departmentCode, departmentName, dryRun)
   dryRun=1 → preview only (combined + per-file counts, issues); dryRun=0 → save all together. */
const importFile = handle(async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ message: 'Choose at least one Excel file (.xlsx).' });
  const summary = await dir.importDepartmentFile({
    files: req.files.map(f => ({ buffer: f.buffer, fileName: f.originalname })),
    departmentCode: req.body.departmentCode,
    departmentName: req.body.departmentName,
    userId: req.user.id,
    dryRun: req.body.dryRun !== '0',
  });
  res.json(summary);
});

/* GET /api/students?q=&departmentId= */
const search = handle(async (req, res) => {
  res.json({ students: await dir.searchStudents(req.query) });
});

module.exports = { lookup, sendLink, verifyLink, listDepartments, createDepartment, renameDepartment, deleteDepartment, importFile, search };
