const { pgPool } = require('../config/db');
const { getCoordClubIds } = require('../services/coordAuth');

/* Attendance for a specific EVENT (possibly spanning several days), scoped to
   every active member of the club that organized it — distinct from
   club_attendance_sessions/records in clubDetail.controller.js, which track
   general club-meeting attendance, not a specific event. */
(async () => {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS event_attendance_sessions (
        id            BIGSERIAL     PRIMARY KEY,
        event_id      BIGINT        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        session_date  DATE          NOT NULL,
        session_label VARCHAR(255)  NOT NULL DEFAULT '',
        created_by    INTEGER       REFERENCES users(id),
        created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        UNIQUE (event_id, session_date)
      )
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS event_attendance_records (
        id          BIGSERIAL     PRIMARY KEY,
        session_id  BIGINT        NOT NULL REFERENCES event_attendance_sessions(id) ON DELETE CASCADE,
        user_id     INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_name   VARCHAR(255)  NOT NULL DEFAULT '',
        status      VARCHAR(20)   NOT NULL DEFAULT 'present',
        updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        UNIQUE (session_id, user_id)
      )
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_ev_attend_sess_event   ON event_attendance_sessions(event_id)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_ev_attend_rec_session ON event_attendance_records(session_id)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_ev_attend_rec_user    ON event_attendance_records(user_id)`);
    console.log('[eventAttendance] migrations ready');
  } catch (err) {
    console.error('[eventAttendance] migration failed:', err.message);
  }
})();

/* Verify this coordinator (or admin) has access to the event — mirrors
   certificates.controller.js / eventTeams.controller.js's checkAccess. */
const checkAccess = async (req, res) => {
  if (req.user.role === 'admin') return true;
  const coordClubIds = await getCoordClubIds(req.user.id);
  if (!coordClubIds.length) {
    res.status(403).json({ message: 'No club assigned to your account.' });
    return false;
  }
  const { rows } = await pgPool.query(
    `SELECT id FROM events WHERE id = $1 AND is_active = true AND club_id = ANY($2::bigint[])`,
    [req.params.id, coordClubIds]
  );
  if (!rows.length) {
    res.status(403).json({ message: 'You do not have access to this event.' });
    return false;
  }
  return true;
};

/* GET /api/events/:id/attendance
   Returns every active club member (the roster to record against), every
   attendance day declared for this event so far, and the recorded status
   for each (member, day) pair — the frontend renders this as a grid. */
const getAttendance = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;

    const { rows: evRows } = await pgPool.query(
      `SELECT id, club_id, title FROM events WHERE id = $1`, [req.params.id]
    );
    if (!evRows.length) return res.status(404).json({ message: 'Event not found.' });
    const clubId = evRows[0].club_id;
    if (!clubId) return res.json({ members: [], sessions: [], records: [] });

    const [{ rows: members }, { rows: sessions }, { rows: records }] = await Promise.all([
      pgPool.query(
        `SELECT u.id, u.name, u.email
         FROM student_clubs sc
         JOIN users u ON u.id = sc.user_id AND u.is_active = true
         WHERE sc.club_id = $1 AND sc.is_active = true
         ORDER BY u.name`,
        [clubId]
      ),
      pgPool.query(
        `SELECT id, session_date, session_label, created_at
         FROM event_attendance_sessions
         WHERE event_id = $1
         ORDER BY session_date ASC`,
        [req.params.id]
      ),
      pgPool.query(
        `SELECT r.session_id, r.user_id, r.status
         FROM event_attendance_records r
         JOIN event_attendance_sessions s ON s.id = r.session_id
         WHERE s.event_id = $1`,
        [req.params.id]
      ),
    ]);

    res.json({ members, sessions, records });
  } catch (err) { next(err); }
};

/* POST /api/events/:id/attendance/sessions  { date, label }
   Adds (or renames, if the date already exists) one attendance day. */
const createSession = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const { date, label } = req.body;
    if (!date) return res.status(400).json({ message: 'date is required.' });

    const { rows } = await pgPool.query(
      `INSERT INTO event_attendance_sessions (event_id, session_date, session_label, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id, session_date) DO UPDATE SET session_label = EXCLUDED.session_label
       RETURNING id, session_date, session_label, created_at`,
      [req.params.id, date, (label || '').trim(), req.user.id]
    );
    res.status(201).json({ session: rows[0] });
  } catch (err) { next(err); }
};

/* DELETE /api/events/:id/attendance/sessions/:sessionId */
const deleteSession = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const { rowCount } = await pgPool.query(
      `DELETE FROM event_attendance_sessions WHERE id = $1 AND event_id = $2`,
      [req.params.sessionId, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ message: 'Session not found.' });
    res.json({ message: 'Attendance day removed.' });
  } catch (err) { next(err); }
};

/* PATCH /api/events/:id/attendance/sessions/:sessionId
   body: { records: [{ userId, userName, status: 'present'|'absent' }] }
   Bulk-upserts every listed member's status for this day in one statement. */
const recordAttendance = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const { records = [] } = req.body;
    const clean = records.filter(r => r.userId && ['present', 'absent'].includes(r.status));
    if (!clean.length) return res.status(400).json({ message: 'records array is required.' });

    const { rows: sessRows } = await pgPool.query(
      `SELECT id FROM event_attendance_sessions WHERE id = $1 AND event_id = $2`,
      [req.params.sessionId, req.params.id]
    );
    if (!sessRows.length) return res.status(404).json({ message: 'Attendance day not found.' });

    await pgPool.query(
      `INSERT INTO event_attendance_records (session_id, user_id, user_name, status)
       SELECT $1, unnest($2::int[]), unnest($3::text[]), unnest($4::text[])
       ON CONFLICT (session_id, user_id) DO UPDATE
         SET status = EXCLUDED.status, user_name = EXCLUDED.user_name, updated_at = NOW()`,
      [
        req.params.sessionId,
        clean.map(r => r.userId),
        clean.map(r => r.userName || ''),
        clean.map(r => r.status),
      ]
    );
    res.json({ message: 'Attendance saved.' });
  } catch (err) { next(err); }
};

module.exports = { getAttendance, createSession, deleteSession, recordAttendance };
