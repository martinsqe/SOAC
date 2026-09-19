/**
 * Admin "Activity Monitor" — read-only views of member, club and coordinator
 * activity. Members are students; every figure is derived from existing tables
 * (registrations, memberships, attendance, tasks, certificates, wall of fame,
 * reports) — nothing here awards or stores points.
 */
const { pgPool } = require('../config/db');
const { ensureSoacTables } = require('../services/soacData');
const { syncPastEvents } = require('../services/eventStatus');

/* Same 8 event categories -> 4 groups mapping the public "My Activity" page uses
   (see ACTIVITY_BUCKET in users.controller.js); anything unknown counts as academic. */
const BUCKET_SQL = (col) => `
  CASE ${col}
    WHEN 'sports' THEN 'sports'
    WHEN 'cultural' THEN 'cultural' WHEN 'annual-fest' THEN 'cultural'
    WHEN 'community' THEN 'social' WHEN 'leadership' THEN 'social'
    ELSE 'academic'
  END`;

const CERT_LABEL = { winner: 'Winner', runner_up: 'Runner-up', participation: 'Participant' };

/* One row per active student with the profile fields that only live on other
   tables: department/year/enrollment from their latest join request, and
   department/course from their latest event registration. `course` exists only
   on event_registrations (free text the student typed), so it is blank for
   students who have never registered for an event. */
const BASE_MEMBERS = `
  SELECT u.id, u.name, u.email,
         REPLACE(UPPER(COALESCE(NULLIF(TRIM(jr.dept), ''), NULLIF(TRIM(er.dept), ''), '')), 'AI.ML', 'AI/ML') AS dept,
         COALESCE(NULLIF(TRIM(er.course), ''), '') AS course,
         COALESCE(jr.year, '') AS year,
         COALESCE(jr.enrollment_no, '') AS enrollment_no
  FROM users u
  LEFT JOIN LATERAL (
    SELECT dept, year, enrollment_no FROM join_requests
    WHERE LOWER(email) = LOWER(u.email)
    ORDER BY (status = 'approved') DESC, updated_at DESC LIMIT 1
  ) jr ON true
  LEFT JOIN LATERAL (
    SELECT dept, course FROM event_registrations
    WHERE LOWER(email) = LOWER(u.email)
    ORDER BY registered_at DESC LIMIT 1
  ) er ON true
  WHERE u.role = 'student' AND u.is_active = true`;

const likeTerm = (s) => `%${String(s).trim().replace(/[\\%_]/g, m => '\\' + m)}%`;

/* ── GET /api/activity-monitor/filters ── dropdown options */
const getFilters = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const [depts, courses, clubs] = await Promise.all([
      pgPool.query(
        `SELECT DISTINCT REPLACE(UPPER(TRIM(d)), 'AI.ML', 'AI/ML') AS dept
         FROM (SELECT dept AS d FROM join_requests UNION ALL SELECT dept FROM event_registrations) x
         WHERE TRIM(COALESCE(d, '')) <> ''
         ORDER BY 1`
      ),
      pgPool.query(
        `SELECT MIN(TRIM(course)) AS course FROM event_registrations
         WHERE TRIM(COALESCE(course, '')) <> ''
         GROUP BY LOWER(TRIM(course)) ORDER BY 1`
      ),
      pgPool.query(`SELECT id::text AS id, name FROM clubs WHERE is_active = true ORDER BY name`),
    ]);
    res.json({
      departments: depts.rows.map(r => r.dept),
      courses:     courses.rows.map(r => r.course),
      clubs:       clubs.rows,
    });
  } catch (err) { next(err); }
};

