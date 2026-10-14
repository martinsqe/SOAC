/**
 * Admin "Activity Monitor" — read-only views of member, club and coordinator
 * activity. Members are students; every figure is derived from existing tables
 * (registrations, memberships, attendance, tasks, certificates, wall of fame,
 * reports) — nothing here awards or stores points.
 */
const { pgPool } = require('../config/db');
const { ensureSoacTables } = require('../services/soacData');
const { syncPastEvents } = require('../services/eventStatus');
const { MAIN_CAMPUS, adminCampus, studentOnCampusSql } = require('../services/campus');

/* Every view here is scoped to the campus the admin is managing */
const campusOf = (req) => adminCampus(req) || MAIN_CAMPUS;

/* Same 8 event categories -> 4 groups mapping the public "My Activity" page uses
   (see ACTIVITY_BUCKET in users.controller.js); anything unknown counts as academic. */
const BUCKET_SQL = (col) => `
  CASE ${col}
    WHEN 'sports' THEN 'sports'
    WHEN 'cultural' THEN 'cultural' WHEN 'annual-fest' THEN 'cultural'
    WHEN 'community' THEN 'social' WHEN 'leadership' THEN 'social'
    ELSE 'academic'
  END`;

/* Every event each given member registered for, with how many attendance sessions
   the event has run. */
const REGISTERED_EVENTS_SQL = `
  SELECT u.id AS user_id, er.event_id::text AS event_id, er.event_title,
         e.start_date, c.id::text AS club_id, c.name AS club_name, ${BUCKET_SQL('e.category')} AS bucket,
         (SELECT COUNT(*) FROM event_attendance_sessions s WHERE s.event_id = er.event_id)::int AS total_sessions
  FROM users u
  JOIN event_registrations er ON LOWER(er.email) = LOWER(u.email)
  LEFT JOIN events e ON e.id = er.event_id
  LEFT JOIN clubs c ON c.id = e.club_id
  WHERE u.id = ANY($1::int[])`;

/* Event sessions each given member was marked present at, straight from the
   attendance records. A mark is recorded either against the member's account
   (user_id) or against one of their registrations (registration_id, for
   registrants with no account), so match both. Read from the records rather than
   via registrations because a coordinator can mark a member present at an event
   they never registered for. */
const ATTENDED_EVENTS_SQL = `
  SELECT u.id AS user_id, s.event_id::text AS event_id, e.title AS event_title,
         e.start_date, c.id::text AS club_id, c.name AS club_name, ${BUCKET_SQL('e.category')} AS bucket,
         COUNT(DISTINCT s.id)::int AS present_sessions,
         (SELECT COUNT(*) FROM event_attendance_sessions s2 WHERE s2.event_id = s.event_id)::int AS total_sessions
  FROM users u
  JOIN event_attendance_records r ON r.status = 'present'
   AND (r.user_id = u.id
        OR r.registration_id IN (SELECT er.id FROM event_registrations er WHERE LOWER(er.email) = LOWER(u.email)))
  JOIN event_attendance_sessions s ON s.id = r.session_id
  LEFT JOIN events e ON e.id = s.event_id
  LEFT JOIN clubs c ON c.id = e.club_id
  WHERE u.id = ANY($1::int[])
  GROUP BY u.id, s.event_id, e.title, e.start_date, c.id, c.name, e.category`;

/* Merge registrations and attendance into one entry per (member, event): an event
   counts as "registered" if they signed up, and as "attended" if they were marked
   present at any of its sessions — independently, since either can exist alone. */
