/* Galore portal — a login of its own, separate from the club/SOAC accounts
   (users table, /login, the navbar), so neither system can affect the other.

   Accounts are keyed by email and created automatically:
     • a student's on their first Galore registration (from their verified
       university record), and
     • a department coordinator's, an activity coordinator's or the overall
       Galore coordinator's when the admin assigns them (by name + email).
   The first email carries a temporary password; the portal asks for a new one
   at first login. What someone sees is worked out from their email each time:
   a student their own registrations, staff the activities / departments the
   admin assigned to them — so assignments changed later just show up. */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { pgPool } = require('../config/db');

const ready = (async () => {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS galore_accounts (
      id                    BIGSERIAL     PRIMARY KEY,
      email                 VARCHAR(255)  NOT NULL UNIQUE,
      name                  VARCHAR(255)  NOT NULL DEFAULT '',
      password_hash         VARCHAR(100)  NOT NULL,
      must_change_password  BOOLEAN       NOT NULL DEFAULT true,
      created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      last_login_at         TIMESTAMPTZ
    )
  `);
  /* Guidelines file — on the umbrella (general guidelines) and on each activity */
  await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS rules_url  VARCHAR(500) NOT NULL DEFAULT ''`);
  await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS rules_name VARCHAR(255) NOT NULL DEFAULT ''`);
})().catch(err => console.error('[galorePortal] migration failed:', err.message));

class PortalError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/* YYYY-MM-DD in local time — dates are stored at local midnight */
const isoDay = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const normEmail = (e) => String(e || '').trim().toLowerCase();

/* Easy to read out and type: no 0/O/1/l/I */
function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (const b of bytes) out += chars[b % chars.length];
  return `Gal-${out}`;
}

/* The account for this email, creating it if needed. A temporary password is
   returned only when the account is new — it's the one time it's emailed. */
async function ensureAccount(email, name) {
  await ready;
  const e = normEmail(email);
  if (!e) return { created: false };
  const pwd = tempPassword();
  const { rows } = await pgPool.query(
    `INSERT INTO galore_accounts (email, name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING RETURNING id`,
    [e, String(name || '').slice(0, 255), await bcrypt.hash(pwd, 10)]
  );
  return rows.length ? { created: true, tempPassword: pwd } : { created: false };
}

/* Forgot password, step 1: who it's for. An existing account — or, for someone
   who should have one but doesn't yet (registered / assigned before the portal
   existed), their name so an account can be made. null = not a Galore person. */
async function forgotTarget(email) {
  await ready;
  const e = normEmail(email);
  if (!e) return null;
  const { rows } = await pgPool.query(`SELECT email, name FROM galore_accounts WHERE email = $1`, [e]);
  if (rows[0]) return { email: rows[0].email, name: rows[0].name, exists: true };
  const { rows: who } = await pgPool.query(
    `SELECT name FROM (
       SELECT er.name FROM event_registrations er
         JOIN events a ON a.id = er.event_id AND a.is_active = true
         JOIN events u ON u.id = a.parent_event_id AND u.is_active = true AND u.event_format = 'galore'
        WHERE LOWER(er.email) = $1
       UNION ALL
       SELECT h.name FROM galore_heads h JOIN events u ON u.id = h.event_id AND u.is_active = true WHERE LOWER(h.email) = $1
       UNION ALL
       SELECT a.galore_coord_name FROM events a
         JOIN events u ON u.id = a.parent_event_id AND u.is_active = true AND u.event_format = 'galore'
        WHERE a.is_active = true AND LOWER(a.galore_coord_email) = $1
       UNION ALL
       SELECT d.coord_name FROM galore_departments d JOIN events u ON u.id = d.event_id AND u.is_active = true
        WHERE LOWER(d.coord_email) = $1
     ) x LIMIT 1`,
    [e]
  );
  return who[0] ? { email: e, name: who[0].name, exists: false } : null;
}

/* Forgot password, step 2 — only once the email with it has gone out, so a
   failed send never locks someone out of their current password. */
async function setTempPassword({ email, name }, pwd) {
  await pgPool.query(
    `INSERT INTO galore_accounts (email, name, password_hash, must_change_password) VALUES ($1, $2, $3, true)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = true`,
    [normEmail(email), String(name || '').slice(0, 255), await bcrypt.hash(pwd, 10)]
  );
}

/* Forgot password in one go (no email): a fresh temporary password, or null */
async function resetPassword(email) {
  const target = await forgotTarget(email);
  if (!target) return null;
  const pwd = tempPassword();
  await setTempPassword(target, pwd);
  return { email: target.email, name: target.name, tempPassword: pwd };
}

const issueToken = (acc) =>
  jwt.sign({ gid: String(acc.id), email: acc.email, purpose: 'galore' }, process.env.JWT_SECRET, { expiresIn: '7d' });

async function login(email, password) {
  await ready;
  const { rows } = await pgPool.query(`SELECT * FROM galore_accounts WHERE email = $1`, [normEmail(email)]);
  const acc = rows[0];
  if (!acc || !(await bcrypt.compare(String(password || ''), acc.password_hash))) {
    throw new PortalError('Wrong email or password.', 401);
  }
  await pgPool.query(`UPDATE galore_accounts SET last_login_at = NOW() WHERE id = $1`, [acc.id]);
  return { token: issueToken(acc), account: { name: acc.name, email: acc.email, mustChangePassword: acc.must_change_password } };
}

async function changePassword(accountId, current, next) {
  const { rows } = await pgPool.query(`SELECT password_hash FROM galore_accounts WHERE id = $1`, [accountId]);
  if (!rows[0] || !(await bcrypt.compare(String(current || ''), rows[0].password_hash))) {
    throw new PortalError('Your current password is not correct.');
  }
  const pwd = String(next || '');
  if (pwd.length < 8) throw new PortalError('Choose a password of at least 8 characters.');
  await pgPool.query(`UPDATE galore_accounts SET password_hash = $1, must_change_password = false WHERE id = $2`,
    [await bcrypt.hash(pwd, 10), accountId]);
}

/* Express middleware: a valid Galore portal token (never a club login token) */
async function requireGalore(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ message: 'Please log in to the Galore portal.' });
  try {
    const p = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    if (p.purpose !== 'galore') throw new Error('wrong token');
    const { rows } = await pgPool.query(`SELECT id, email, name, must_change_password FROM galore_accounts WHERE id = $1`, [p.gid]);
    if (!rows[0]) throw new Error('no account');
    req.galore = rows[0];
    next();
  } catch {
    res.status(401).json({ message: 'Your Galore session has expired — please log in again.' });
  }
}

/* ── What the portal shows ─────────────────────────────────────────────────── */

const UMBRELLA_COLS = `u.id AS u_id, u.title AS u_title, u.date AS u_date, u.time AS u_time, u.venue AS u_venue,
                       u.description AS u_description, u.status AS u_status, u.rules_url AS u_rules_url, u.rules_name AS u_rules_name`;
const umbrellaOut = (r) => ({
  id: String(r.u_id), title: r.u_title, date: r.u_date || '', time: r.u_time || '', venue: r.u_venue || '',
  description: r.u_description || '', status: r.u_status,
  rules: r.u_rules_url ? { url: r.u_rules_url, name: r.u_rules_name || 'General guidelines' } : null,
});
const activityOut = (r) => ({
  id: String(r.id), title: r.title, categoryName: r.category_name || r.category, category: r.category,
  participationType: Number(r.team_size || 0) > 0 ? 'team' : 'individual',
  minTeamSize: Number(r.min_team_size || 0), teamSize: Number(r.team_size || 0), genderSplit: !!r.gender_split,
  /* the activity's own schedule */
  date: r.start_date ? isoDay(r.start_date) : '', // for sorting the timetable
  /* blank until the admin sets them — shown as "to be announced" */
  dateLabel: r.date || '', time: r.time || '', venue: r.venue || '',
  registrationClosed: !!r.registration_closed,
  rules: r.rules_url ? { url: r.rules_url, name: r.rules_name || `${r.title} guidelines` } : null,
  clubName: r.club_name || '', // the club running it
});
const ACT_CLUB = `(SELECT name FROM clubs WHERE clubs.id = e.club_id) AS club_name`;

/* A student: every Galore activity they registered for, grouped by event, with
   who's in charge (the activity coordinator + their department coordinator) and
   which club runs it, their team once one is made, and the guidelines files. */
async function studentView(email) {
  const { rows } = await pgPool.query(
    `SELECT e.id, e.title, e.category, e.team_size, e.min_team_size, e.gender_split, e.start_date, e.date, e.time,
            e.venue, e.rules_url, e.rules_name, e.registration_closed, c.name AS category_name, c.sort_order AS cat_order,
            er.id AS reg_id, er.dept, er.registered_at, ${UMBRELLA_COLS}, ${ACT_CLUB},
            CASE WHEN e.galore_coord_email <> '' THEN json_build_object('name', e.galore_coord_name, 'email', e.galore_coord_email) END AS coordinator,
            (SELECT json_build_object('name', d.coord_name, 'email', d.coord_email) FROM galore_departments d
              WHERE d.event_id = u.id AND LOWER(d.name) = LOWER(er.dept) AND d.coord_email <> '' LIMIT 1) AS dept_coordinator,
            (SELECT json_build_object('name', t.name, 'division', t.division,
                      'members', (SELECT json_agg(m2.member_name ORDER BY m2.id) FROM event_team_members m2 WHERE m2.team_id = t.id))
               FROM event_team_members m JOIN event_teams t ON t.id = m.team_id WHERE m.registration_id = er.id LIMIT 1) AS team
     FROM event_registrations er
     JOIN events e ON e.id = er.event_id AND e.is_active = true
     JOIN events u ON u.id = e.parent_event_id AND u.is_active = true AND u.event_format = 'galore'
     LEFT JOIN galore_categories c ON c.id = e.galore_category_id
     WHERE LOWER(er.email) = $1
     ORDER BY u.start_date DESC NULLS LAST, u.id DESC, e.start_date NULLS LAST, c.sort_order NULLS LAST, e.title`,
    [normEmail(email)]
  );
  const byEvent = new Map();
  for (const r of rows) {
    if (!byEvent.has(r.u_id)) byEvent.set(r.u_id, { event: umbrellaOut(r), department: r.dept, activities: [] });
    byEvent.get(r.u_id).activities.push({
      ...activityOut(r), registeredAt: r.registered_at,
      coordinator: r.coordinator, deptCoordinator: r.dept_coordinator, team: r.team,
    });
  }
  return [...byEvent.values()];
}

/* Assigned people: the Galore activities they coordinate and the departments
   they're the department coordinator of, grouped by event — matched by the
   email the admin assigned them with. */
async function staffView(email) {
  const e = normEmail(email);
  const [{ rows: acts }, { rows: depts }] = await Promise.all([
    pgPool.query(
      `SELECT e.id, e.title, e.category, e.team_size, e.min_team_size, e.gender_split, e.start_date, e.date, e.time,
              e.venue, e.rules_url, e.rules_name, e.registration_closed, c.name AS category_name, ${UMBRELLA_COLS}, ${ACT_CLUB},
              (SELECT COUNT(*)::int FROM event_registrations er WHERE er.event_id = e.id AND er.email NOT ILIKE '%@roster.internal') AS registration_count,
              (SELECT COUNT(*)::int FROM event_teams t WHERE t.event_id = e.id) AS team_count
       FROM events e
       JOIN events u ON u.id = e.parent_event_id AND u.is_active = true AND u.event_format = 'galore'
       LEFT JOIN galore_categories c ON c.id = e.galore_category_id
       WHERE e.is_active = true AND LOWER(e.galore_coord_email) = $1
       ORDER BY u.id DESC, c.sort_order NULLS LAST, e.title`,
      [e]
    ),
    pgPool.query(
      `SELECT d.name, ${UMBRELLA_COLS},
              (SELECT COUNT(*)::int FROM event_registrations er JOIN events a ON a.id = er.event_id
                WHERE a.parent_event_id = u.id AND a.is_active = true AND LOWER(er.dept) = LOWER(d.name)) AS registration_count
       FROM galore_departments d
       JOIN events u ON u.id = d.event_id AND u.is_active = true
       WHERE LOWER(d.coord_email) = $1
       ORDER BY u.id DESC, d.sort_order`,
      [e]
    ),
  ]);
  const byEvent = new Map();
  const slot = (r) => {
    if (!byEvent.has(r.u_id)) byEvent.set(r.u_id, { event: umbrellaOut(r), activities: [], departments: [] });
    return byEvent.get(r.u_id);
  };
  for (const r of acts)  slot(r).activities.push({ ...activityOut(r), registrationCount: r.registration_count, teamCount: r.team_count });
  for (const r of depts) slot(r).departments.push({ name: r.name, registrationCount: r.registration_count });
  return [...byEvent.values()];
}

/* Which activities / departments of one Galore event this email looks after */
async function staffScope(email, umbrellaId) {
  const e = normEmail(email);
  const [{ rows: own }, { rows: depts }] = await Promise.all([
    pgPool.query(`SELECT id FROM events WHERE parent_event_id = $1 AND is_active = true AND LOWER(galore_coord_email) = $2`, [umbrellaId, e]),
    pgPool.query(`SELECT name FROM galore_departments WHERE event_id = $1 AND LOWER(coord_email) = $2`, [umbrellaId, e]),
  ]);
  return { activityIds: own.map(r => String(r.id)), departments: depts.map(d => d.name) };
}

/* Every registration an assigned person may see in one Galore event:
     • activity coordinator  — their activities, every department
     • department coordinator — their department, every activity */
async function staffRegistrations(email, umbrellaId) {
  const scope = await staffScope(email, umbrellaId);
  if (!scope.activityIds.length && !scope.departments.length) throw new PortalError("You aren't assigned to this Galore event.", 403);
  const { rows } = await pgPool.query(
    `SELECT er.id, er.name, er.email, er.enrollment_no, er.dept, er.course, er.phone, er.gender, er.registered_at,
            us.enrollment_no AS us_enrollment, us.admission_no AS us_admission,
            e.id AS event_id, e.title AS event_title, c.name AS category_name, c.sort_order AS cat_order
     FROM event_registrations er
     JOIN events e ON e.id = er.event_id AND e.is_active = true
     LEFT JOIN galore_categories c ON c.id = e.galore_category_id
     LEFT JOIN university_students us ON us.id = er.student_id
     WHERE e.parent_event_id = $1 AND er.email NOT ILIKE '%@roster.internal'
       AND (e.id = ANY($2::bigint[]) OR LOWER(er.dept) = ANY(SELECT LOWER(x) FROM unnest($3::text[]) AS x))
     ORDER BY c.sort_order NULLS LAST, e.title, er.dept, er.name`,
    [umbrellaId, scope.activityIds, scope.departments]
  );
  return rows.map(r => ({
    registrationId: String(r.id), name: r.name, email: r.email, enrollmentNo: r.enrollment_no, dept: r.dept,
    course: r.course, phone: r.phone, gender: r.gender, registeredAt: r.registered_at,
    eventId: String(r.event_id), eventTitle: r.event_title, categoryName: r.category_name || '',
    /* every number the student might give at the venue (enrollment or admission) */
    numbers: [...new Set([r.enrollment_no, r.us_enrollment, r.us_admission].filter(Boolean))],
  }));
}

/* An activity's teams (with members), for its activity coordinator or the
   overall Galore coordinator. Teams themselves are made by the club running it. */
async function activityTeams(email, activityId) {
  const e = normEmail(email);
  const { rows: [act] } = await pgPool.query(
    `SELECT a.id, a.parent_event_id,
            (LOWER(a.galore_coord_email) = $2) AS is_coord,
            EXISTS (SELECT 1 FROM galore_heads h WHERE h.event_id = a.parent_event_id AND LOWER(h.email) = $2) AS is_head
     FROM events a WHERE a.id = $1 AND a.is_active = true AND a.parent_event_id IS NOT NULL`,
    [activityId, e]
  );
  if (!act || (!act.is_coord && !act.is_head)) throw new PortalError('Only the activity coordinator can see these teams.', 403);
  const { rows } = await pgPool.query(
    `SELECT t.id, t.name, t.division, t.dept,
            COALESCE(json_agg(json_build_object('name', m.member_name, 'enrollmentNo', m.enrollment_no) ORDER BY m.id)
                     FILTER (WHERE m.id IS NOT NULL), '[]') AS members
     FROM event_teams t LEFT JOIN event_team_members m ON m.team_id = t.id
     WHERE t.event_id = $1 GROUP BY t.id ORDER BY t.division, t.name`,
    [activityId]
  );
  return rows.map(t => ({ id: String(t.id), name: t.name, division: t.division, dept: t.dept || '', members: t.members }));
}

/* ── The overall Galore coordinator ─────────────────────────────────────────── */

/* Galore events this email is the overall coordinator of */
async function headView(email) {
  const { rows } = await pgPool.query(
    `SELECT ${UMBRELLA_COLS} FROM galore_heads h JOIN events u ON u.id = h.event_id AND u.is_active = true
     WHERE LOWER(h.email) = $1 ORDER BY u.start_date DESC NULLS LAST, u.id DESC`,
    [normEmail(email)]
  );
  return rows.map(r => ({ event: umbrellaOut(r) }));
}

async function assertHead(email, umbrellaId) {
  const { rows } = await pgPool.query(
    `SELECT 1 FROM galore_heads h JOIN events u ON u.id = h.event_id AND u.is_active = true
     WHERE h.event_id = $1 AND LOWER(h.email) = $2`,
    [umbrellaId, normEmail(email)]
  );
  if (!rows.length) throw new PortalError("You aren't the Galore coordinator of this event.", 403);
}

/* The umbrella event's own details, as the head edits them */
async function headEventDetails(umbrellaId) {
  const { rows: [e] } = await pgPool.query(
    `SELECT id, title, date, start_date, time, venue, description, seats, highlight, status, campus,
            (SELECT COUNT(*)::int FROM event_registrations er JOIN events a ON a.id = er.event_id
              WHERE a.parent_event_id = u.id AND a.is_active = true AND er.email NOT ILIKE '%@roster.internal') AS registration_count,
            (SELECT COUNT(DISTINCT LOWER(er.email))::int FROM event_registrations er JOIN events a ON a.id = er.event_id
              WHERE a.parent_event_id = u.id AND a.is_active = true AND er.email NOT ILIKE '%@roster.internal') AS student_count
     FROM events u WHERE u.id = $1`,
    [umbrellaId]
  );
  return {
    id: String(e.id), title: e.title, date: e.date || '', startDate: e.start_date ? isoDay(e.start_date) : '',
    time: e.time || '', venue: e.venue || '', description: e.description || '', seats: e.seats || '',
    highlight: e.highlight || '', status: e.status, campus: e.campus,
    registrationCount: e.registration_count, studentCount: e.student_count,
  };
}

/* Every registration in the event, all activities, all departments */
async function allRegistrations(umbrellaId) {
  const { rows } = await pgPool.query(
    `SELECT er.id, er.name, er.email, er.enrollment_no, er.dept, er.course, er.phone, er.gender, er.registered_at,
            us.enrollment_no AS us_enrollment, us.admission_no AS us_admission,
            e.id AS event_id, e.title AS event_title, c.name AS category_name
     FROM event_registrations er
     JOIN events e ON e.id = er.event_id AND e.is_active = true
     LEFT JOIN galore_categories c ON c.id = e.galore_category_id
     LEFT JOIN university_students us ON us.id = er.student_id
     WHERE e.parent_event_id = $1 AND er.email NOT ILIKE '%@roster.internal'
     ORDER BY c.sort_order NULLS LAST, e.title, er.dept, er.name`,
    [umbrellaId]
  );
  return rows.map(r => ({
    registrationId: String(r.id), name: r.name, email: r.email, enrollmentNo: r.enrollment_no, dept: r.dept,
    course: r.course, phone: r.phone, gender: r.gender, registeredAt: r.registered_at,
    eventId: String(r.event_id), eventTitle: r.event_title, categoryName: r.category_name || '',
    /* every number the student might give at the venue (enrollment or admission) */
    numbers: [...new Set([r.enrollment_no, r.us_enrollment, r.us_admission].filter(Boolean))],
  }));
}

module.exports = {
  ready, PortalError, ensureAccount, resetPassword, forgotTarget, setTempPassword, tempPassword, login, changePassword, requireGalore,
  studentView, staffView, staffScope, staffRegistrations, activityTeams, isoDay,
  headView, assertHead, headEventDetails, allRegistrations,
};