/* ── GET /api/activity-monitor/summary ── headline numbers */
const getSummary = async (req, res, next) => {
  try {
    await ensureSoacTables();
    await syncPastEvents();
    const { rows } = await pgPool.query(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE role = 'student'     AND is_active = true)::int AS students,
         (SELECT COUNT(*) FROM users WHERE role = 'coordinator' AND is_active = true)::int AS coordinators,
         (SELECT COUNT(*) FROM clubs WHERE is_active = true)::int                          AS clubs,
         (SELECT COUNT(*) FROM events WHERE is_active = true AND status = 'past')::int     AS events_conducted,
         (SELECT COUNT(*) FROM event_reports)::int                                         AS reports_generated`
    );
    const r = rows[0];
    res.json({
      students: r.students, coordinators: r.coordinators, clubs: r.clubs,
      eventsConducted: r.events_conducted, reportsGenerated: r.reports_generated,
    });
  } catch (err) { next(err); }
};

/* Metrics for one page of members, fetched in a handful of batched queries
   keyed by user id rather than per-member round trips. */
const loadMemberMetrics = async (ids) => {
  const [clubRes, eventRes, contribRes, certRes, fameRes] = await Promise.all([
    pgPool.query(
      `SELECT sc.user_id, sc.club_id::text AS club_id, COALESCE(c.name, sc.club_name) AS club_name
       FROM student_clubs sc LEFT JOIN clubs c ON c.id = sc.club_id
       WHERE sc.user_id = ANY($1::int[]) AND sc.is_active = true
       ORDER BY sc.joined_at`,
      [ids]
    ),
    pgPool.query(
      `SELECT u.id AS user_id, ${BUCKET_SQL('e.category')} AS bucket, COUNT(DISTINCT er.event_id)::int AS cnt
       FROM users u
       JOIN event_registrations er ON LOWER(er.email) = LOWER(u.email)
       LEFT JOIN events e ON e.id = er.event_id
       WHERE u.id = ANY($1::int[])
       GROUP BY u.id, bucket`,
      [ids]
    ),
    pgPool.query(
      `SELECT sc.user_id,
              (SELECT COUNT(*) FROM club_attendance_sessions s WHERE s.club_id = sc.club_id)::int AS total_sessions,
              (SELECT COUNT(*) FROM club_attendance_records r
                 JOIN club_attendance_sessions s ON s.id = r.session_id
                WHERE s.club_id = sc.club_id AND r.user_id = sc.user_id
                  AND r.status IN ('present', 'late'))::int AS attended,
              (SELECT COUNT(*) FROM task_completion_records t
                WHERE t.club_id = sc.club_id AND t.user_id = sc.user_id AND t.is_completed)::int AS tasks_done
       FROM student_clubs sc
       WHERE sc.user_id = ANY($1::int[]) AND sc.is_active = true`,
      [ids]
    ),
    pgPool.query(
      `SELECT u.id AS user_id, ec.category, COUNT(*)::int AS cnt
       FROM users u
       JOIN event_registrations er ON LOWER(er.email) = LOWER(u.email)
       JOIN event_certificates_issued ec ON ec.registration_id = er.id
       WHERE u.id = ANY($1::int[])
       GROUP BY u.id, ec.category`,
      [ids]
    ),
    pgPool.query(
      `SELECT u.id AS user_id, COUNT(*)::int AS cnt
       FROM users u
       JOIN wall_of_fame w ON LOWER(w.email) = LOWER(u.email) AND w.is_active = true
       WHERE u.id = ANY($1::int[])
       GROUP BY u.id`,
      [ids]
    ),
  ]);

  const byUser = new Map(ids.map(id => [id, {
    clubs: [],
    events: { sports: 0, cultural: 0, social: 0, academic: 0, total: 0 },
    contribution: { sessionsAttended: 0, totalSessions: 0, attendancePct: null, tasksCompleted: 0 },
    achievements: { winner: 0, runnerUp: 0, participation: 0, fame: 0, total: 0 },
  }]));

  clubRes.rows.forEach(r => byUser.get(r.user_id)?.clubs.push({ id: r.club_id, name: r.club_name }));
  eventRes.rows.forEach(r => {
    const m = byUser.get(r.user_id); if (!m) return;
    m.events[r.bucket] += r.cnt; m.events.total += r.cnt;
  });
  contribRes.rows.forEach(r => {
    const c = byUser.get(r.user_id)?.contribution; if (!c) return;
    c.sessionsAttended += r.attended; c.totalSessions += r.total_sessions; c.tasksCompleted += r.tasks_done;
  });
  byUser.forEach(m => {
    const c = m.contribution;
    c.attendancePct = c.totalSessions > 0 ? Math.round((c.sessionsAttended / c.totalSessions) * 100) : null;
  });
  certRes.rows.forEach(r => {
    const a = byUser.get(r.user_id)?.achievements; if (!a) return;
    if (r.category === 'winner') a.winner += r.cnt;
    else if (r.category === 'runner_up') a.runnerUp += r.cnt;
    else a.participation += r.cnt;
  });
  fameRes.rows.forEach(r => { const a = byUser.get(r.user_id)?.achievements; if (a) a.fame += r.cnt; });
  byUser.forEach(m => {
    const a = m.achievements;
    a.total = a.winner + a.runnerUp + a.participation + a.fame;
  });
  return byUser;
};

/* ── GET /api/activity-monitor/members?search=&dept=&course=&clubId=&page=&limit= */
const getMembers = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const { search, dept, course, clubId } = req.query;

    const values = [];
    const where  = [];
    if (search?.trim()) { values.push(likeTerm(search)); where.push(`(m.name ILIKE $${values.length} OR m.email ILIKE $${values.length})`); }
    if (dept)           { values.push(dept);             where.push(`m.dept = $${values.length}`); }
    if (course)         { values.push(course);           where.push(`LOWER(m.course) = LOWER($${values.length})`); }
    if (clubId)         {
      values.push(clubId);
      where.push(`EXISTS (SELECT 1 FROM student_clubs sc WHERE sc.user_id = m.id AND sc.is_active = true AND sc.club_id = $${values.length}::bigint)`);
    }
    values.push(limit, (page - 1) * limit);

    const { rows } = await pgPool.query(
      `SELECT m.*, COUNT(*) OVER() AS total_count
       FROM (${BASE_MEMBERS}) m
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY m.name
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    const total   = Number(rows[0]?.total_count ?? 0);
    const metrics = rows.length ? await loadMemberMetrics(rows.map(r => r.id)) : new Map();

    res.json({
      members: rows.map(r => ({
        id: r.id, name: r.name, email: r.email,
        dept: r.dept, course: r.course, year: r.year, enrollmentNo: r.enrollment_no,
        ...metrics.get(r.id),
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
};

/* ── GET /api/activity-monitor/members/:userId ── expanded detail for one member */
const getMemberDetail = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId)) return res.status(400).json({ message: 'Invalid member id.' });

    const [clubRes, eventRes, certRes, fameRes] = await Promise.all([
      pgPool.query(
        `SELECT sc.club_id::text AS club_id, COALESCE(c.name, sc.club_name) AS club_name, sc.joined_at,
                (SELECT COUNT(*) FROM club_attendance_sessions s WHERE s.club_id = sc.club_id)::int AS total_sessions,
                (SELECT COUNT(*) FROM club_attendance_records r
                   JOIN club_attendance_sessions s ON s.id = r.session_id
                  WHERE s.club_id = sc.club_id AND r.user_id = sc.user_id
                    AND r.status IN ('present', 'late'))::int AS attended,
                (SELECT COUNT(*) FROM task_completion_records t
                  WHERE t.club_id = sc.club_id AND t.user_id = sc.user_id AND t.is_completed)::int AS tasks_done,
                (SELECT l.role_title FROM club_leadership l
                  WHERE l.club_id = sc.club_id AND l.user_id = sc.user_id LIMIT 1) AS leadership_role
         FROM student_clubs sc LEFT JOIN clubs c ON c.id = sc.club_id
         WHERE sc.user_id = $1 AND sc.is_active = true
         ORDER BY sc.joined_at`,
        [userId]
      ),
      pgPool.query(
        `SELECT er.event_id::text AS event_id, er.event_title, e.start_date, c.name AS club_name,
                ${BUCKET_SQL('e.category')} AS bucket
         FROM users u
         JOIN event_registrations er ON LOWER(er.email) = LOWER(u.email)
         LEFT JOIN events e ON e.id = er.event_id
         LEFT JOIN clubs c ON c.id = e.club_id
         WHERE u.id = $1
         ORDER BY e.start_date DESC NULLS LAST, er.registered_at DESC
         LIMIT 200`,
        [userId]
      ),
      pgPool.query(
        `SELECT ec.category, er.event_title, c.name AS club_name
         FROM users u
         JOIN event_registrations er ON LOWER(er.email) = LOWER(u.email)
         JOIN event_certificates_issued ec ON ec.registration_id = er.id
         LEFT JOIN events e ON e.id = er.event_id
         LEFT JOIN clubs c ON c.id = e.club_id
         WHERE u.id = $1
         ORDER BY (ec.category = 'winner') DESC, (ec.category = 'runner_up') DESC, ec.created_at DESC`,
        [userId]
      ),
      pgPool.query(
        `SELECT w.achievement, w.club_name, w.year, w.term
         FROM users u JOIN wall_of_fame w ON LOWER(w.email) = LOWER(u.email) AND w.is_active = true
         WHERE u.id = $1
         ORDER BY w.sort_order, w.id DESC`,
        [userId]
      ),
    ]);

    res.json({
      clubs: clubRes.rows.map(r => ({
        id: r.club_id, name: r.club_name, joinedAt: r.joined_at,
        sessionsAttended: r.attended, totalSessions: r.total_sessions,
        attendancePct: r.total_sessions > 0 ? Math.round((r.attended / r.total_sessions) * 100) : null,
        tasksCompleted: r.tasks_done, role: r.leadership_role || '',
      })),
      events: eventRes.rows.map(r => ({
        eventId: r.event_id, title: r.event_title, clubName: r.club_name || '',
        category: r.bucket, date: r.start_date,
      })),
      achievements: [
        ...certRes.rows.map(r => ({
          type: 'Certificate', title: CERT_LABEL[r.category] || 'Participant',
          detail: r.event_title || '', clubName: r.club_name || '',
        })),
        ...fameRes.rows.map(r => ({
          type: 'Wall of Fame', title: r.achievement,
          detail: [r.term, r.year].filter(Boolean).join(' · '), clubName: r.club_name || '',
        })),
      ],
    });
  } catch (err) { next(err); }
};

/* ── GET /api/activity-monitor/clubs?search= ── per-club activity */
const getClubs = async (req, res, next) => {
  try {
    await ensureSoacTables();
    await syncPastEvents();
    const values = [];
    let where = 'c.is_active = true';
    if (req.query.search?.trim()) { values.push(likeTerm(req.query.search)); where += ` AND c.name ILIKE $1`; }

    const { rows } = await pgPool.query(
      `SELECT c.id::text AS id, c.name, c.category,
         (SELECT COUNT(*) FROM student_clubs sc WHERE sc.club_id = c.id AND sc.is_active = true)::int AS members,
         (SELECT COUNT(*) FROM events e
           WHERE e.is_active = true AND e.status = 'past'
             AND (e.club_id = c.id OR (e.club_id IS NULL AND e.club = c.name)))::int AS events_conducted,
         (SELECT COUNT(*) FROM events e
           WHERE e.is_active = true AND e.status IN ('upcoming', 'ongoing')
             AND (e.club_id = c.id OR (e.club_id IS NULL AND e.club = c.name)))::int AS events_upcoming,
         (SELECT COUNT(*) FROM event_reports r WHERE r.club_id = c.id)::int AS reports_generated,
         (SELECT COUNT(*) FROM event_reports r WHERE r.club_id = c.id AND r.submitted_at IS NOT NULL)::int AS reports_submitted
       FROM clubs c
       WHERE ${where}
       ORDER BY c.name`,
      values
    );
    res.json({
      clubs: rows.map(r => ({
        id: r.id, name: r.name, category: r.category, members: r.members,
        eventsConducted: r.events_conducted, eventsUpcoming: r.events_upcoming,
        reportsGenerated: r.reports_generated, reportsSubmitted: r.reports_submitted,
      })),
    });
  } catch (err) { next(err); }
};

/* ── GET /api/activity-monitor/coordinators?search=&clubId= ── clubs per coordinator
   Counts both the assignments table and the legacy users.managed_club_id, and
   only clubs that are still active. Done in SQL (not coordAuth.getCoordClubIds)
   because that helper is per-user and auto-repairs rows as a side effect. */
const getCoordinators = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const values = [];
    const where  = [`u.role = 'coordinator'`, `u.is_active = true`];
    if (req.query.search?.trim()) {
      values.push(likeTerm(req.query.search));
      where.push(`(u.name ILIKE $${values.length} OR u.email ILIKE $${values.length})`);
    }
    if (req.query.clubId) {
      values.push(req.query.clubId);
      where.push(`EXISTS (SELECT 1 FROM assigned a2 WHERE a2.user_id = u.id AND a2.club_id = $${values.length}::bigint)`);
    }

    const { rows } = await pgPool.query(
      `WITH assigned AS (
         SELECT user_id, club_id FROM coordinator_club_assignments WHERE is_active = true
         UNION
         SELECT id, managed_club_id FROM users WHERE role = 'coordinator' AND managed_club_id IS NOT NULL
       )
       SELECT u.id, u.name, u.email,
              COUNT(DISTINCT c.id)::int AS club_count,
              COALESCE(json_agg(DISTINCT jsonb_build_object('id', c.id::text, 'name', c.name))
                       FILTER (WHERE c.id IS NOT NULL), '[]') AS clubs
       FROM users u
       LEFT JOIN assigned a ON a.user_id = u.id
       LEFT JOIN clubs c ON c.id = a.club_id AND c.is_active = true
       WHERE ${where.join(' AND ')}
       GROUP BY u.id, u.name, u.email
       ORDER BY u.name`,
      values
    );
    res.json({
      coordinators: rows.map(r => ({
        id: r.id, name: r.name, email: r.email, clubCount: r.club_count,
        clubs: [...r.clubs].sort((a, b) => a.name.localeCompare(b.name)),
      })),
    });
  } catch (err) { next(err); }
};

module.exports = { getFilters, getSummary, getMembers, getMemberDetail, getClubs, getCoordinators };
