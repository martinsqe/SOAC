/* University student directory — the official list of students, imported by
   the admin from one Excel file per department (School). Registration looks a
   student up here by Enrollment No. or Admission No. (first-years only have the
   latter) and fills in their details from the record, so nobody can register
   with a wrong name, email, department or course.

   Only what registration needs is stored. The university sheets also carry
   Aadhar numbers, caste/category, home address, birth date, parents' phones
   and ABC ids — those columns are ignored while reading and never saved. */
const crypto  = require('crypto');
const { studentLinkSecret } = require('../config/secrets');
const jwt     = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const { pgPool } = require('../config/db');

const RKU_DOMAIN = '@rku.ac.in';

const ready = (async () => {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS university_departments (
      id          SERIAL        PRIMARY KEY,
      code        VARCHAR(30)   NOT NULL UNIQUE,
      name        VARCHAR(150)  NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS student_imports (
      id            BIGSERIAL     PRIMARY KEY,
      department_id INTEGER       REFERENCES university_departments(id) ON DELETE CASCADE,
      file_name     VARCHAR(255)  NOT NULL DEFAULT '',
      uploaded_by   INTEGER       REFERENCES users(id) ON DELETE SET NULL,
      added         INTEGER       NOT NULL DEFAULT 0,
      updated       INTEGER       NOT NULL DEFAULT 0,
      unchanged     INTEGER       NOT NULL DEFAULT 0,
      skipped       INTEGER       NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS university_students (
      id              BIGSERIAL     PRIMARY KEY,
      department_id   INTEGER       NOT NULL REFERENCES university_departments(id) ON DELETE CASCADE,
      enrollment_no   VARCHAR(50)   NOT NULL DEFAULT '',
      admission_no    VARCHAR(50)   NOT NULL DEFAULT '',
      name            VARCHAR(255)  NOT NULL,
      email           VARCHAR(255)  NOT NULL DEFAULT '',
      phone           VARCHAR(20)   NOT NULL DEFAULT '',
      gender          CHAR(1),
      sub_department  VARCHAR(100)  NOT NULL DEFAULT '',
      program         VARCHAR(150)  NOT NULL DEFAULT '',
      semester        VARCHAR(50)   NOT NULL DEFAULT '',
      import_id       BIGINT        REFERENCES student_imports(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ustudents_enrollment ON university_students(enrollment_no) WHERE enrollment_no <> ''`);
  await pgPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ustudents_admission  ON university_students(admission_no)  WHERE admission_no  <> ''`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_ustudents_email ON university_students(LOWER(email))`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_ustudents_dept  ON university_students(department_id)`);
  /* Email links that prove a student owns the record they looked up — only the
     hash of the link's secret is stored, so a database leak can't be replayed. */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS student_verification_links (
      token_hash  VARCHAR(64)   PRIMARY KEY,
      student_id  BIGINT        NOT NULL REFERENCES university_students(id) ON DELETE CASCADE,
      event_id    BIGINT,
      expires_at  TIMESTAMPTZ   NOT NULL,
      created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_student_links_student ON student_verification_links(student_id, created_at DESC)`);
  /* superseded by the email links above */
  await pgPool.query(`DROP TABLE IF EXISTS student_verification_codes`);
})().catch(err => console.error('[studentDirectory] migration failed:', err.message));

class DirectoryError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/* IDs are compared upper-case with spaces/stray apostrophes removed, so
   "262711030011", " 262711030011 " and "'262711030011" are the same student. */
const normId    = (v) => String(v ?? '').replace(/^'+/, '').replace(/\s+/g, '').toUpperCase().slice(0, 50);
const normCode  = (v) => String(v ?? '').trim().toUpperCase().slice(0, 30);
const normPhone = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const normGender = (v) => {
  const g = String(v ?? '').trim().toLowerCase();
  if (g === 'f' || g === 'female' || g === 'girl') return 'F';
  if (g === 'm' || g === 'male' || g === 'boy') return 'M';
  return null;
};

/* ── Reading the Excel file ────────────────────────────────────────────────── */

/* Header (lower-cased, letters/digits only) → field. Every other column —
   Aadhar, caste, address, birth date, parents' phones, abc_id… — is skipped. */
const HEADER_FIELDS = {
  school: 'school',
  department: 'subDepartment',
  program: 'program',
  admissionno: 'admissionNo',
  enrollmentno: 'enrollmentNo',
  semesteryeardivision: 'semester',
  studentname: 'name',
  studentmobileno: 'phone',
  studentemailid: 'email',
  gender: 'gender',
};
const headerKey = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/* A cell's plain text, whatever exceljs hands back (numbers, rich text,
   hyperlinked emails, formulas, dates). Long numbers stay exact digits. */
function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(r => r.text).join('');
    if (value.text != null) return cellText(value.text);
    if (value.result != null) return cellText(value.result);
    if (value.hyperlink) return String(value.hyperlink).replace(/^mailto:/i, '');
    return '';
  }
  return String(value).trim();
}

/* Every student row from every sheet that has the university header row
   (looked for in the first 15 rows). Returns rows + the sheet/row they came
   from, for the preview's issue list. */
async function readStudentFile(buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); }
  catch { throw new DirectoryError('Could not read this file. Save it as an Excel workbook (.xlsx) and try again.'); }

  const rows = [];
  let sheetsRead = 0;
  wb.eachSheet(ws => {
    let headerRow = null, columns = null;
    for (let r = 1; r <= Math.min(ws.rowCount, 15) && !headerRow; r++) {
      const cols = {};
      ws.getRow(r).eachCell((cell, c) => { const f = HEADER_FIELDS[headerKey(cellText(cell.value))]; if (f && !cols[f]) cols[f] = c; });
      if (cols.name && (cols.enrollmentNo || cols.admissionNo)) { headerRow = r; columns = cols; }
    }
    if (!headerRow) return;
    sheetsRead++;
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const rec = {};
      for (const [field, c] of Object.entries(columns)) rec[field] = cellText(row.getCell(c).value);
      if (!Object.values(rec).some(v => v)) continue; // blank line
      rows.push({ sheet: ws.name, row: r, ...rec });
    }
  });
  if (!sheetsRead) {
    throw new DirectoryError('No student sheet found. The file needs the university header row with "Student Name" and "Admission No." / "Enrollment No." columns.');
  }
  return rows;
}

/* ── Import ────────────────────────────────────────────────────────────────── */

/* Checks a department's files — usually one per course — against each other
   and the directory, and (unless dryRun) saves them all in one go: new students
   added, existing ones (matched by Enrollment or Admission No.) updated — e.g. a
   first-year's Enrollment No. arriving in a later file fills into their
   existing record. Students missing from the files are kept. Returns combined
   totals, a per-file breakdown and every issue for the preview. */
async function importDepartmentFile({ files, buffer, fileName, departmentCode, departmentName, userId, dryRun }) {
  await ready;
  const code = normCode(departmentCode);
  if (!code) throw new DirectoryError('Pick the department these files are for.');
  const list = files?.length ? files : [{ buffer, fileName }];

  const raw = [];
  const perFile = new Map(); // fileName → its own counts
  for (const f of list) {
    const name = String(f.fileName || 'file.xlsx');
    if (perFile.has(name)) throw new DirectoryError(`${name} was added twice.`);
    let rows;
    try { rows = await readStudentFile(f.buffer); }
    catch (err) { throw err instanceof DirectoryError ? new DirectoryError(`${name}: ${err.message}`) : err; }
    perFile.set(name, { fileName: name, rowsRead: rows.length, added: 0, updated: 0, unchanged: 0, skipped: 0, warnings: 0 });
    for (const r of rows) raw.push({ ...r, file: name });
  }

  const { rows: existing } = await pgPool.query(
    `SELECT s.id, s.enrollment_no, s.admission_no, s.name, s.email, s.phone, s.gender, s.sub_department,
            s.program, s.semester, d.code AS dept_code
     FROM university_students s JOIN university_departments d ON d.id = s.department_id`
  );
  const byEnr = new Map(), byAdm = new Map();
  for (const s of existing) {
    if (s.enrollment_no) byEnr.set(s.enrollment_no, s);
    if (s.admission_no)  byAdm.set(s.admission_no, s);
  }

  const issues = [];   // { sheet, row, level: 'error'|'warning', message }
  const toAdd = [], toUpdate = [];
  let unchanged = 0, movedIn = 0;
  const seenEnr = new Map(), seenAdm = new Map(), seenEmail = new Map(); // value = file it was first seen in
  const issue = (r, level, message) => {
    issues.push({ file: r.file, sheet: r.sheet, row: r.row, level, message });
    perFile.get(r.file)[level === 'error' ? 'skipped' : 'warnings']++;
  };

  for (const r of raw) {
    const enr = normId(r.enrollmentNo), adm = normId(r.admissionNo);
    const name = String(r.name || '').replace(/\s+/g, ' ').trim().slice(0, 255);
    if (!enr && !adm) { issue(r, 'error', `${name || 'Row'}: no Enrollment No. or Admission No. — skipped.`); continue; }
    if (!name)        { issue(r, 'error', `${enr || adm}: no student name — skipped.`); continue; }
    const school = normCode(r.school);
    if (school && school !== code) { issue(r, 'error', `${name}: School is "${school}", but this file is for ${code} — skipped.`); continue; }
    const firstSeen = (enr && seenEnr.get(enr)) || (adm && seenAdm.get(adm));
    if (firstSeen) {
      issue(r, 'error', firstSeen === r.file
        ? `${name}: ${enr || adm} appears twice in this file — second copy skipped.`
        : `${name}: ${enr || adm} is also in ${firstSeen} — this copy skipped.`);
      continue;
    }
    if (enr) seenEnr.set(enr, r.file);
    if (adm) seenAdm.set(adm, r.file);

    const byE = enr ? byEnr.get(enr) : null, byA = adm ? byAdm.get(adm) : null;
    if (byE && byA && byE.id !== byA.id) {
      issue(r, 'error', `${name}: Enrollment No. ${enr} and Admission No. ${adm} belong to two different students already in the directory — skipped.`);
      continue;
    }
    const match = byE || byA;
    if (match && match.enrollment_no && enr && match.enrollment_no !== enr) {
      issue(r, 'error', `${name}: Admission No. ${adm} is already on record with Enrollment No. ${match.enrollment_no}, not ${enr} — skipped.`);
      continue;
    }

    let email = String(r.email || '').trim().toLowerCase();
    if (email && !(/^[^\s@]+@[^\s@]+$/.test(email) && email.endsWith(RKU_DOMAIN))) {
      issue(r, 'warning', `${name}: "${email}" isn't an @rku.ac.in email — saved without email, so they can't verify until it's fixed.`);
      email = '';
    } else if (!email) {
      issue(r, 'warning', `${name}: no email — saved, but they can't verify until one is added.`);
    }
    if (email && seenEmail.has(email)) issue(r, 'warning', `${name}: same email as ${seenEmail.get(email)}.`);
    if (email) seenEmail.set(email, name);
    const gender = normGender(r.gender);

    const rec = {
      enrollment_no: enr || match?.enrollment_no || '',
      admission_no:  adm || match?.admission_no || '',
      name, email, phone: normPhone(r.phone), gender,
      sub_department: String(r.subDepartment || '').trim().slice(0, 100),
      program:        String(r.program || '').trim().slice(0, 150),
      semester:       String(r.semester || '').trim().slice(0, 50),
    };
    if (!match) { toAdd.push(rec); perFile.get(r.file).added++; continue; }
    if (match.dept_code !== code) { issue(r, 'warning', `${name}: moves from ${match.dept_code} to ${code}.`); movedIn++; }
    const same = match.dept_code === code && ['enrollment_no', 'admission_no', 'name', 'email', 'phone', 'gender', 'sub_department', 'program', 'semester']
      .every(k => String(match[k] ?? '') === String(rec[k] ?? ''));
    if (same) { unchanged++; perFile.get(r.file).unchanged++; }
    else { toUpdate.push({ id: match.id, ...rec }); perFile.get(r.file).updated++; }
  }

  const skipped = issues.filter(i => i.level === 'error').length;
  const summary = {
    department: code, fileName: [...perFile.keys()].join(', '), files: [...perFile.values()], rowsRead: raw.length,
    added: toAdd.length, updated: toUpdate.length, unchanged, skipped,
    /* how many students this department will have once saved */
    departmentTotalBefore: existing.filter(e => e.dept_code === code).length,
    departmentTotalAfter: existing.filter(e => e.dept_code === code).length + toAdd.length + movedIn,
    warnings: issues.filter(i => i.level === 'warning').length,
    issues: issues.slice(0, 300),
    issuesTruncated: issues.length > 300,
    sample: [...toAdd, ...toUpdate].slice(0, 8).map(({ id, ...r }) => r),
  };
  if (dryRun) return summary;

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [dept] } = await client.query(
      `INSERT INTO university_departments (code, name) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET name = CASE WHEN $2 <> '' THEN $2 ELSE university_departments.name END
       RETURNING id`,
      [code, String(departmentName || '').trim().slice(0, 150)]
    );
    const { rows: [imp] } = await client.query(
      `INSERT INTO student_imports (department_id, file_name, uploaded_by, added, updated, unchanged, skipped)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [dept.id, summary.fileName.slice(0, 255), userId || null, toAdd.length, toUpdate.length, unchanged, skipped]
    );
    const cols = ['enrollment_no', 'admission_no', 'name', 'email', 'phone', 'gender', 'sub_department', 'program', 'semester'];
    const arr = (list, k) => list.map(x => x[k]);
    for (let i = 0; i < toAdd.length; i += 1000) {
      const chunk = toAdd.slice(i, i + 1000);
      await client.query(
        `INSERT INTO university_students (department_id, import_id, ${cols.join(', ')})
         SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::char(1)[], $9::text[], $10::text[], $11::text[])`,
        [dept.id, imp.id, ...cols.map(k => arr(chunk, k))]
      );
    }
    for (let i = 0; i < toUpdate.length; i += 1000) {
      const chunk = toUpdate.slice(i, i + 1000);
      await client.query(
        `UPDATE university_students s SET department_id = $1, import_id = $2, updated_at = NOW(),
                enrollment_no = u.enrollment_no, admission_no = u.admission_no, name = u.name, email = u.email,
                phone = u.phone, gender = u.gender, sub_department = u.sub_department, program = u.program, semester = u.semester
         FROM unnest($3::bigint[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::char(1)[], $10::text[], $11::text[], $12::text[])
              AS u(id, enrollment_no, admission_no, name, email, phone, gender, sub_department, program, semester)
         WHERE s.id = u.id`,
        [dept.id, imp.id, arr(chunk, 'id'), ...cols.map(k => arr(chunk, k))]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') throw new DirectoryError('Two students ended up with the same Enrollment/Admission No. — nothing was saved. Check the file for repeated numbers.');
    throw err;
  } finally {
    client.release();
  }
  return summary;
}

/* ── Lookup & verification ─────────────────────────────────────────────────── */

const STUDENT_COLS = `s.id, s.enrollment_no, s.admission_no, s.name, s.email, s.phone, s.gender,
                      s.sub_department, s.program, s.semester, d.code AS department`;

async function findStudent(rawId) {
  await ready;
  const id = normId(rawId);
  if (!id) return null;
  const { rows } = await pgPool.query(
    `SELECT ${STUDENT_COLS} FROM university_students s JOIN university_departments d ON d.id = s.department_id
     WHERE s.enrollment_no = $1 OR s.admission_no = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function getStudentById(id) {
  const { rows } = await pgPool.query(
    `SELECT ${STUDENT_COLS} FROM university_students s JOIN university_departments d ON d.id = s.department_id WHERE s.id = $1`,
    [id]
  );
  return rows[0] || null;
}

const maskEmail = (e) => {
  if (!e) return '';
  const [user, domain] = e.split('@');
  return `${user.slice(0, 1)}${'*'.repeat(Math.max(2, user.length - 2))}${user.length > 1 ? user.slice(-1) : ''}@${domain}`;
};

/* The sheet's "Semester / Year / Division" holds both, e.g. "Sem-I/A" →
   semester "Sem-I", division "A". No slash → it's all semester. */
const splitSemester = (raw) => {
  const v = String(raw || '').trim();
  const i = v.lastIndexOf('/');
  return i > 0 ? { semester: v.slice(0, i).trim(), division: v.slice(i + 1).trim() } : { semester: v, division: '' };
};

/* What a not-yet-verified visitor may see: enough to recognise themselves,
   never full contact details (anyone can type any number). */
/* Anyone can type an enrollment number, and those numbers run in sequence —
   so before the email check this shows only enough for a student to recognise
   themselves (first name + initials, department, program), never a full name,
   class division or contact details that could be harvested number by number. */
const maskName = (name = '') => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const [first, ...rest] = parts;
  return [first, ...rest.map(p => `${p[0].toUpperCase()}.`)].join(' ');
};
const publicView = (s) => ({
  name: maskName(s.name), department: s.department, subDepartment: s.sub_department, program: s.program,
  maskedEmail: maskEmail(s.email), canVerify: !!s.email,
});

/* Full record, only after verification */
const verifiedView = (s) => ({
  enrollmentNo: s.enrollment_no, admissionNo: s.admission_no, name: s.name, email: s.email, phone: s.phone,
  gender: s.gender, department: s.department, subDepartment: s.sub_department, program: s.program,
  ...splitSemester(s.semester),
});

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const LINK_MINUTES = 30;

/* Short-lived proof that whoever holds it verified this student record */
const issueVerificationToken = (studentId) =>
  jwt.sign({ sid: String(studentId), purpose: 'student_verify' }, studentLinkSecret(), { expiresIn: '45m', algorithm: 'HS256' });

/* Student record for a verification token, or throws (expired / tampered) */
async function studentFromToken(token) {
  if (!token) throw new DirectoryError('Verify your enrollment / admission number first.');
  let payload;
  try { payload = jwt.verify(token, studentLinkSecret(), { algorithms: ['HS256'] }); } catch {
    throw new DirectoryError('Your verification has expired — please verify your enrollment / admission number again.');
  }
  if (payload.purpose !== 'student_verify') throw new DirectoryError('Invalid verification.');
  const s = await getStudentById(payload.sid);
  if (!s) throw new DirectoryError('Student record not found.');
  return s;
}

/* A fresh verification link secret for this student (the caller emails it as
   part of a URL). At most one a minute per student, so the address on record
   can't be flooded. Valid for LINK_MINUTES and reusable until then, so
   opening it twice or refreshing the page still works. */
async function createVerificationLink(student, eventId) {
  const { rows } = await pgPool.query(
    `SELECT created_at FROM student_verification_links WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`, [student.id]
  );
  if (rows.length && Date.now() - new Date(rows[0].created_at).getTime() < 60 * 1000) {
    throw new DirectoryError('A link was just sent — check your inbox (and spam), or wait a minute to send another.', 429);
  }
  await pgPool.query(`DELETE FROM student_verification_links WHERE expires_at < NOW()`);
  const token = crypto.randomBytes(32).toString('base64url');
  await pgPool.query(
    `INSERT INTO student_verification_links (token_hash, student_id, event_id, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(mins => $4))`,
    [hashToken(token), student.id, eventId || null, LINK_MINUTES]
  );
  return token;
}

/* The student (and event) a link belongs to, or throws if unknown / expired */
async function studentFromLink(token) {
  if (!token) throw new DirectoryError('This verification link is incomplete.');
  const { rows } = await pgPool.query(
    `SELECT student_id, event_id, expires_at FROM student_verification_links WHERE token_hash = $1`, [hashToken(token)]
  );
  const row = rows[0];
  if (!row) throw new DirectoryError('This verification link is not valid. Enter your number again to get a new one.');
  if (new Date(row.expires_at) < new Date()) throw new DirectoryError('This verification link has expired. Enter your number again to get a new one.');
  const s = await getStudentById(row.student_id);
  if (!s) throw new DirectoryError('Student record not found.');
  return { student: s, eventId: row.event_id ? String(row.event_id) : null };
}

/* ── Admin listing ─────────────────────────────────────────────────────────── */

async function listDepartments() {
  await ready;
  const { rows } = await pgPool.query(
    `SELECT d.id, d.code, d.name,
            (SELECT COUNT(*)::int FROM university_students s WHERE s.department_id = d.id) AS students,
            (SELECT json_build_object('fileName', i.file_name, 'at', i.created_at, 'added', i.added, 'updated', i.updated)
               FROM student_imports i WHERE i.department_id = d.id ORDER BY i.created_at DESC LIMIT 1) AS last_import
     FROM university_departments d ORDER BY d.code`
  );
  return rows.map(r => ({ id: String(r.id), code: r.code, name: r.name, students: r.students, lastImport: r.last_import }));
}

async function searchStudents({ q, departmentId, limit = 50 }) {
  await ready;
  const term = String(q || '').trim();
  const { rows } = await pgPool.query(
    `SELECT ${STUDENT_COLS} FROM university_students s JOIN university_departments d ON d.id = s.department_id
     WHERE ($1::int IS NULL OR s.department_id = $1)
       AND ($2 = '' OR s.enrollment_no ILIKE $3 OR s.admission_no ILIKE $3 OR s.name ILIKE $3 OR s.email ILIKE $3)
     ORDER BY s.name LIMIT $4`,
    [departmentId ? Number(departmentId) : null, term, `%${term}%`, Math.min(Number(limit) || 50, 200)]
  );
  return rows.map(s => ({ id: String(s.id), ...verifiedView(s) }));
}

module.exports = {
  ready, DirectoryError, normId, normCode,
  importDepartmentFile, findStudent, getStudentById, publicView, verifiedView,
  issueVerificationToken, studentFromToken, createVerificationLink, studentFromLink, LINK_MINUTES,
  listDepartments, searchStudents,
};
