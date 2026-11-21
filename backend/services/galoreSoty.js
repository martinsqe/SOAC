/* Galore — Student of the Year.

   One contest per Galore event. The admin creates it (title + academic year)
   once the Galore event is open, and publishes it when ready. Once published
   it shows in the Galore portal's nav strip for:
     • students (anyone registered for a Galore activity) — the entry form,
       with their identity (enrollment no. … school) filled in from their
       university record; they fill in the rest and can change their entry
       until submissions close;
     • the main Galore coordinator — the contestants.
   The admin sees the contestants too. Entries are taken between two dates the
   admin or the main coordinator set: the day registration opens and the last
   date of registration. Before it opens, students see only "Registration will
   open soon, check back later".

   Co-curricular activities / special achievements: a student adds as many as
   they like, each with a title, a description (≤ 30 words) and one evidence
   file (PDF or image, ≤ 10 MB). The files carry personal data, so they're
   stored with privateFiles and only ever handed out as short-lived links.
   (Entries made before this kept one combined PDF in doc_file — still shown.) */
const multer = require('multer');
const { pgPool } = require('../config/db');
const { savePrivateFile, privateFileUrl, deletePrivateFile } = require('./privateFiles');

const MAX_TEXT = 500;
const MAX_PDF  = 10 * 1024 * 1024;     // each evidence file
const MAX_ACTS = 15;                   // activities per entry
const MAX_WORDS = 30;                  // per activity description
const EVIDENCE_EXT = /\.(pdf|jpe?g|png)$/i;