const mergeMemberEvents = (registeredRows, attendedRows) => {
  const byUser = new Map();
  const entry = (r) => {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, new Map());
    const events = byUser.get(r.user_id);
    if (!events.has(r.event_id)) {
      events.set(r.event_id, {
        eventId: r.event_id, title: r.event_title || '', date: r.start_date, clubId: r.club_id || null, clubName: r.club_name || '',
        bucket: r.bucket, registered: false, totalSessions: 0, presentSessions: 0,
      });
    }
    return events.get(r.event_id);
  };
  registeredRows.forEach(r => { const e = entry(r); e.registered = true; e.totalSessions = r.total_sessions; });
  attendedRows.forEach(r => { const e = entry(r); e.presentSessions = r.present_sessions; e.totalSessions = r.total_sessions; });
  return byUser;
};

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
      pgPool.query(`SELECT id::text AS id, name FROM clubs WHERE is_active = true AND campus = $1 ORDER BY name`, [campusOf(req)]),
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
         (SELECT COUNT(*) FROM users u WHERE u.role = 'student' AND u.is_active = true
            AND ${studentOnCampusSql('u', '$1')})::int                                         AS students,
         (SELECT COUNT(DISTINCT u.id) FROM users u
            JOIN coordinator_club_assignments cca ON cca.user_id = u.id AND cca.is_active = true
            JOIN clubs c ON c.id = cca.club_id AND c.campus = $1
           WHERE u.role = 'coordinator' AND u.is_active = true)::int                           AS coordinators,
         (SELECT COUNT(*) FROM clubs WHERE is_active = true AND campus = $1)::int             AS clubs,
         (SELECT COUNT(*) FROM events WHERE is_active = true AND status = 'past' AND campus = $1)::int AS events_conducted,
         (SELECT COUNT(*) FROM event_reports r JOIN clubs c ON c.id = r.club_id AND c.campus = $1)::int AS reports_generated`,
      [campusOf(req)]
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
  const [clubRes, registeredRes, attendedRes, contribRes, certRes, fameRes] = await Promise.all([
    pgPool.query(
      `SELECT sc.user_id, sc.club_id::text AS club_id, COALESCE(c.name, sc.club_name) AS club_name
       FROM student_clubs sc LEFT JOIN clubs c ON c.id = sc.club_id
       WHERE sc.user_id = ANY($1::int[]) AND sc.is_active = true
       ORDER BY sc.joined_at`,
      [ids]
    ),
    pgPool.query(REGISTERED_EVENTS_SQL, [ids]),
    pgPool.query(ATTENDED_EVENTS_SQL, [ids]),
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
    events:   { sports: 0, cultural: 0, social: 0, academic: 0, total: 0 },
    attended: { sports: 0, cultural: 0, social: 0, academic: 0, total: 0 },
    eventAttendance: { eventsCounted: 0, pct: null },
    contribution: { sessionsAttended: 0, totalSessions: 0, attendancePct: null, tasksCompleted: 0 },
    achievements: { winner: 0, runnerUp: 0, participation: 0, fame: 0, total: 0 },
  }]));

  clubRes.rows.forEach(r => byUser.get(r.user_id)?.clubs.push({ id: r.club_id, name: r.club_name }));
  const fractionSum = new Map();
  mergeMemberEvents(registeredRes.rows, attendedRes.rows).forEach((events, userId) => {
    const m = byUser.get(userId); if (!m) return;
    events.forEach(ev => {
      if (ev.registered) { m.events[ev.bucket] += 1; m.events.total += 1; }
      if (ev.presentSessions > 0) { m.attended[ev.bucket] += 1; m.attended.total += 1; }
      // Overall rate = average of per-event percentages, over events that ran sessions.
      if (ev.totalSessions > 0) {
        m.eventAttendance.eventsCounted += 1;
        fractionSum.set(userId, (fractionSum.get(userId) || 0) + ev.presentSessions / ev.totalSessions);
      }
    });
  });
  contribRes.rows.forEach(r => {
    const c = byUser.get(r.user_id)?.contribution; if (!c) return;
    c.sessionsAttended += r.attended; c.totalSessions += r.total_sessions; c.tasksCompleted += r.tasks_done;
  });
  byUser.forEach(m => {
    const c = m.contribution;
    c.attendancePct = c.totalSessions > 0 ? Math.round((c.sessionsAttended / c.totalSessions) * 100) : null;
  });
  fractionSum.forEach((sum, userId) => {
    const ea = byUser.get(userId)?.eventAttendance;
    if (ea?.eventsCounted) ea.pct = Math.round((sum / ea.eventsCounted) * 100);
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

    const values = [campusOf(req)];
    const where  = [studentOnCampusSql('m', '$1')];
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

    const [clubRes, registeredRes, attendedRes, certRes, fameRes, volunteerRes, staffRes] = await Promise.all([
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
      pgPool.query(REGISTERED_EVENTS_SQL, [[userId]]),
      pgPool.query(ATTENDED_EVENTS_SQL, [[userId]]),
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
      pgPool.query(
        `SELECT v.event_id::text AS event_id, COALESCE(NULLIF(e.title, ''), v.event_title) AS event_title,
                v.role, e.start_date, c.id::text AS club_id, c.name AS club_name
         FROM users u
         JOIN event_volunteers v ON v.user_id = u.id OR LOWER(v.email) = LOWER(u.email)
         LEFT JOIN events e ON e.id = v.event_id
         LEFT JOIN clubs c ON c.id = e.club_id
         WHERE u.id = $1
         ORDER BY e.start_date DESC NULLS LAST, v.created_at DESC`,
        [userId]
      ),
      /* Clubs this person runs as Faculty Advisor or Student Coordinator, with what
         they have done for each — empty for students. */
      pgPool.query(
        `WITH mine AS (
           SELECT club_id FROM coordinator_club_assignments WHERE user_id = $1 AND is_active = true
           UNION
           SELECT managed_club_id FROM users WHERE id = $1 AND managed_club_id IS NOT NULL
             AND role IN ('coordinator', 'faculty_coordinator')
         )
         SELECT c.id::text AS club_id, c.name AS club_name,
                (SELECT COUNT(*) FROM event_requests q WHERE q.club_id = c.id AND q.coordinator_id = $1)::int AS events_proposed,
                (SELECT COUNT(*) FROM event_requests q WHERE q.club_id = c.id AND q.coordinator_id = $1 AND q.status = 'approved')::int AS events_approved,
                (SELECT COUNT(*) FROM club_attendance_sessions s WHERE s.club_id = c.id AND s.created_by = $1)::int AS sessions_held,
                (SELECT COUNT(*) FROM event_reports r WHERE r.club_id = c.id AND r.created_by = $1)::int AS reports_made,
                (SELECT COUNT(*) FROM event_reports r WHERE r.club_id = c.id AND r.submitted_by = $1)::int AS reports_submitted,
                (SELECT COUNT(*) FROM club_announcements a WHERE a.club_id = c.id AND a.author_id = $1 AND a.is_active = true)::int AS announcements,
                (SELECT COUNT(*) FROM club_tasks t WHERE t.club_id = c.id AND t.created_by = $1)::int AS tasks_assigned
         FROM mine JOIN clubs c ON c.id = mine.club_id AND c.is_active = true
         ORDER BY c.name`,
        [userId]
      ),
    ]);

    res.json({
      volunteering: volunteerRes.rows.map(r => ({
        eventId: r.event_id, title: r.event_title || '', role: r.role || '', date: r.start_date,
        clubId: r.club_id, clubName: r.club_name || '',
      })),
      coordinated: staffRes.rows.map(r => ({
        id: r.club_id, name: r.club_name,
        eventsProposed: r.events_proposed, eventsApproved: r.events_approved, sessionsHeld: r.sessions_held,
        reportsMade: r.reports_made, reportsSubmitted: r.reports_submitted,
        announcements: r.announcements, tasksAssigned: r.tasks_assigned,
      })),
      clubs: clubRes.rows.map(r => ({
        id: r.club_id, name: r.club_name, joinedAt: r.joined_at,
        sessionsAttended: r.attended, totalSessions: r.total_sessions,
        attendancePct: r.total_sessions > 0 ? Math.round((r.attended / r.total_sessions) * 100) : null,
        tasksCompleted: r.tasks_done, role: r.leadership_role || '',
      })),
      events: [...(mergeMemberEvents(registeredRes.rows, attendedRes.rows).get(userId)?.values() ?? [])]
        .sort((a, b) => (new Date(b.date || 0)) - (new Date(a.date || 0)))
        .map(ev => ({
          eventId: ev.eventId, title: ev.title, clubId: ev.clubId, clubName: ev.clubName, category: ev.bucket, date: ev.date,
          registered: ev.registered, totalSessions: ev.totalSessions, presentSessions: ev.presentSessions,
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

/* Events that belong to a club: linked by id, or (older rows) by name on the same campus */
const CLUB_EVENT_MATCH = (e, c) =>
  `(${e}.club_id = ${c}.id OR (${e}.club_id IS NULL AND ${e}.club = ${c}.name AND ${e}.campus = ${c}.campus))`;

/* Names of a club's active Faculty Advisors / Student Coordinators (user role decides which) */
const STAFF_NAMES = (role) => `(SELECT string_agg(u.name, ', ' ORDER BY u.name)
   FROM coordinator_club_assignments cca
   JOIN users u ON u.id = cca.user_id AND u.is_active = true AND u.role = '${role}'
   WHERE cca.club_id = c.id AND cca.is_active = true)`;

/* ── GET /api/activity-monitor/clubs?search= ── one row per club of the campus.
   "Last activity" is the most recent thing that happened in the club anywhere in
   the portal: an event held, a session, a report, an announcement, a post, a
   chat message, a task completed or a member joining. */
const getClubs = async (req, res, next) => {
  try {
    await ensureSoacTables();
    await syncPastEvents();
    const values = [campusOf(req)];
    let where = 'c.is_active = true AND c.campus = $1';
    if (req.query.search?.trim()) { values.push(likeTerm(req.query.search)); where += ` AND c.name ILIKE $2`; }

    const { rows } = await pgPool.query(
      `SELECT c.id::text AS id, c.name, c.category,
         COALESCE(${STAFF_NAMES('faculty_coordinator')}, NULLIF(c.faculty_coordinator, ''), '') AS fa_names,
         COALESCE(${STAFF_NAMES('coordinator')}, NULLIF(c.coordinator, ''), '') AS sc_names,
         (SELECT COUNT(*) FROM student_clubs sc WHERE sc.club_id = c.id AND sc.is_active = true)::int AS members,
         (SELECT COUNT(*) FROM events e
           WHERE e.is_active = true AND e.status = 'past' AND ${CLUB_EVENT_MATCH('e', 'c')})::int AS events_conducted,
         (SELECT COUNT(*) FROM events e
           WHERE e.is_active = true AND e.status IN ('upcoming', 'ongoing') AND ${CLUB_EVENT_MATCH('e', 'c')})::int AS events_upcoming,
         (SELECT COUNT(DISTINCT LOWER(er.email)) FROM event_registrations er JOIN events e ON e.id = er.event_id
           WHERE e.is_active = true AND ${CLUB_EVENT_MATCH('e', 'c')})::int AS participants,
         (SELECT COUNT(*) FROM event_reports r WHERE r.club_id = c.id)::int AS reports_generated,
         (SELECT COUNT(*) FROM event_reports r WHERE r.club_id = c.id AND r.submitted_at IS NOT NULL)::int AS reports_submitted,
         GREATEST(
           (SELECT MAX(e.start_date) FROM events e
             WHERE e.is_active = true AND e.status = 'past' AND e.start_date <= NOW() AND ${CLUB_EVENT_MATCH('e', 'c')}),
           (SELECT MAX(s.session_date)::timestamptz FROM club_attendance_sessions s WHERE s.club_id = c.id),
           (SELECT MAX(r.submitted_at) FROM event_reports r WHERE r.club_id = c.id),
           (SELECT MAX(a.created_at) FROM club_announcements a WHERE a.club_id = c.id AND a.is_active = true),
           (SELECT MAX(p.created_at) FROM club_feed_posts p WHERE p.club_id = c.id),
           (SELECT MAX(m.created_at) FROM club_messages m WHERE m.club_id = c.id),
           (SELECT MAX(t.saved_at) FROM task_completion_records t WHERE t.club_id = c.id AND t.is_completed),
           (SELECT MAX(sc.joined_at) FROM student_clubs sc WHERE sc.club_id = c.id AND sc.is_active = true)
         ) AS last_activity
       FROM clubs c
       WHERE ${where}
       ORDER BY c.name`,
      values
    );
    res.json({
      clubs: rows.map(r => ({
        id: r.id, name: r.name, category: r.category,
        facultyAdvisor: r.fa_names, studentCoordinator: r.sc_names, members: r.members,
        eventsConducted: r.events_conducted, eventsUpcoming: r.events_upcoming, participants: r.participants,
        reportsGenerated: r.reports_generated, reportsSubmitted: r.reports_submitted,
        lastActivity: r.last_activity,
      })),
    });
  } catch (err) { next(err); }
};

const ROLE_ORDER = { fa: 0, sc: 1, member: 2 };

/* ── GET /api/activity-monitor/clubs/:clubId ── everyone in one club (its Faculty
   Advisors, Student Coordinators and members) with their activity across the
   portal and what they have contributed to this club, plus the club's events. */
const getClubPeople = async (req, res, next) => {
  try {
    await ensureSoacTables();
    await syncPastEvents();
    const clubId = parseInt(req.params.clubId, 10);
    if (isNaN(clubId)) return res.status(400).json({ message: 'Invalid club id.' });

    const { rows: [club] } = await pgPool.query(
      `SELECT c.id::text AS id, c.name, c.category, c.campus FROM clubs c WHERE c.id = $1`, [clubId]
    );
    if (!club) return res.status(404).json({ message: 'Club not found.' });

    /* The club's events, as a subquery over parameter $2 (the club id) */
    const CLUB_EVENTS = `SELECT e.id FROM events e JOIN clubs c ON c.id = $2::bigint
                         WHERE e.is_active = true AND ${CLUB_EVENT_MATCH('e', 'c')}`;

    const [peopleRes, eventsRes] = await Promise.all([
      /* Staff come from the assignments table and the legacy users.managed_club_id;
         if someone appears twice, the higher role wins. */
      pgPool.query(
        `SELECT DISTINCT ON (p.user_id) p.user_id AS id, u.name, u.email, p.kind, p.since
         FROM (
           SELECT user_id, 'member' AS kind, joined_at AS since, 3 AS prio
             FROM student_clubs WHERE club_id = $1 AND is_active = true
           UNION ALL
           SELECT cca.user_id, CASE WHEN u2.role = 'faculty_coordinator' THEN 'fa' ELSE 'sc' END,
                  cca.created_at, CASE WHEN u2.role = 'faculty_coordinator' THEN 1 ELSE 2 END
             FROM coordinator_club_assignments cca JOIN users u2 ON u2.id = cca.user_id
            WHERE cca.club_id = $1 AND cca.is_active = true AND u2.role IN ('coordinator', 'faculty_coordinator')
           UNION ALL
           SELECT id, CASE WHEN role = 'faculty_coordinator' THEN 'fa' ELSE 'sc' END,
                  NULL::timestamptz, CASE WHEN role = 'faculty_coordinator' THEN 1 ELSE 2 END
             FROM users WHERE managed_club_id = $1 AND role IN ('coordinator', 'faculty_coordinator')
         ) p
         JOIN users u ON u.id = p.user_id AND u.is_active = true
         ORDER BY p.user_id, p.prio`,
        [clubId]
      ),
      pgPool.query(
        `SELECT e.id::text AS id, e.title, e.start_date, e.date, e.status, e.is_report_only,
                (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id = e.id)::int AS registrations,
                (SELECT COUNT(DISTINCT COALESCE(r.user_id::text, 'r' || r.registration_id::text))
                   FROM event_attendance_records r JOIN event_attendance_sessions s ON s.id = r.session_id
                  WHERE s.event_id = e.id AND r.status = 'present')::int AS attended,
                (SELECT COUNT(*) FROM event_volunteers v WHERE v.event_id = e.id)::int AS volunteers,
                (SELECT CASE WHEN rp.submitted_at IS NOT NULL THEN 'submitted' ELSE 'draft' END
                   FROM event_reports rp WHERE rp.event_id = e.id) AS report_status
         FROM events e JOIN clubs c ON c.id = $1
         WHERE e.is_active = true AND ${CLUB_EVENT_MATCH('e', 'c')}
         ORDER BY e.start_date DESC NULLS LAST, e.id DESC`,
        [clubId]
      ),
    ]);

    const ids = peopleRes.rows.map(r => r.id);
    const metrics = new Map();
    if (ids.length) {
      const [profileRes, clubCountRes, registeredRes, attendedRes, contribRes, lastRes] = await Promise.all([
        pgPool.query(
          `SELECT u.id AS user_id,
                  REPLACE(UPPER(COALESCE(NULLIF(TRIM(jr.dept), ''), '')), 'AI.ML', 'AI/ML') AS dept,
                  COALESCE(jr.year, '') AS year, COALESCE(jr.enrollment_no, '') AS enrollment_no
           FROM users u
           LEFT JOIN LATERAL (
             SELECT dept, year, enrollment_no FROM join_requests
             WHERE LOWER(email) = LOWER(u.email)
             ORDER BY (club_id = $2) DESC, (status = 'approved') DESC, updated_at DESC LIMIT 1
           ) jr ON true
           WHERE u.id = ANY($1::int[])`,
          [ids, clubId]
        ),
        pgPool.query(
          `SELECT u.id AS user_id,
                  (SELECT COUNT(*) FROM student_clubs sc JOIN clubs c ON c.id = sc.club_id AND c.is_active = true
                    WHERE sc.user_id = u.id AND sc.is_active = true)::int AS member_of,
                  (SELECT COUNT(DISTINCT x.club_id) FROM (
                     SELECT club_id FROM coordinator_club_assignments WHERE user_id = u.id AND is_active = true
                     UNION SELECT managed_club_id FROM users WHERE id = u.id AND managed_club_id IS NOT NULL
                       AND role IN ('coordinator', 'faculty_coordinator')
                   ) x JOIN clubs c ON c.id = x.club_id AND c.is_active = true)::int AS coordinates
           FROM users u WHERE u.id = ANY($1::int[])`,
          [ids]
        ),
        pgPool.query(REGISTERED_EVENTS_SQL, [ids]),
        pgPool.query(ATTENDED_EVENTS_SQL, [ids]),
        pgPool.query(
          `SELECT u.id AS user_id,
                  (SELECT COUNT(*) FROM club_attendance_sessions s WHERE s.club_id = $2)::int AS total_sessions,
                  (SELECT COUNT(*) FROM club_attendance_records r JOIN club_attendance_sessions s ON s.id = r.session_id
                    WHERE s.club_id = $2 AND r.user_id = u.id AND r.status IN ('present', 'late'))::int AS sessions_attended,
                  (SELECT COUNT(*) FROM task_completion_records t
                    WHERE t.club_id = $2 AND t.user_id = u.id AND t.is_completed)::int AS tasks_done,
                  (SELECT COUNT(*) FROM club_feed_posts p
                    WHERE p.club_id = $2 AND p.student_id = u.id AND p.status = 'approved')::int AS posts,
                  (SELECT COUNT(*) FROM club_messages m WHERE m.club_id = $2 AND m.user_id = u.id)::int AS messages,
                  (SELECT COUNT(DISTINCT v.event_id) FROM event_volunteers v
                    WHERE v.event_id IN (${CLUB_EVENTS}) AND (v.user_id = u.id OR LOWER(v.email) = LOWER(u.email)))::int AS volunteered,
                  (SELECT COUNT(*) FROM event_requests q WHERE q.club_id = $2 AND q.coordinator_id = u.id)::int AS events_proposed,
                  (SELECT COUNT(*) FROM event_requests q
                    WHERE q.club_id = $2 AND q.coordinator_id = u.id AND q.status = 'approved')::int AS events_approved,
                  (SELECT COUNT(*) FROM club_attendance_sessions s WHERE s.club_id = $2 AND s.created_by = u.id)::int AS sessions_held,
                  (SELECT COUNT(*) FROM event_reports r WHERE r.club_id = $2 AND r.created_by = u.id)::int AS reports_made,
                  (SELECT COUNT(*) FROM event_reports r WHERE r.club_id = $2 AND r.submitted_by = u.id)::int AS reports_submitted,
                  (SELECT COUNT(*) FROM club_announcements a
                    WHERE a.club_id = $2 AND a.author_id = u.id AND a.is_active = true)::int AS announcements,
                  (SELECT COUNT(*) FROM club_tasks t WHERE t.club_id = $2 AND t.created_by = u.id)::int AS tasks_assigned,
                  (SELECT l.role_title FROM club_leadership l
                    WHERE l.club_id = $2 AND l.user_id = u.id ORDER BY l.sort_order LIMIT 1) AS leadership_role
           FROM users u WHERE u.id = ANY($1::int[])`,
          [ids, clubId]
        ),
        /* The most recent thing each person did in this club */
        pgPool.query(
          `SELECT user_id, MAX(at) AS last_at FROM (
             SELECT u.id AS user_id, er.registered_at AS at
               FROM users u JOIN event_registrations er ON LOWER(er.email) = LOWER(u.email)
              WHERE u.id = ANY($1::int[]) AND er.event_id IN (${CLUB_EVENTS})
             UNION ALL
             SELECT r.user_id, s.session_date::timestamptz
               FROM event_attendance_records r JOIN event_attendance_sessions s ON s.id = r.session_id
              WHERE r.user_id = ANY($1::int[]) AND r.status = 'present' AND s.event_id IN (${CLUB_EVENTS})
             UNION ALL
             SELECT u.id, v.created_at
               FROM users u JOIN event_volunteers v ON v.user_id = u.id OR LOWER(v.email) = LOWER(u.email)
              WHERE u.id = ANY($1::int[]) AND v.event_id IN (${CLUB_EVENTS})
             UNION ALL
             SELECT r.user_id, s.session_date::timestamptz
               FROM club_attendance_records r JOIN club_attendance_sessions s ON s.id = r.session_id
              WHERE s.club_id = $2 AND r.user_id = ANY($1::int[]) AND r.status IN ('present', 'late')
             UNION ALL
             SELECT user_id, saved_at FROM task_completion_records
              WHERE club_id = $2 AND user_id = ANY($1::int[]) AND is_completed
             UNION ALL
             SELECT student_id, created_at FROM club_feed_posts WHERE club_id = $2 AND student_id = ANY($1::int[])
             UNION ALL
             SELECT user_id, created_at FROM club_messages WHERE club_id = $2 AND user_id = ANY($1::int[])
             UNION ALL
             SELECT coordinator_id, created_at FROM event_requests WHERE club_id = $2 AND coordinator_id = ANY($1::int[])
             UNION ALL
             SELECT created_by, created_at FROM club_attendance_sessions WHERE club_id = $2 AND created_by = ANY($1::int[])
             UNION ALL
             SELECT created_by::int, updated_at FROM event_reports WHERE club_id = $2 AND created_by::int = ANY($1::int[])
             UNION ALL
             SELECT submitted_by::int, submitted_at FROM event_reports WHERE club_id = $2 AND submitted_by::int = ANY($1::int[])
             UNION ALL
             SELECT author_id, created_at FROM club_announcements WHERE club_id = $2 AND author_id = ANY($1::int[])
             UNION ALL
             SELECT created_by, created_at FROM club_tasks WHERE club_id = $2 AND created_by = ANY($1::int[])
           ) x WHERE at IS NOT NULL AND at <= NOW()
           GROUP BY user_id`,
          [ids, clubId]
        ),
      ]);

      const clubEvents = new Set(eventsRes.rows.map(r => r.id));
      ids.forEach(id => metrics.set(id, {
        dept: '', year: '', enrollmentNo: '', clubsCount: 0,
        events: { participated: 0, attended: 0, inClub: 0 },
        contribution: {}, role: '', lastActiveAt: null,
      }));
      profileRes.rows.forEach(r => Object.assign(metrics.get(r.user_id), { dept: r.dept, year: r.year, enrollmentNo: r.enrollment_no }));
      clubCountRes.rows.forEach(r => { metrics.get(r.user_id).clubsCount = r.member_of + r.coordinates; });
      mergeMemberEvents(registeredRes.rows, attendedRes.rows).forEach((events, userId) => {
        const ev = metrics.get(userId)?.events; if (!ev) return;
        events.forEach(e => {
          ev.participated += 1;
          if (e.presentSessions > 0) ev.attended += 1;
          if (clubEvents.has(e.eventId)) ev.inClub += 1;
        });
      });
      contribRes.rows.forEach(r => {
        const m = metrics.get(r.user_id);
        m.role = r.leadership_role || '';
        m.contribution = {
          sessionsAttended: r.sessions_attended, totalSessions: r.total_sessions,
          attendancePct: r.total_sessions > 0 ? Math.round((r.sessions_attended / r.total_sessions) * 100) : null,
          tasksCompleted: r.tasks_done, posts: r.posts, messages: r.messages, volunteered: r.volunteered,
          eventsProposed: r.events_proposed, eventsApproved: r.events_approved, sessionsHeld: r.sessions_held,
          reportsMade: r.reports_made, reportsSubmitted: r.reports_submitted,
          announcements: r.announcements, tasksAssigned: r.tasks_assigned,
        };
      });
      lastRes.rows.forEach(r => { const m = metrics.get(r.user_id); if (m) m.lastActiveAt = r.last_at; });
    }

    const people = peopleRes.rows
      .map(r => ({ id: r.id, name: r.name, email: r.email, kind: r.kind, since: r.since, ...metrics.get(r.id) }))
      .sort((x, y) => (ROLE_ORDER[x.kind] - ROLE_ORDER[y.kind]) || x.name.localeCompare(y.name));

    res.json({
      club: { id: club.id, name: club.name, category: club.category, campus: club.campus },
      people,
      events: eventsRes.rows.map(r => ({
        id: r.id, title: r.title, date: r.start_date, dateLabel: r.date, status: r.status,
        isReportOnly: r.is_report_only, registrations: r.registrations, attended: r.attended,
        volunteers: r.volunteers, reportStatus: r.report_status || 'none',
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
    /* Coordinators of the campus: assigned to one of its clubs (those with no
       club at all are listed under Main Campus); only its clubs are shown. */
    const values = [campusOf(req)];
    const where  = [
      `u.role = 'coordinator'`, `u.is_active = true`,
      `(EXISTS (SELECT 1 FROM assigned a3 JOIN clubs c3 ON c3.id = a3.club_id WHERE a3.user_id = u.id AND c3.campus = $1)
        OR ($1 = '${MAIN_CAMPUS}' AND NOT EXISTS (SELECT 1 FROM assigned a4 WHERE a4.user_id = u.id)))`,
    ];
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
       LEFT JOIN clubs c ON c.id = a.club_id AND c.is_active = true AND c.campus = $1
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

module.exports = { getFilters, getSummary, getMembers, getMemberDetail, getClubs, getClubPeople, getCoordinators };