const ready = (async () => {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS galore_soty (
      id             BIGSERIAL     PRIMARY KEY,
      event_id       BIGINT        NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
      title          VARCHAR(255)  NOT NULL DEFAULT '',
      academic_year  VARCHAR(20)   NOT NULL DEFAULT '',
      published      BOOLEAN       NOT NULL DEFAULT false,
      closed         BOOLEAN       NOT NULL DEFAULT false,
      published_at   TIMESTAMPTZ,
      created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
  /* identity columns are a snapshot of the student's university record at the
     time they last saved, so the list still reads right if the record changes */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS galore_soty_entries (
      id               BIGSERIAL     PRIMARY KEY,
      contest_id       BIGINT        NOT NULL REFERENCES galore_soty(id) ON DELETE CASCADE,
      email            VARCHAR(255)  NOT NULL,
      student_id       BIGINT,
      enrollment_no    VARCHAR(50)   NOT NULL DEFAULT '',
      name             VARCHAR(255)  NOT NULL DEFAULT '',
      branch           VARCHAR(150)  NOT NULL DEFAULT '',
      semester         VARCHAR(50)   NOT NULL DEFAULT '',
      gender           VARCHAR(20)   NOT NULL DEFAULT '',
      school           VARCHAR(150)  NOT NULL DEFAULT '',
      even_attendance  NUMERIC(5,2)  NOT NULL,
      odd_attendance   NUMERIC(5,2)  NOT NULL,
      even_score       NUMERIC(5,2)  NOT NULL,
      odd_score        NUMERIC(5,2)  NOT NULL,
      mobile           VARCHAR(20)   NOT NULL DEFAULT '',
      contact_email    VARCHAR(255)  NOT NULL DEFAULT '',
      achievements     TEXT          NOT NULL DEFAULT '',
      reason           TEXT          NOT NULL DEFAULT '',
      doc_file         VARCHAR(500)  NOT NULL DEFAULT '',
      doc_name         VARCHAR(255)  NOT NULL DEFAULT '',
      created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      UNIQUE (contest_id, email)
    )
  `);
  /* its own "last date of registration" (YYYY-MM-DD), separate from Galore's */
  await pgPool.query(`ALTER TABLE galore_soty ADD COLUMN IF NOT EXISTS deadline VARCHAR(10) NOT NULL DEFAULT ''`);
  /* …and the day registration opens (YYYY-MM-DD). This replaced the open/closed
     switch: a contest that was already published keeps running — it opened the
     day it was published, and one that had been closed ended yesterday. */
  const { rows: [col] } = await pgPool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = 'galore_soty' AND column_name = 'opens_on'`
  );
  if (!col) {
    await pgPool.query(`ALTER TABLE galore_soty ADD COLUMN IF NOT EXISTS opens_on VARCHAR(10) NOT NULL DEFAULT ''`);
    await pgPool.query(
      `UPDATE galore_soty SET opens_on = to_char(COALESCE(published_at, created_at), 'YYYY-MM-DD') WHERE published = true`
    );
    await pgPool.query(
      `UPDATE galore_soty SET deadline = to_char(CURRENT_DATE - 1, 'YYYY-MM-DD')
        WHERE closed = true AND (deadline = '' OR deadline >= to_char(CURRENT_DATE, 'YYYY-MM-DD'))`
    );
    await pgPool.query(`UPDATE galore_soty SET closed = false WHERE closed = true`);
  }
  /* one row per co-curricular activity / achievement, with its evidence file */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS galore_soty_activities (
      id          BIGSERIAL     PRIMARY KEY,
      entry_id    BIGINT        NOT NULL REFERENCES galore_soty_entries(id) ON DELETE CASCADE,
      sort_order  INTEGER       NOT NULL DEFAULT 0,
      title       VARCHAR(150)  NOT NULL DEFAULT '',
      description TEXT          NOT NULL DEFAULT '',
      doc_file    VARCHAR(500)  NOT NULL DEFAULT '',
      doc_name    VARCHAR(255)  NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_galore_soty_activities_entry ON galore_soty_activities(entry_id)`);
  /* the department shown on the submitted file (their Galore registration's) */
  await pgPool.query(`ALTER TABLE galore_soty_entries ADD COLUMN IF NOT EXISTS department VARCHAR(150) NOT NULL DEFAULT ''`);
})().catch(err => console.error('[galoreSoty] migration failed:', err.message));

class SotyError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const normEmail = (e) => String(e || '').trim().toLowerCase();

/* An entry's evidence: one file per activity (file_<key>), PDF / JPG / PNG, ≤ 10 MB each */
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF, files: MAX_ACTS, fields: 30, fieldSize: 64 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^file_[\w-]{1,40}$/.test(file.fieldname) && EVIDENCE_EXT.test(file.originalname || '');
    cb(ok ? null : new SotyError('Each activity’s file must be a PDF, JPG or PNG.'), ok);
  },
});
const uploadEvidence = () => (req, res, next) => evidenceUpload.any()(req, res, (err) => {
  if (!err) return next();
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each file must be 10 MB or smaller.'
    : err.code === 'LIMIT_FILE_COUNT' ? `You can add up to ${MAX_ACTS} activities.`
    : err instanceof SotyError ? err.message : 'That upload could not be read — please try again.';
  res.status(400).json({ message });
});
/* the file really is what its name says (PDF / PNG / JPEG) */
const looksLikeEvidence = (f) => {
  const b = f?.buffer;
  if (!b || b.length < 4) return false;
  return b.subarray(0, 5).toString('latin1') === '%PDF-'
    || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    || (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff);
};
const wordsIn = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;

/* ── The contest ─────────────────────────────────────────────────────────── */

/* today in server-local time, YYYY-MM-DD — entries are taken through the whole last day */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/* opened: the opening date has come and it hasn't been closed (stopped: the
   main coordinator / admin pressed Close); closed: not taking entries right now */
const contestOut = (c) => {
  if (!c) return null;
  const t = today();
  const opensOn = c.opens_on || '';
  const stopped = !!c.closed;
  const opened = !!opensOn && t >= opensOn && !stopped;
  const deadlinePassed = !!c.deadline && t > c.deadline;
  return {
    id: String(c.id), eventId: String(c.event_id), title: c.title, academicYear: c.academic_year,
    published: c.published, publishedAt: c.published_at,
    opensOn, deadline: c.deadline || '', opened, deadlinePassed, stopped,
    closed: !opened || deadlinePassed,
  };
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const cleanDate = (v, what) => {
  const d = String(v ?? '').trim();
  if (d && (!ISO.test(d) || Number.isNaN(Date.parse(d)))) throw new SotyError(`Pick a valid ${what}.`);
  return d;
};

async function getContest(eventId) {
  await ready;
  const { rows } = await pgPool.query('SELECT * FROM galore_soty WHERE event_id = $1', [eventId]);
  return rows[0] || null;
}

async function assertUmbrella(eventId) {
  const { rows } = await pgPool.query(
    `SELECT 1 FROM events WHERE id = $1 AND is_active = true AND event_format = 'galore' AND parent_event_id IS NULL`,
    [eventId]
  );
  if (!rows.length) throw new SotyError('Galore event not found.', 404);
}

/* Admin: create or change the contest — { title, academicYear, published } */
async function saveContest(eventId, body = {}) {
  await ready;
  await assertUmbrella(eventId);
  const title = String(body.title || '').trim().slice(0, 255);
  if (!title) throw new SotyError('Give the contest a title, e.g. "Student of the year 2026".');
  const academicYear = String(body.academicYear || '').trim().slice(0, 20);
  const { rows: [c] } = await pgPool.query(
    `INSERT INTO galore_soty (event_id, title, academic_year, published, published_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN NOW() END)
     ON CONFLICT (event_id) DO UPDATE SET
       title = EXCLUDED.title, academic_year = EXCLUDED.academic_year,
       published = EXCLUDED.published,
       published_at = CASE WHEN EXCLUDED.published AND NOT galore_soty.published THEN NOW() ELSE galore_soty.published_at END,
       updated_at = NOW()
     RETURNING *`,
    [eventId, title, academicYear, !!body.published]
  );
  return contestOut(c);
}

/* When entries are taken: { opensOn, deadline } (YYYY-MM-DD each; '' clears
   it). A field left out keeps its value. Admin or the main Galore coordinator. */
async function setDates(eventId, body = {}) {
  await ready;
  const cur = await getContest(eventId);
  if (!cur) throw new SotyError('Create Student of the Year first.', 404);
  const opensOn  = 'opensOn'  in body ? cleanDate(body.opensOn,  'opening date') : (cur.opens_on || '');
  const deadline = 'deadline' in body ? cleanDate(body.deadline, 'last date of registration') : (cur.deadline || '');
  /* closed: registration stopped by hand (Open / Close), whatever the dates say */
  const closed = 'closed' in body ? !!body.closed : !!cur.closed;
  if (opensOn && deadline && deadline < opensOn) throw new SotyError('The last date of registration must be on or after the day registration opens.');
  const { rows: [c] } = await pgPool.query(
    'UPDATE galore_soty SET opens_on = $2, deadline = $3, closed = $4, updated_at = NOW() WHERE event_id = $1 RETURNING *',
    [eventId, opensOn, deadline, closed]
  );
  return contestOut(c);
}

/* ── Entries ─────────────────────────────────────────────────────────────── */

const num = (v) => (v == null ? null : Number(v));
const entryOut = (r) => ({
  id: String(r.id), email: r.email,
  enrollmentNo: r.enrollment_no, name: r.name, branch: r.branch, semester: r.semester, gender: r.gender, school: r.school,
  department: r.department || r.school || '',
  evenAttendance: num(r.even_attendance), oddAttendance: num(r.odd_attendance),
  evenScore: num(r.even_score), oddScore: num(r.odd_score),
  mobile: r.mobile, contactEmail: r.contact_email, achievements: r.achievements, reason: r.reason,
  document: r.doc_file ? { url: privateFileUrl(r.doc_file, { downloadName: r.doc_name }), name: r.doc_name || 'Documents.pdf' } : null,
  submittedAt: r.created_at, updatedAt: r.updated_at,
});

/* entries (already through entryOut) + their activities, each with a fresh link */
async function withActivities(entries) {
  if (!entries.length) return entries;
  const { rows } = await pgPool.query(
    'SELECT * FROM galore_soty_activities WHERE entry_id = ANY($1::bigint[]) ORDER BY sort_order, id',
    [entries.map(e => e.id)]
  );
  return entries.map(e => ({
    ...e,
    activities: rows.filter(a => String(a.entry_id) === e.id).map(a => ({
      id: String(a.id), title: a.title, description: a.description,
      file: a.doc_file ? {
        url: privateFileUrl(a.doc_file, { downloadName: a.doc_name }), name: a.doc_name || 'Evidence',
        isImage: /\.(jpe?g|png)$/i.test(a.doc_name || ''),
      } : null,
    })),
  }));
}

async function listEntries(eventId) {
  const contest = await getContest(eventId);
  if (!contest) return { contest: null, entries: [] };
  const { rows } = await pgPool.query(
    'SELECT * FROM galore_soty_entries WHERE contest_id = $1 ORDER BY created_at ASC, id ASC',
    [contest.id]
  );
  return { contest: contestOut(contest), entries: await withActivities(rows.map(entryOut)) };
}

async function deleteEntry(eventId, entryId) {
  const contest = await getContest(eventId);
  if (!contest) throw new SotyError('Contestant not found.', 404);
  const { rows: actFiles } = await pgPool.query(
    `SELECT a.doc_file FROM galore_soty_activities a JOIN galore_soty_entries e ON e.id = a.entry_id
     WHERE e.id = $1 AND e.contest_id = $2`, [entryId, contest.id]
  );
  const { rows: [r] } = await pgPool.query(
    'DELETE FROM galore_soty_entries WHERE id = $1 AND contest_id = $2 RETURNING doc_file',
    [entryId, contest.id]
  );
  if (!r) throw new SotyError('Contestant not found.', 404);
  if (r.doc_file) await deletePrivateFile(r.doc_file);
  for (const a of actFiles) if (a.doc_file) await deletePrivateFile(a.doc_file);
}

/* ── A student's own side ────────────────────────────────────────────────── */

const genderWord = (g) => ({ M: 'Male', F: 'Female', O: 'Other' }[String(g || '').trim().charAt(0).toUpperCase()] || String(g || '').trim());

/* Who this email is, for the form's prefilled rows — from their university
   record (linked to their Galore registration, or matched by email), falling
   back to what they registered with. null = not registered for this Galore
   event, so not a student who can enter. */
async function identityFor(email, eventId) {
  const { rows: [r] } = await pgPool.query(
    `SELECT us.id AS us_id, us.enrollment_no AS us_enrollment, us.admission_no AS us_admission, us.name AS us_name,
            us.gender AS us_gender, us.sub_department, us.program, us.semester, us.phone AS us_phone,
            ud.name AS school_name, ud.code AS school_code,
            er.enrollment_no, er.name, er.dept, er.course, er.gender, er.phone
     FROM event_registrations er
     JOIN events a ON a.id = er.event_id AND a.is_active = true AND a.parent_event_id = $2
     LEFT JOIN university_students us
       ON us.id = er.student_id OR (er.student_id IS NULL AND LOWER(us.email) = LOWER(er.email))
     LEFT JOIN university_departments ud ON ud.id = us.department_id
     WHERE LOWER(er.email) = $1 AND er.email NOT ILIKE '%@roster.internal'
     ORDER BY (us.id IS NULL), er.registered_at
     LIMIT 1`,
    [normEmail(email), eventId]
  );
  if (!r) return null;
  return {
    studentId: r.us_id ? String(r.us_id) : null,
    enrollmentNo: r.us_enrollment || r.us_admission || r.enrollment_no || '',
    name: r.us_name || r.name || '',
    branch: r.program || r.sub_department || r.course || '',
    semester: r.semester || '',
    gender: genderWord(r.us_gender || r.gender),
    school: r.school_name || r.school_code || r.dept || '',
    department: r.dept || r.school_code || r.school_name || '',
    phone: r.us_phone || r.phone || '',
  };
}

/* GET for the portal: the published contest, and — for a student — who they
   are and their entry so far. Nothing at all while unpublished. */
async function portalView(email, eventId) {
  const contest = await getContest(eventId);
  if (!contest || !contest.published) return { contest: null };
  const shownContest = contestOut(contest);
  const identity = await identityFor(email, eventId);
  /* the student's own submission — always theirs to see, open or closed */
  const mineOnly = async () => {
    const { rows: [r] } = await pgPool.query(
      'SELECT * FROM galore_soty_entries WHERE contest_id = $1 AND LOWER(email) = $2', [contest.id, normEmail(email)]
    );
    return r ? (await withActivities([entryOut(r)]))[0] : null;
  };
  /* not taking entries (not open yet, or closed): no form — just where it stands,
     and their own submission if they made one */
  if (!shownContest.opened || shownContest.deadlinePassed) {
    const entry = await mineOnly();
    const { studentId: _o, ...shownId } = identity || {};
    return {
      contest: {
        id: shownContest.id, title: shownContest.title, opened: shownContest.opened, closed: true,
        deadline: shownContest.deadline, deadlinePassed: shownContest.deadlinePassed, stopped: shownContest.stopped,
      },
      identity: entry && identity ? shownId : null, entry,
    };
  }
  let entry = null;
  if (identity) {
    const { rows: [r] } = await pgPool.query(
      'SELECT * FROM galore_soty_entries WHERE contest_id = $1 AND LOWER(email) = $2',
      [contest.id, normEmail(email)]
    );
    entry = r ? (await withActivities([entryOut(r)]))[0] : null;
  }
  const { studentId: _omit, ...shown } = identity || {};
  return { contest: shownContest, identity: identity ? shown : null, entry };
}

/* "1 to 100", decimals allowed (CGPA or a percentage) */
function percent(v, label) {
  const s = String(v ?? '').trim().replace(/%$/, '');
  const n = Number(s);
  if (!s || !Number.isFinite(n) || n < 1 || n > 100) throw new SotyError(`${label}: value must be between 1 to 100.`);
  return Math.round(n * 100) / 100;
}
function text(v, label) {
  const s = String(v ?? '').replace(/\r\n/g, '\n').trim();
  if (!s) throw new SotyError(`Fill in "${label}".`);
  if (s.length > MAX_TEXT) throw new SotyError(`"${label}" — maximum ${MAX_TEXT} characters are allowed.`);
  return s;
}

/* POST from a student: create or update their entry (multipart).
   body.activities = JSON [{ key, id?, title, description }] — their co-curricular
   activities / achievements, in order; each needs an evidence file: a new one
   sent as file_<key>, or (for one already saved, by id) the one on file. */
async function submitEntry(email, eventId, body = {}, files = []) {
  const contest = await getContest(eventId);
  if (!contest || !contest.published) throw new SotyError("Student of the Year isn't open.", 404);
  const state = contestOut(contest);
  if (!state.opened) throw new SotyError('Registration for Student of the Year will open soon — check back later.', 409);
  if (state.deadlinePassed) throw new SotyError('The last date of registration for Student of the Year has passed.', 409);
  const who = await identityFor(email, eventId);
  if (!who) throw new SotyError('Only students registered for Galore can enter Student of the Year.', 403);

  const fields = {
    evenAttendance: percent(body.evenAttendance, 'Even Sem Attendance'),
    oddAttendance:  percent(body.oddAttendance,  'Odd Sem Attendance'),
    evenScore:      percent(body.evenScore,      'Even Sem CGPA/Percentage'),
    oddScore:       percent(body.oddScore,       'Odd Sem CGPA/Percentage'),
  };
  let mobile = String(body.mobile || '').replace(/\D/g, '');
  if (mobile.length === 12 && mobile.startsWith('91')) mobile = mobile.slice(2);
  if (!/^\d{10}$/.test(mobile)) throw new SotyError('Enter a 10-digit mobile number.');
  const contactEmail = normEmail(body.contactEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail) || contactEmail.length > 255) throw new SotyError('Enter a valid email id.');
  const reason = text(body.reason, 'Why you are the right contestant');

  /* the activities */
  let acts;
  try { acts = JSON.parse(String(body.activities || '[]')); } catch { acts = null; }
  if (!Array.isArray(acts)) throw new SotyError('Your activities could not be read — please try again.');
  if (!acts.length) throw new SotyError('Add at least one co-curricular activity or special achievement, with its file.');
  if (acts.length > MAX_ACTS) throw new SotyError(`You can add up to ${MAX_ACTS} activities.`);

  const { rows: [existing] } = await pgPool.query(
    'SELECT id FROM galore_soty_entries WHERE contest_id = $1 AND LOWER(email) = $2',
    [contest.id, normEmail(email)]
  );
  /* reviewed and submitted once — final; it can be viewed but not changed */
  if (existing) throw new SotyError('You’ve already submitted your entry. It can be viewed but not changed.', 409);
  const { rows: oldActs } = existing
    ? await pgPool.query('SELECT id, doc_file, doc_name FROM galore_soty_activities WHERE entry_id = $1', [existing.id])
    : { rows: [] };
  const fileByKey = new Map((files || []).map(f => [f.fieldname.slice(5), f]));

  const clean = acts.map((a, i) => {
    const n = i + 1;
    const title = String(a?.title || '').trim().replace(/\s+/g, ' ');
    if (!title) throw new SotyError(`Activity ${n}: give it a title.`);
    if (title.length > 150) throw new SotyError(`Activity ${n}: the title can be at most 150 characters.`);
    const description = String(a?.description || '').replace(/\r\n/g, '\n').trim();
    if (!description) throw new SotyError(`"${title}": add a short description.`);
    if (wordsIn(description) > MAX_WORDS) throw new SotyError(`"${title}": the description can be at most ${MAX_WORDS} words.`);
    const old = a?.id ? oldActs.find(o => String(o.id) === String(a.id)) : null;
    const file = fileByKey.get(String(a?.key || '')) || null;
    if (file && !looksLikeEvidence(file)) throw new SotyError(`"${title}": that file isn’t a real PDF, JPG or PNG.`);
    if (!file && !old?.doc_file) throw new SotyError(`"${title}": attach a file as evidence.`);
    return { title, description, old, file };
  });

  /* store the new files first; the database then points at them */
  for (const a of clean) {
    if (a.file) { a.docFile = await savePrivateFile(a.file, 'galore-soty'); a.docName = a.file.originalname.slice(0, 255); }
    else { a.docFile = a.old.doc_file; a.docName = a.old.doc_name; }
  }
  /* kept for the CSV / older views: the titles, one per line */
  const achievements = clean.map(a => a.title).join('\n').slice(0, 5000);

  const client = await pgPool.connect();
  let r;
  try {
    await client.query('BEGIN');
    ({ rows: [r] } = await client.query(
      `INSERT INTO galore_soty_entries
         (contest_id, email, student_id, enrollment_no, name, branch, semester, gender, school,
          even_attendance, odd_attendance, even_score, odd_score, mobile, contact_email, achievements, reason, department)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (contest_id, email) DO UPDATE SET
         student_id = EXCLUDED.student_id, enrollment_no = EXCLUDED.enrollment_no, name = EXCLUDED.name,
         branch = EXCLUDED.branch, semester = EXCLUDED.semester, gender = EXCLUDED.gender, school = EXCLUDED.school,
         even_attendance = EXCLUDED.even_attendance, odd_attendance = EXCLUDED.odd_attendance,
         even_score = EXCLUDED.even_score, odd_score = EXCLUDED.odd_score,
         mobile = EXCLUDED.mobile, contact_email = EXCLUDED.contact_email,
         achievements = EXCLUDED.achievements, reason = EXCLUDED.reason, department = EXCLUDED.department,
         updated_at = NOW()
       RETURNING *`,
      [contest.id, normEmail(email), who.studentId, who.enrollmentNo.slice(0, 50), who.name.slice(0, 255),
       who.branch.slice(0, 150), String(who.semester).slice(0, 50), who.gender.slice(0, 20), who.school.slice(0, 150),
       fields.evenAttendance, fields.oddAttendance, fields.evenScore, fields.oddScore,
       mobile, contactEmail, achievements, reason, String(who.department || '').slice(0, 150)]
    ));
    /* the activity list is replaced as a whole, in the order given */
    await client.query('DELETE FROM galore_soty_activities WHERE entry_id = $1', [r.id]);
    for (const [i, a] of clean.entries()) {
      await client.query(
        `INSERT INTO galore_soty_activities (entry_id, sort_order, title, description, doc_file, doc_name)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [r.id, i, a.title, a.description, a.docFile, a.docName]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    for (const a of clean) if (a.file && a.docFile) await deletePrivateFile(a.docFile);
    throw err;
  } finally { client.release(); }

  /* files no longer used: activities removed, or a file replaced */
  const inUse = new Set(clean.map(a => a.docFile));
  for (const o of oldActs) if (o.doc_file && !inUse.has(o.doc_file)) await deletePrivateFile(o.doc_file);
  return (await withActivities([entryOut(r)]))[0];
}

module.exports = {
  ready, SotyError, uploadEvidence,
  getContest, contestOut, saveContest, setDates,
  listEntries, deleteEntry, portalView, submitEntry,
};
