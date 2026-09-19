/**
 * Club detail endpoints — leadership, chat, tasks, membership.
 * All routes are under /api/clubs/:id/…
 */
const { pgPool } = require('../config/db');
const { ensureSoacTables } = require('../services/soacData');
const { getFileValue } = require('../config/multer');
const bracketEngine = require('../services/bracketEngine');
const { autoRefreshReportIfExists } = require('./reports.controller');
const { notifyUser, notifyManyUsers } = require('../services/notify');

/* ── GET /api/clubs/:id/membership  (authenticated) ────────────────────── */
const getMembership = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT sc.id, sc.club_id, sc.club_name, sc.joined_at
       FROM student_clubs sc
       WHERE sc.user_id = $1 AND sc.club_id = $2::bigint`,
      [req.user.id, req.params.id]
    );
    res.json({ isMember: rows.length > 0, membership: rows[0] || null });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════════════════════════════════
   LEADERSHIP
══════════════════════════════════════════════════════════════════════════ */

/* GET /api/clubs/:id/leadership  (public) */
const getLeadership = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { rows } = await pgPool.query(
      `SELECT id, role_title, holder_name, holder_email, phone, responsibilities, photo_url, user_id, sort_order, updated_at
       FROM club_leadership
       WHERE club_id = $1::bigint
       ORDER BY sort_order ASC, id ASC`,
      [req.params.id]
    );
    res.json({ leadership: rows });
  } catch (err) { next(err); }
};

/* PUT /api/clubs/:id/leadership  (coordinator/admin) — full replace
   Accepts multipart/form-data:
     positions  — JSON string of position objects
     photo_<i>  — optional image file for position at index i             */
const setLeadership = async (req, res, next) => {
  try {
    await ensureSoacTables();   // guarantees phone column exists before INSERT
    let positions;
    try {
      // When sent as multipart, positions arrives as a JSON string in req.body
      const raw = req.body.positions;
      positions = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return res.status(400).json({ message: 'positions must be a valid JSON array.' });
    }
    if (!Array.isArray(positions)) {
      return res.status(400).json({ message: 'positions must be an array.' });
    }

    // Index uploaded photos by their field name (photo_0, photo_1, …)
    const photosByIndex = {};
    (req.files || []).forEach(f => {
      const m = f.fieldname.match(/^photo_(\d+)$/);
      if (m) photosByIndex[parseInt(m[1], 10)] = getFileValue(f);
    });

    const clubId = req.params.id;
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM club_leadership WHERE club_id = $1::bigint`, [clubId]);
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        if (!p.role_title?.trim()) continue;
        // Prefer newly uploaded photo; fall back to existing URL sent from client
        const photoUrl = photosByIndex[i] ?? (p.photo_url || '');
        await client.query(
          `INSERT INTO club_leadership
             (club_id, role_title, holder_name, holder_email, phone, responsibilities, photo_url, user_id, sort_order)
           VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            clubId,
            p.role_title.trim(),
            (p.holder_name      || '').trim(),
            (p.holder_email     || '').trim(),
            (p.phone            || '').trim(),
            (p.responsibilities || '').trim(),
            photoUrl,
            p.user_id || null,
            i,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    const { rows } = await pgPool.query(
      `SELECT id, role_title, holder_name, holder_email, phone, responsibilities, photo_url, user_id, sort_order, updated_at
       FROM club_leadership WHERE club_id = $1::bigint ORDER BY sort_order ASC, id ASC`,
      [clubId]
    );
    res.json({ leadership: rows });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════════════════════════════════
   CHAT MESSAGES
══════════════════════════════════════════════════════════════════════════ */

/* GET /api/clubs/:id/messages  (authenticated members / coord / admin)
   ?limit=60          — initial page
   ?after=<id>        — poll: messages with id > after  (real-time)
   ?before=<id>       — scroll up: messages with id < before */
const getMessages = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const clubId = req.params.id;
    const limit  = Math.min(100, parseInt(req.query.limit, 10) || 60);
    const { after, before } = req.query;

    /* Any authenticated user can read messages */

    const values = [clubId];
    let whereExtra = '';

    if (after) {
      values.push(after);
      whereExtra = ` AND cm.id > $${values.length}::bigint`;
    } else if (before) {
      values.push(before);
      whereExtra = ` AND cm.id < $${values.length}::bigint`;
    }
    values.push(limit);

    const { rows } = await pgPool.query(
      `SELECT cm.id, cm.user_id, cm.user_name, cm.user_avatar, cm.content, cm.created_at,
              u.role AS user_role
       FROM club_messages cm
       LEFT JOIN users u ON u.id = cm.user_id
       WHERE cm.club_id = $1::bigint${whereExtra}
       ORDER BY ${after ? 'cm.created_at ASC' : 'cm.created_at DESC'}
       LIMIT $${values.length}`,
      values
    );

    /* Initial / before: return chronological (oldest first for display) */
    res.json({ messages: after ? rows : rows.reverse() });
  } catch (err) { next(err); }
};

/* POST /api/clubs/:id/messages  (authenticated members / coord / admin) */
const postMessage = async (req, res, next) => {
  try {
    let { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ message: 'Message is required.' });

    /* Sanitise: strip null bytes, normalise line endings */
    content = content.replace(/\0/g, '').replace(/\r\n|\r/g, '\n').trim();
    if (!content) return res.status(400).json({ message: 'Message is required.' });
    if (content.length > 2000) return res.status(400).json({ message: 'Message too long (max 2000 chars).' });

    const clubId = req.params.id;

    /* Any authenticated user can post messages */

    /* Fetch avatar from users table (not in JWT payload) */
    const { rows: ur } = await pgPool.query(`SELECT avatar FROM users WHERE id = $1`, [req.user.id]);
    const avatar = ur[0]?.avatar || '';

    const { rows } = await pgPool.query(
      `INSERT INTO club_messages (club_id, user_id, user_name, user_avatar, content)
       VALUES ($1::bigint, $2, $3, $4, $5)
       RETURNING id, user_id, user_name, user_avatar, content, created_at`,
      [clubId, req.user.id, req.user.name, avatar, content.trim()]
    );
    res.status(201).json({ message: rows[0] });

    /* Notify every other active member of this club — fire-and-forget, after the
       response is already sent so a slow fan-out never delays the sender's own UI. */
    pgPool.query(
      `SELECT u.id FROM student_clubs sc
       JOIN users u ON u.id = sc.user_id AND u.is_active = true
       WHERE sc.club_id = $1::bigint AND sc.is_active = true AND u.id != $2`,
      [clubId, req.user.id]
    ).then(({ rows: members }) => {
      if (!members.length) return;
      notifyManyUsers({
        userIds: members.map(m => m.id),
        clubId,
        title: req.user.name,
        body:  content.trim().slice(0, 120),
        type:  'message',
        url:   `/student/clubs/${clubId}`,
      });
    }).catch(() => {});
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════════════════════════════════
   TASKS
══════════════════════════════════════════════════════════════════════════ */

/* GET /api/clubs/:id/tasks  (authenticated members / coord / admin) */
const getTasks = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { rows } = await pgPool.query(
      `SELECT id, title, description, status, priority, due_date,
              is_deleted, deleted_at, created_by_name, created_at, updated_at
       FROM club_tasks
       WHERE club_id = $1::bigint
       ORDER BY
         CASE WHEN is_deleted THEN 1 ELSE 0 END,
         CASE status   WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
         CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         created_at DESC`,
      [req.params.id]
    );
    res.json({ tasks: rows });
  } catch (err) { next(err); }
};

/* POST /api/clubs/:id/tasks  (coordinator / admin) */
const createTask = async (req, res, next) => {
  try {
    const { title, description, priority, due_date } = req.body;
    if (!title?.trim()) return res.status(400).json({ message: 'Task title is required.' });

    const { rows } = await pgPool.query(
      `INSERT INTO club_tasks
         (club_id, title, description, priority, due_date, created_by, created_by_name)
       VALUES ($1::bigint, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, description, status, priority, due_date,
                 is_deleted, deleted_at, created_by_name, created_at, updated_at`,
      [req.params.id, title.trim(), (description||'').trim(),
       priority || 'medium', due_date || null, req.user.id, req.user.name]
    );
    res.status(201).json({ task: rows[0] });
  } catch (err) { next(err); }
};

/* PATCH /api/clubs/:id/tasks/:taskId  (coordinator / admin) */
const updateTask = async (req, res, next) => {
  try {
    /* Archived tasks cannot be edited */
    const { rows: check } = await pgPool.query(
      `SELECT is_deleted FROM club_tasks WHERE id = $1::bigint AND club_id = $2::bigint`,
      [req.params.taskId, req.params.id]
    );
    if (!check.length) return res.status(404).json({ message: 'Task not found.' });
    if (check[0].is_deleted) return res.status(403).json({ message: 'Cannot edit an archived task.' });

    const { title, description, status, priority, due_date } = req.body;
    const { rows } = await pgPool.query(
      `UPDATE club_tasks
       SET title       = COALESCE($1, title),
           description = COALESCE($2, description),
           status      = COALESCE($3, status),
           priority    = COALESCE($4, priority),
           due_date    = CASE WHEN $5::text IS NOT NULL THEN $5::date ELSE due_date END,
           updated_at  = NOW()
       WHERE id = $6::bigint AND club_id = $7::bigint
       RETURNING id, title, description, status, priority, due_date,
                 is_deleted, deleted_at, created_by_name, created_at, updated_at`,
      [title?.trim() || null, description?.trim() || null, status || null, priority || null,
       due_date != null ? String(due_date) : null, req.params.taskId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Task not found.' });
    res.json({ task: rows[0] });
  } catch (err) { next(err); }
};

/* DELETE /api/clubs/:id/tasks/:taskId  — soft-archive; records are preserved */
const deleteTask = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `UPDATE club_tasks
       SET is_deleted = true, deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1::bigint AND club_id = $2::bigint AND is_deleted = false
       RETURNING id`,
      [req.params.taskId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Task not found or already archived.' });
    res.json({ message: 'Task archived. Completion records have been preserved.' });
  } catch (err) { next(err); }
};

/* GET /api/clubs/:id/tasks/:taskId/completions */
const getTaskCompletions = async (req, res, next) => {
  try {
    const { taskId, id: clubId } = req.params;
    const { rows: taskRows } = await pgPool.query(
      `SELECT id, title, is_deleted FROM club_tasks WHERE id = $1::bigint AND club_id = $2::bigint`,
      [taskId, clubId]
    );
    if (!taskRows.length) return res.status(404).json({ message: 'Task not found.' });

    /* All active club members */
    const { rows: members } = await pgPool.query(
      `SELECT sc.user_id, u.name AS user_name
       FROM student_clubs sc
       JOIN users u ON u.id = sc.user_id
       WHERE sc.club_id = $1::bigint AND u.is_active = true
       ORDER BY u.name`,
      [clubId]
    );

    /* Existing completions */
    const { rows: saved } = await pgPool.query(
      `SELECT user_id, is_completed FROM task_completion_records WHERE task_id = $1::bigint`,
      [taskId]
    );
    const savedMap = Object.fromEntries(saved.map(r => [String(r.user_id), r]));

    res.json({
      task: { id: String(taskRows[0].id), title: taskRows[0].title, isDeleted: taskRows[0].is_deleted },
      members: members.map(m => ({
        userId:       String(m.user_id),
        userName:     m.user_name,
        isCompleted:  savedMap[String(m.user_id)]?.is_completed  ?? false,
      })),
      alreadySaved: saved.length > 0,
    });
  } catch (err) { next(err); }
};

/* POST /api/clubs/:id/tasks/:taskId/completions
   Body: { completions: [{ userId, userName, isCompleted }] }
   Blocked if task is archived. */
const saveTaskCompletions = async (req, res, next) => {
  try {
    const { taskId, id: clubId } = req.params;
    const { completions = [] } = req.body;

    const { rows: taskRows } = await pgPool.query(
      `SELECT id, title, is_deleted FROM club_tasks WHERE id = $1::bigint AND club_id = $2::bigint`,
      [taskId, clubId]
    );
    if (!taskRows.length) return res.status(404).json({ message: 'Task not found.' });
    if (taskRows[0].is_deleted)
      return res.status(403).json({ message: 'Cannot modify completions for an archived task.' });
    const taskTitle = taskRows[0].title;

    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');

      for (const c of completions) {
        if (!c.userId) continue;
        const isCompleted = !!c.isCompleted;

        /* Upsert completion record */
        await client.query(
          `INSERT INTO task_completion_records
             (task_id, club_id, user_id, user_name, task_title, is_completed, saved_at)
           VALUES ($1::bigint, $2::bigint, $3::int, $4, $5, $6, NOW())
           ON CONFLICT (task_id, user_id) DO UPDATE
             SET is_completed = EXCLUDED.is_completed,
                 saved_at     = NOW()`,
          [taskId, clubId, c.userId, c.userName || '', taskTitle, isCompleted]
        );

      }

      await client.query('COMMIT');
      res.json({ message: 'Completions saved.' });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════════════════════════════════
   OVERVIEW (coordinator self-service update)
══════════════════════════════════════════════════════════════════════════ */

/* PATCH /api/clubs/:id/overview  (coordinator/admin)
   Allows coordinator to update description, vision, schedule, rules, tags. */
const updateOverview = async (req, res, next) => {
  try {
    const { description, vision, schedule, rules, tags } = req.body;
    const { rows } = await pgPool.query(
      `UPDATE clubs
       SET description = COALESCE($1, description),
           vision      = COALESCE($2, vision),
           schedule    = COALESCE($3, schedule),
           rules       = COALESCE($4::text[], rules),
           tags        = COALESCE($5::text[], tags),
           updated_at  = NOW()
       WHERE id = $6::bigint
       RETURNING id, name, description, vision, schedule, rules, tags, updated_at`,
      [
        description ?? null,
        vision      ?? null,
        schedule    ?? null,
        rules  ? (Array.isArray(rules)  ? rules  : JSON.parse(rules))  : null,
        tags   ? (Array.isArray(tags)   ? tags   : JSON.parse(tags))   : null,
        req.params.id,
      ]
    );
    if (!rows.length) return res.status(404).json({ message: 'Club not found.' });
    res.json({ club: rows[0] });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════════════════════════════════
   ATTENDANCE
══════════════════════════════════════════════════════════════════════════ */

/* GET /api/clubs/:id/attendance  — list sessions (newest first) */
const getAttendance = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const clubId = req.params.id;
    const { rows: sessions } = await pgPool.query(
      `SELECT s.id, s.session_date, s.session_label, s.created_at,
              COUNT(r.id)::int                                         AS total,
              COUNT(r.id) FILTER (WHERE r.status = 'present')::int    AS present,
              COUNT(r.id) FILTER (WHERE r.status = 'absent')::int     AS absent,
              COUNT(r.id) FILTER (WHERE r.status = 'late')::int       AS late,
              COUNT(r.id) FILTER (WHERE r.status = 'excused')::int    AS excused
       FROM   club_attendance_sessions s
       LEFT JOIN club_attendance_records r ON r.session_id = s.id
       WHERE  s.club_id = $1::bigint
       GROUP  BY s.id
       ORDER  BY s.session_date DESC, s.created_at DESC`,
      [clubId]
    );
    res.json({ sessions });
  } catch (err) { next(err); }
};

/* GET /api/clubs/:id/attendance/:sessionId  — records for one session */
const getAttendanceSession = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT r.id, r.user_id, r.user_name, r.status, r.notes
       FROM club_attendance_records r
       WHERE r.session_id = $1::bigint
       ORDER BY r.user_name`,
      [req.params.sessionId]
    );
    res.json({ records: rows });
  } catch (err) { next(err); }
};

/* POST /api/clubs/:id/attendance  — create session + all records in one go
   Body: { session_date, session_label, records: [{ user_id, user_name, status, notes }] } */
const createAttendanceSession = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { session_date, session_label, records = [] } = req.body;
    if (!session_date) return res.status(400).json({ message: 'session_date is required.' });

    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [session] } = await client.query(
        `INSERT INTO club_attendance_sessions (club_id, session_date, session_label, created_by)
         VALUES ($1::bigint, $2::date, $3, $4) RETURNING id, session_date, session_label, created_at`,
        [req.params.id, session_date, session_label || '', req.user.id]
      );
      const clubId = req.params.id;
      for (const r of records) {
        if (!r.user_id) continue;
        const status = r.status || 'present';
        /* Store session_date + club_id on the record so it persists after session deletion */
        await client.query(
          `INSERT INTO club_attendance_records
             (session_id, user_id, user_name, status, notes, session_date, club_id)
           VALUES ($1, $2, $3, $4, $5, $6::date, $7::bigint)
           ON CONFLICT (session_id, user_id) DO UPDATE
             SET status       = EXCLUDED.status,
                 notes        = EXCLUDED.notes,
                 session_date = EXCLUDED.session_date,
                 club_id      = EXCLUDED.club_id`,
          [session.id, r.user_id, r.user_name || '', status, r.notes || '', session_date, clubId]
        );
      }
      await client.query('COMMIT');
      res.status(201).json({ session: { ...session, total: records.length } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
};

/* PATCH /api/clubs/:id/attendance/records/:recordId  — update a single record status */
const updateAttendanceRecord = async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const recordId  = req.params.recordId;

    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');

      // Fetch current record
      const { rows: existing } = await client.query(
        `SELECT id, user_id, user_name, status AS old_status
         FROM club_attendance_records WHERE id = $1::bigint`,
        [recordId]
      );
      if (!existing.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Record not found.' });
      }
      // Update the record
      const { rows } = await client.query(
        `UPDATE club_attendance_records
         SET status = COALESCE($1, status), notes = COALESCE($2, notes)
         WHERE id = $3::bigint RETURNING id, user_id, user_name, status, notes`,
        [status || null, notes ?? null, recordId]
      );

      await client.query('COMMIT');
      res.json({ record: rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
};

/* DELETE /api/clubs/:id/attendance/:sessionId
   Deletes the session header only — records are preserved (session_id set to NULL via FK)
   and are not affected. */
const deleteAttendanceSession = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `DELETE FROM club_attendance_sessions WHERE id = $1::bigint AND club_id = $2::bigint RETURNING id`,
      [req.params.sessionId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Session not found.' });
    res.json({ message: 'Session deleted. Attendance records have been preserved.' });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════════════════════════════════
   LIVE SCOREBOARD
══════════════════════════════════════════════════════════════════════════ */
const SUPPORTED_SPORTS = new Set(['cricket', 'basketball', 'football', 'volleyball', 'badminton']);
const DEFAULT_TIMER_SECONDS = {
  cricket: 120 * 60,
  basketball: 40 * 60,
  football: 90 * 60,
  volleyball: 20 * 60, // per SET, not the whole match — volleyball has no match clock
  badminton: 60 * 60,
};
const LIVE_SCORE_SELECT = `id, club_id, sport, match_title, home_team, opponent_name, venue, status,
              game_clock, team_score, opponent_score, score_data, stats, home_players, away_players,
              time_remaining_seconds, timer_running, timer_last_started_at,
              winner_name, fixture_id, event_id, division,
              started_at, ended_at, created_at, updated_at`;

const withTimerComputed = (row) => {
  const out = { ...row };
  let remaining = Number(out.time_remaining_seconds || 0);
  if (out.timer_running && out.timer_last_started_at) {
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(out.timer_last_started_at).getTime()) / 1000));
    remaining = Math.max(0, remaining - elapsed);
  }
  out.time_remaining_seconds = remaining;
  return out;
};

const mapLiveScore = (row) => ({
  id: String(row.id),
  clubId: String(row.club_id),
  sport: row.sport,
  matchTitle: row.match_title || '',
  homeTeam: row.home_team || '',
  opponentName: row.opponent_name || '',
  venue: row.venue || '',
  status: row.status,
  winnerName: row.winner_name || null,
  fixtureId: row.fixture_id ? String(row.fixture_id) : null,
  eventId: row.event_id ? String(row.event_id) : null,
  division: row.division || null,
  gameClock: row.game_clock || '',
  teamScore: Number(row.team_score || 0),
  opponentScore: Number(row.opponent_score || 0),
  scoreData: row.score_data || {},
  stats: row.stats || {},
  homePlayers: row.home_players || [],
  awayPlayers: row.away_players || [],
  timeRemainingSeconds: Number(row.time_remaining_seconds || 0),
  timerRunning: !!row.timer_running,
  timerLastStartedAt: row.timer_last_started_at || null,
  startedAt: row.started_at,
  endedAt: row.ended_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/* GET /api/clubs/:id/live-scores */
const getLiveScores = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { rows } = await pgPool.query(
      `SELECT ${LIVE_SCORE_SELECT}
       FROM club_live_scores
       WHERE club_id = $1::bigint
       ORDER BY updated_at DESC, created_at DESC`,
      [req.params.id]
    );
    res.json({ scores: rows.map(withTimerComputed).map(mapLiveScore) });
  } catch (err) { next(err); }
};

/* POST /api/clubs/:id/live-scores */
const createLiveScore = async (req, res, next) => {
  try {
    await ensureSoacTables();

    /* Only sports clubs may use the Live Scoreboard */
    const { rows: clubRows } = await pgPool.query(
      'SELECT category FROM clubs WHERE id = $1::bigint AND is_active = true',
      [req.params.id]
    );
    if (!clubRows.length || clubRows[0].category !== 'sports') {
      return res.status(403).json({ message: 'Live Scoreboard is only available for sports clubs.' });
    }

    const sport = String(req.body.sport || '').trim().toLowerCase();
    if (!SUPPORTED_SPORTS.has(sport)) {
      return res.status(400).json({ message: 'Invalid sport. Supported: cricket, basketball, football, volleyball, badminton.' });
    }

    /* Denormalize the source fixture's division onto the scoreboard, so the
       Match Control tab can filter Boys vs Girls without a join every time. */
    const fixtureId = req.body.fixtureId ? Number(req.body.fixtureId) : null;
    let division = null;
    if (fixtureId) {
      const { rows: fxRows } = await pgPool.query(`SELECT division FROM event_fixtures WHERE id = $1::bigint`, [fixtureId]);
      division = fxRows[0]?.division || null;
    }

    const { rows } = await pgPool.query(
      `INSERT INTO club_live_scores
         (club_id, sport, match_title, home_team, opponent_name, venue, game_clock,
          team_score, opponent_score, score_data, stats, home_players, away_players,
          time_remaining_seconds, status, created_by, updated_by, fixture_id, event_id, division)
       VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14, 'draft', $15, $15, $16, $17, $18)
       RETURNING ${LIVE_SCORE_SELECT}`,
      [
        req.params.id,
        sport,
        (req.body.matchTitle || '').trim(),
        (req.body.homeTeam || '').trim(),
        (req.body.opponentName || req.body.awayTeam || '').trim(),
        (req.body.venue || '').trim(),
        (req.body.gameClock || '').trim(),
        Number(req.body.teamScore) || 0,
        Number(req.body.opponentScore) || 0,
        JSON.stringify(req.body.scoreData || {}),
        JSON.stringify(req.body.stats || {}),
        JSON.stringify(req.body.homePlayers || []),
        JSON.stringify(req.body.awayPlayers || []),
        Math.max(0, Number(req.body.timeRemainingSeconds ?? DEFAULT_TIMER_SECONDS[sport]) || DEFAULT_TIMER_SECONDS[sport]),
        req.user.id,
        fixtureId,
        req.body.eventId   ? Number(req.body.eventId)   : null,
        division,
      ]
    );
    const score = mapLiveScore(withTimerComputed(rows[0]));
    emitScoreUpdate(req, rows[0].id, { score });
    res.status(201).json({ score });
  } catch (err) { next(err); }
};

/* PATCH /api/clubs/:id/live-scores/:scoreId */
const updateLiveScore = async (req, res, next) => {
  try {
    const updates = req.body || {};
    const sport = updates.sport ? String(updates.sport).trim().toLowerCase() : null;
    if (sport && !SUPPORTED_SPORTS.has(sport)) {
      return res.status(400).json({ message: 'Invalid sport.' });
    }

    const { rows } = await pgPool.query(
      `UPDATE club_live_scores
       SET sport          = COALESCE($1, sport),
           match_title    = COALESCE($2, match_title),
           opponent_name  = COALESCE($3, opponent_name),
           venue          = COALESCE($4, venue),
           game_clock     = COALESCE($5, game_clock),
           team_score     = COALESCE($6, team_score),
           opponent_score = COALESCE($7, opponent_score),
           score_data     = COALESCE($8::jsonb, score_data),
           stats          = COALESCE($9::jsonb, stats),
           home_players   = COALESCE($10::jsonb, home_players),
           away_players   = COALESCE($11::jsonb, away_players),
           time_remaining_seconds = COALESCE($12, time_remaining_seconds),
           home_team      = COALESCE($13, home_team),
           updated_by     = $14,
           updated_at     = NOW()
       WHERE id = $15::bigint AND club_id = $16::bigint
       RETURNING ${LIVE_SCORE_SELECT}`,
      [
        sport,
        updates.matchTitle !== undefined ? String(updates.matchTitle).trim() : null,
        updates.opponentName !== undefined ? String(updates.opponentName).trim() : null,
        updates.venue !== undefined ? String(updates.venue).trim() : null,
        updates.gameClock !== undefined ? String(updates.gameClock).trim() : null,
        updates.teamScore !== undefined ? Number(updates.teamScore) : null,
        updates.opponentScore !== undefined ? Number(updates.opponentScore) : null,
        updates.scoreData !== undefined ? JSON.stringify(updates.scoreData || {}) : null,
        updates.stats !== undefined ? JSON.stringify(updates.stats || {}) : null,
        updates.homePlayers !== undefined ? JSON.stringify(updates.homePlayers || []) : null,
        updates.awayPlayers !== undefined ? JSON.stringify(updates.awayPlayers || []) : null,
        updates.timeRemainingSeconds !== undefined ? Math.max(0, Number(updates.timeRemainingSeconds) || 0) : null,
        updates.homeTeam !== undefined ? String(updates.homeTeam).trim() : null,
        req.user.id,
        req.params.scoreId,
        req.params.id,
      ]
    );
    if (!rows.length) return res.status(404).json({ message: 'Scoreboard not found.' });
    const score = mapLiveScore(withTimerComputed(rows[0]));
    emitScoreUpdate(req, req.params.scoreId, { score });

    res.json({ score });
  } catch (err) { next(err); }
};

/* POST /api/clubs/:id/live-scores/:scoreId/start */
const startLiveScore = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `UPDATE club_live_scores
       SET status = 'live',
           started_at = COALESCE(started_at, NOW()),
           ended_at = NULL,
           timer_running = true,
           timer_last_started_at = NOW(),
           updated_by = $1,
           updated_at = NOW()
       WHERE id = $2::bigint AND club_id = $3::bigint
       RETURNING ${LIVE_SCORE_SELECT}`,
      [req.user.id, req.params.scoreId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Scoreboard not found.' });
    const score = mapLiveScore(withTimerComputed(rows[0]));
    emitScoreUpdate(req, req.params.scoreId, { score });
    res.json({ score });
  } catch (err) { next(err); }
};

/* POST /api/clubs/:id/live-scores/:scoreId/end */
const endLiveScore = async (req, res, next) => {
  try {
    const { rows: currentRows } = await pgPool.query(
      `SELECT ${LIVE_SCORE_SELECT}
       FROM club_live_scores
       WHERE id = $1::bigint AND club_id = $2::bigint`,
      [req.params.scoreId, req.params.id]
    );
    if (!currentRows.length) return res.status(404).json({ message: 'Scoreboard not found.' });
    const current = withTimerComputed(currentRows[0]);
    const winnerName = req.body.winnerName ? String(req.body.winnerName).trim() : null;
    const { rows } = await pgPool.query(
      `UPDATE club_live_scores
       SET status = 'ended',
           ended_at = NOW(),
           timer_running = false,
           timer_last_started_at = NULL,
           time_remaining_seconds = $1,
           winner_name = $2,
           updated_by = $3,
           updated_at = NOW()
       WHERE id = $4::bigint AND club_id = $5::bigint
       RETURNING ${LIVE_SCORE_SELECT}`,
      [current.time_remaining_seconds, winnerName, req.user.id, req.params.scoreId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Scoreboard not found.' });

    const { home: finalHomeScore, away: finalAwayScore } = computeFinalScore(current);

    /* Write winner back to event_fixtures and broadcast bracket update */
    if (winnerName) {
      const broadcastResult = (fixtureId, eventId) => {
        const io = req.app.get('io');
        if (io && eventId) {
          io.emit('bracket:result:updated', {
            eventId:   String(eventId),
            fixtureId: String(fixtureId),
            winner:    winnerName,
            teamA:     current.home_team     || '',
            teamB:     current.opponent_name || '',
          });
        }
        if (eventId) bracketEngine.advanceBracket({ eventId, io }).catch(() => {});
      };

      if (current.fixture_id) {
        /* Explicitly linked fixture — update winner + scores */
        pgPool.query(
          `UPDATE event_fixtures SET winner_name = $1, score_a = $2, score_b = $3 WHERE id = $4::bigint`,
          [winnerName, finalHomeScore, finalAwayScore, current.fixture_id]
        ).then(() => broadcastResult(current.fixture_id, current.event_id)).catch(() => {});
      } else if (current.home_team && current.opponent_name) {
        /* No fixture link — find by team names and write scores too */
        pgPool.query(
          `SELECT id, event_id FROM event_fixtures
           WHERE winner_name IS NULL AND team_a_name = $1 AND team_b_name = $2`,
          [current.home_team, current.opponent_name]
        ).then(({ rows: fx }) => {
          if (fx.length !== 1) return;
          return pgPool.query(
            `UPDATE event_fixtures SET winner_name = $1, score_a = $2, score_b = $3 WHERE id = $4::bigint`,
            [winnerName, finalHomeScore, finalAwayScore, fx[0].id]
          ).then(() => broadcastResult(fx[0].id, fx[0].event_id));
        }).catch(() => {});
      }
    }

    /* Auto-detect MVP: player with the highest score-impact across both rosters. For most
       sports that's just the single scoring stat; volleyball's PTS/ATK/BLK are all separate
       ways to win a rally, so the MVP is ranked by their combined total instead. */
    try {
      const sport       = current.sport || 'basketball';
      const scoreStat    = SPORT_SCORE_STAT[sport] || 'points';
      const impactStats  = MVP_IMPACT_STATS[sport] || [scoreStat];
      const impactOf     = (p) => impactStats.reduce((sum, k) => sum + Number(p.stats?.[k] ?? 0), 0);
      const allPlayers = [
        ...(current.home_players || []),
        ...(current.away_players || []),
      ].filter(p => p.name);
      if (allPlayers.length) {
        const mvp = allPlayers.reduce((best, p) => {
          const pv = impactOf(p);
          const bv = best ? impactOf(best) : -1;
          return pv > bv ? p : best;
        }, null);
        if (mvp) {
          const displayStats = buildMvpStats(sport, mvp.stats || {});
          await pgPool.query(
            `INSERT INTO match_mvp
               (score_id, club_id, event_id, player_name, stats,
                home_score, away_score, home_team, opponent_name, sport, match_title)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (score_id) DO UPDATE SET
               player_name   = EXCLUDED.player_name,
               stats         = EXCLUDED.stats,
               home_score    = EXCLUDED.home_score,
               away_score    = EXCLUDED.away_score,
               home_team     = EXCLUDED.home_team,
               opponent_name = EXCLUDED.opponent_name,
               sport         = EXCLUDED.sport,
               match_title   = EXCLUDED.match_title,
               event_id      = COALESCE(EXCLUDED.event_id, match_mvp.event_id),
               updated_at    = NOW()`,
            [
              req.params.scoreId, req.params.id, current.event_id,
              mvp.name, JSON.stringify(displayStats),
              finalHomeScore, finalAwayScore,
              rows[0].home_team || 'Home', rows[0].opponent_name || 'Away',
              sport, current.match_title,
            ]
          );
          console.log(`[mvp] saved MVP="${mvp.name}" score=${req.params.scoreId} event=${current.event_id} sport=${sport}`);
        }
      }
    } catch (mvpErr) {
      console.error('[mvp] auto-detect error:', mvpErr.message, mvpErr.stack);
    }

    const score = mapLiveScore(withTimerComputed(rows[0]));
    emitScoreUpdate(req, req.params.scoreId, { score });
    res.json({ score });
  } catch (err) { next(err); }
};

/* GET /api/clubs/:id/live-scores/:scoreId/mvp */
const getMvp = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT * FROM match_mvp WHERE score_id = $1::bigint AND club_id = $2::bigint`,
      [req.params.scoreId, req.params.id]
    );
    res.json({ mvp: rows[0] || null });
  } catch (err) { next(err); }
};

/* GET /api/events/:id/mvp — returns all MVPs for every completed match in this event */
const getEventMvp = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT DISTINCT ON (m.score_id) m.*
       FROM match_mvp m
       JOIN club_live_scores cls ON cls.id = m.score_id
       WHERE m.event_id = $1::bigint
          OR cls.event_id = $1::bigint
       ORDER BY m.score_id, m.created_at ASC`,
      [req.params.id]
    );
    console.log(`[mvp] getEventMvp event=${req.params.id} → ${rows.length} rows`);
    res.json({ mvps: rows });
  } catch (err) { next(err); }
};

/* PATCH /api/clubs/:id/live-scores/:scoreId/mvp/photo — coordinator uploads MVP photo */
const uploadMvpPhotoCtrl = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No photo uploaded.' });
    const photoUrl = getFileValue(req.file);
    const { rows } = await pgPool.query(
      `UPDATE match_mvp SET player_photo = $1, updated_at = NOW()
       WHERE score_id = $2::bigint AND club_id = $3::bigint RETURNING *`,
      [photoUrl, req.params.scoreId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'MVP record not found — end the game first.' });
    res.json({ mvp: rows[0] });
  } catch (err) { next(err); }
};

/* POST /api/clubs/:id/live-scores/:scoreId/mvp/player — coordinator changes MVP player */
const setMvpPlayer = async (req, res, next) => {
  try {
    const { playerName } = req.body;
    if (!playerName) return res.status(400).json({ message: 'playerName required.' });
    /* Re-compute stats from live score record */
    const { rows: sr } = await pgPool.query(
      `SELECT home_players, away_players, sport FROM club_live_scores
       WHERE id = $1::bigint AND club_id = $2::bigint`, [req.params.scoreId, req.params.id]
    );
    if (!sr.length) return res.status(404).json({ message: 'Score not found.' });
    const sc = sr[0];
    const allPlayers = [...(sc.home_players||[]), ...(sc.away_players||[])];
    const player = allPlayers.find(p => p.name?.toLowerCase() === playerName.toLowerCase());
    const displayStats = buildMvpStats(sc.sport || 'basketball', player?.stats || {});
    /* UPSERT — creates the record if auto-detect never ran (e.g. no players were loaded) */
    const { rows: cls } = await pgPool.query(
      `SELECT event_id, home_team, opponent_name, team_score, opponent_score, sport, score_data
       FROM club_live_scores WHERE id = $1::bigint`, [req.params.scoreId]
    );
    const live = cls[0] || {};
    const { home: finalHomeScore, away: finalAwayScore } = computeFinalScore(live);
    const { rows } = await pgPool.query(
      `INSERT INTO match_mvp
         (score_id, club_id, event_id, player_name, stats,
          home_score, away_score, home_team, opponent_name, sport)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
       ON CONFLICT (score_id) DO UPDATE SET
         player_name = EXCLUDED.player_name,
         stats       = EXCLUDED.stats,
         updated_at  = NOW()
       RETURNING *`,
      [
        req.params.scoreId, req.params.id, live.event_id || null,
        playerName, JSON.stringify(displayStats),
        finalHomeScore, finalAwayScore,
        live.home_team || '', live.opponent_name || '', sc.sport || 'general',
      ]
    );
    res.json({ mvp: rows[0] });
  } catch (err) { next(err); }
};

/* POST /api/clubs/:id/live-scores/:scoreId/timer/start */
const startLiveTimer = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `UPDATE club_live_scores
       SET timer_running = true,
           timer_last_started_at = NOW(),
           updated_by = $1,
           updated_at = NOW()
       WHERE id = $2::bigint AND club_id = $3::bigint
       RETURNING ${LIVE_SCORE_SELECT}`,
      [req.user.id, req.params.scoreId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Scoreboard not found.' });
    const score = mapLiveScore(withTimerComputed(rows[0]));
    emitScoreUpdate(req, req.params.scoreId, { score });
    res.json({ score });
  } catch (err) { next(err); }
};

/* POST /api/clubs/:id/live-scores/:scoreId/timer/stop */
const stopLiveTimer = async (req, res, next) => {
  try {
    const { rows: curRows } = await pgPool.query(
      `SELECT ${LIVE_SCORE_SELECT}
       FROM club_live_scores
       WHERE id = $1::bigint AND club_id = $2::bigint`,
      [req.params.scoreId, req.params.id]
    );
    if (!curRows.length) return res.status(404).json({ message: 'Scoreboard not found.' });
    const current = withTimerComputed(curRows[0]);
    const { rows } = await pgPool.query(
      `UPDATE club_live_scores
       SET timer_running = false,
           timer_last_started_at = NULL,
           time_remaining_seconds = $1,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $3::bigint AND club_id = $4::bigint
       RETURNING ${LIVE_SCORE_SELECT}`,
      [current.time_remaining_seconds, req.user.id, req.params.scoreId, req.params.id]
    );
    const score = mapLiveScore(withTimerComputed(rows[0]));
    emitScoreUpdate(req, req.params.scoreId, { score });
    res.json({ score });
  } catch (err) { next(err); }
};

/* POST /api/clubs/:id/live-scores/:scoreId/timer/reset */
const resetLiveTimer = async (req, res, next) => {
  try {
    const desired = Math.max(0, Number(req.body?.timeRemainingSeconds) || 0);
    const { rows } = await pgPool.query(
      `UPDATE club_live_scores
       SET timer_running = false,
           timer_last_started_at = NULL,
           time_remaining_seconds = $1,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $3::bigint AND club_id = $4::bigint
       RETURNING ${LIVE_SCORE_SELECT}`,
      [desired, req.user.id, req.params.scoreId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Scoreboard not found.' });
    const score = mapLiveScore(withTimerComputed(rows[0]));
    emitScoreUpdate(req, req.params.scoreId, { score });
    res.json({ score });
  } catch (err) { next(err); }
};

/* Which per-player stat drives the team score for each sport */
const SPORT_SCORE_STAT = {
  basketball: 'points',
  football:   'goals',
  cricket:    'runs',
  volleyball: 'points',
  badminton:  'points',
  kabaddi:    'points',
};

/* Stats to display on MVP card per sport — ordered for display */
const MVP_STAT_KEYS = {
  basketball: [['points','PTS'],['assists','AST'],['rebounds','REB'],['blocks','BLK']],
  football:   [['goals','GLS'],['assists','AST'],['yellow_cards','YC']],
  cricket:    [['runs','RUNS'],['wickets','WKTS'],['balls','BALLS']],
  volleyball: [['points','PTS'],['attacks','ATK'],['blocks','BLK']],
  badminton:  [['points','PTS'],['winners','WIN'],['errors','ERR']],
  kabaddi:    [['points','PTS'],['tackles','TKLS'],['raids','RAIDS']],
};

/* Sports whose MVP is ranked by a combined total of several stats rather than
   just the single scoring stat — volleyball's points/attacks/blocks are each
   separate ways to win a rally, so all three count toward match impact. */
const MVP_IMPACT_STATS = {
  volleyball: ['points', 'attacks', 'blocks'],
};

function buildMvpStats(sport, rawStats) {
  const keys = MVP_STAT_KEYS[sport] || [['points','PTS']];
  const out = {};
  for (const [k, label] of keys) {
    const v = Number(rawStats?.[k] ?? 0);
    out[label] = v;
  }
  return out;
}

/* Match's real final score for the record (event_fixtures.score_a/b, match_mvp.home/away_score).
   Volleyball resets team_score/opponent_score to 0-0 at the start of every set, so once at least
   one set has been completed, the true final score is sets won (e.g. 3-1) — but if the coordinator
   ends the game before any set finished (early stoppage/forfeit), score_data.sets is still empty and
   setsWon would misleadingly read 0-0, so fall back to the in-progress set's raw points instead. */
function computeFinalScore(row) {
  if (row.sport === 'volleyball') {
    const sets = row.score_data?.sets || [];
    if (sets.length > 0) {
      return {
        home: Number(row.score_data?.home?.setsWon || 0),
        away: Number(row.score_data?.away?.setsWon || 0),
      };
    }
  }
  return { home: Number(row.team_score || 0), away: Number(row.opponent_score || 0) };
}

const BASKET_EVENT_TYPES = new Set([
  'shot_made', 'shot_missed', 'assist', 'rebound_off', 'rebound_def', 'foul', 'turnover', 'steal', 'block',
  'substitution', 'timeout',
]);

const emitScoreUpdate = (req, scoreId, payload) => {
  const io = req.app.get('io');
  if (!io) return;
  io.to(`match:${scoreId}`).emit('basketball:score:update', payload);
  io.emit('basketball:live:update', { scoreId, updatedAt: new Date().toISOString() });
  io.to(`match:${scoreId}`).emit('match:score:update', payload);
  io.emit('match:live:update', { scoreId, updatedAt: new Date().toISOString() });
};

const deriveBasketball = (score, events) => {
  const sideKey = { home: 'home', away: 'away' };
  const state = {
    teamScore: 0,
    opponentScore: 0,
    scoreByQuarter: { home: {}, away: {} },
    teamFouls: { home: 0, away: 0 },
    timeoutsUsed: { home: 0, away: 0 },
    playerStats: { home: {}, away: {} },
    onCourt: {
      home: score.score_data?.onCourt?.home || [],
      away: score.score_data?.onCourt?.away || [],
    },
  };

  const ensureP = (side, player) => {
    if (!player) return null;
    const pool = state.playerStats[side];
    if (!pool[player]) {
      pool[player] = {
        points: 0, assists: 0, rebounds: 0, oreb: 0, dreb: 0,
        steals: 0, blocks: 0, fouls: 0, turnovers: 0,
        fgMade: 0, fgAtt: 0, threeMade: 0, threeAtt: 0, ftMade: 0, ftAtt: 0,
      };
    }
    return pool[player];
  };

  for (const ev of events) {
    const side = sideKey[ev.team_side];
    const opp = side === 'home' ? 'away' : 'home';
    const p = ensureP(side, ev.player_name);
    const q = ev.quarter || 'Q1';
    const addQ = (pts) => { state.scoreByQuarter[side][q] = (state.scoreByQuarter[side][q] || 0) + pts; };
    switch (ev.event_type) {
      case 'shot_made': {
        const pts = Number(ev.points || 2);
        if (side === 'home') state.teamScore += pts; else state.opponentScore += pts;
        addQ(pts);
        if (p) {
          p.points += pts; p.fgMade += 1; p.fgAtt += 1;
          if (pts === 3) { p.threeMade += 1; p.threeAtt += 1; }
          if (pts === 1) { p.ftMade += 1; p.ftAtt += 1; }
        }
        break;
      }
      case 'shot_missed':
        if (p) { p.fgAtt += 1; if (Number(ev.points) === 3) p.threeAtt += 1; if (Number(ev.points) === 1) p.ftAtt += 1; }
        break;
      case 'assist': if (p) p.assists += 1; break;
      case 'rebound_off': if (p) { p.rebounds += 1; p.oreb += 1; } break;
      case 'rebound_def': if (p) { p.rebounds += 1; p.dreb += 1; } break;
      case 'foul': if (p) p.fouls += 1; state.teamFouls[side] += 1; break;
      case 'turnover': if (p) p.turnovers += 1; break;
      case 'steal': if (p) p.steals += 1; break;
      case 'block': if (p) p.blocks += 1; break;
      case 'timeout': state.timeoutsUsed[side] += 1; break;
      case 'substitution': {
        const inP = ev.metadata?.inPlayer || '';
        const outP = ev.metadata?.outPlayer || '';
        state.onCourt[side] = (state.onCourt[side] || []).filter((n) => n !== outP);
        if (inP && !state.onCourt[side].includes(inP)) state.onCourt[side].push(inP);
        ensureP(side, inP);
        ensureP(side, outP);
        break;
      }
      default: break;
    }
    ensureP(opp, ev.related_player_name || '');
  }
  return state;
};

const persistDerivedBasketballState = async (scoreId, clubId, userId) => {
  const { rows: scoreRows } = await pgPool.query(
    `SELECT ${LIVE_SCORE_SELECT} FROM club_live_scores WHERE id = $1::bigint AND club_id = $2::bigint`,
    [scoreId, clubId]
  );
  if (!scoreRows.length) return null;
  const score = withTimerComputed(scoreRows[0]);
  const { rows: events } = await pgPool.query(
    `SELECT id, event_type, team_side, player_name, related_player_name, points, metadata, game_clock, quarter, shot_clock, created_at
     FROM basketball_game_events
     WHERE score_id = $1::bigint AND is_reverted = false
     ORDER BY created_at ASC, id ASC`,
    [scoreId]
  );
  const d = deriveBasketball(score, events);
  const patchedScoreData = {
    ...(score.score_data || {}),
    quarter: (score.score_data || {}).quarter || 'Q1',
    shotClock: Number((score.score_data || {}).shotClock ?? 24),
    possession: (score.score_data || {}).possession || 'home',
    scoreByQuarter: d.scoreByQuarter,
    onCourt: d.onCourt,
  };
  const patchedStats = {
    ...(score.stats || {}),
    teamFouls: d.teamFouls,
    timeoutsUsed: d.timeoutsUsed,
    playerStats: d.playerStats,
  };
  const { rows: updated } = await pgPool.query(
    `UPDATE club_live_scores
     SET team_score = $1,
         opponent_score = $2,
         score_data = $3::jsonb,
         stats = $4::jsonb,
         updated_by = $5,
         updated_at = NOW()
     WHERE id = $6::bigint AND club_id = $7::bigint
     RETURNING ${LIVE_SCORE_SELECT}`,
    [d.teamScore, d.opponentScore, JSON.stringify(patchedScoreData), JSON.stringify(patchedStats), userId, scoreId, clubId]
  );
  return updated[0] ? mapLiveScore(withTimerComputed(updated[0])) : null;
};

const getBasketballEvents = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT id, event_type, team_side, player_name, related_player_name, points, metadata,
              game_clock, quarter, shot_clock, is_reverted, created_at
       FROM basketball_game_events
       WHERE score_id = $1::bigint
       ORDER BY created_at DESC, id DESC
       LIMIT 300`,
      [req.params.scoreId]
    );
    res.json({ events: rows });
  } catch (err) { next(err); }
};

const logBasketballEvent = async (req, res, next) => {
  try {
    const { eventType, teamSide, playerName, relatedPlayerName, points, metadata, gameClock, quarter, shotClock, clientEventId } = req.body || {};
    if (!BASKET_EVENT_TYPES.has(eventType)) return res.status(400).json({ message: 'Invalid basketball event type.' });
    if (!['home', 'away'].includes(teamSide)) return res.status(400).json({ message: 'teamSide must be home or away.' });
    const { rows: evRows } = await pgPool.query(
      `INSERT INTO basketball_game_events
         (score_id, event_type, team_side, player_name, related_player_name, points, metadata, game_clock, quarter, shot_clock, client_event_id, created_by)
       VALUES ($1::bigint,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12)
       RETURNING id, event_type, team_side, player_name, related_player_name, points, metadata, game_clock, quarter, shot_clock, is_reverted, created_at`,
      [
        req.params.scoreId, eventType, teamSide, (playerName || '').trim(), (relatedPlayerName || '').trim(),
        Number(points) || 0, JSON.stringify(metadata || {}), gameClock || '', quarter || 'Q1', shotClock ?? null, clientEventId || null, req.user.id,
      ]
    );
    const score = await persistDerivedBasketballState(req.params.scoreId, req.params.id, req.user.id);
    emitScoreUpdate(req, req.params.scoreId, { score, event: evRows[0] });
    res.status(201).json({ event: evRows[0], score });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'Duplicate event ignored.' });
    next(err);
  }
};

const editBasketballEvent = async (req, res, next) => {
  try {
    const { points, metadata, gameClock, quarter, shotClock, playerName, relatedPlayerName } = req.body || {};
    const { rows } = await pgPool.query(
      `UPDATE basketball_game_events
       SET points = COALESCE($1, points),
           metadata = COALESCE($2::jsonb, metadata),
           game_clock = COALESCE($3, game_clock),
           quarter = COALESCE($4, quarter),
           shot_clock = COALESCE($5, shot_clock),
           player_name = COALESCE($6, player_name),
           related_player_name = COALESCE($7, related_player_name),
           updated_at = NOW()
       WHERE id = $8::bigint AND score_id = $9::bigint
       RETURNING id, event_type, team_side, player_name, related_player_name, points, metadata, game_clock, quarter, shot_clock, is_reverted, created_at`,
      [points ?? null, metadata ? JSON.stringify(metadata) : null, gameClock ?? null, quarter ?? null, shotClock ?? null, playerName ?? null, relatedPlayerName ?? null, req.params.eventId, req.params.scoreId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Event not found.' });
    const score = await persistDerivedBasketballState(req.params.scoreId, req.params.id, req.user.id);
    emitScoreUpdate(req, req.params.scoreId, { score, event: rows[0] });
    res.json({ event: rows[0], score });
  } catch (err) { next(err); }
};

const undoBasketballEvent = async (req, res, next) => {
  try {
    const { rows: top } = await pgPool.query(
      `SELECT id FROM basketball_game_events
       WHERE score_id = $1::bigint AND is_reverted = false
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [req.params.scoreId]
    );
    if (!top.length) return res.status(404).json({ message: 'No events to undo.' });
    await pgPool.query(
      `UPDATE basketball_game_events SET is_reverted = true, reverted_at = NOW(), updated_at = NOW() WHERE id = $1::bigint`,
      [top[0].id]
    );
    const score = await persistDerivedBasketballState(req.params.scoreId, req.params.id, req.user.id);
    emitScoreUpdate(req, req.params.scoreId, { score, undoEventId: top[0].id });
    res.json({ message: 'Last action undone.', score });
  } catch (err) { next(err); }
};

const redoBasketballEvent = async (req, res, next) => {
  try {
    const { rows: top } = await pgPool.query(
      `SELECT id FROM basketball_game_events
       WHERE score_id = $1::bigint AND is_reverted = true
       ORDER BY reverted_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [req.params.scoreId]
    );
    if (!top.length) return res.status(404).json({ message: 'No events to redo.' });
    await pgPool.query(
      `UPDATE basketball_game_events SET is_reverted = false, reverted_at = NULL, updated_at = NOW() WHERE id = $1::bigint`,
      [top[0].id]
    );
    const score = await persistDerivedBasketballState(req.params.scoreId, req.params.id, req.user.id);
    emitScoreUpdate(req, req.params.scoreId, { score, redoEventId: top[0].id });
    res.json({ message: 'Last undone action restored.', score });
  } catch (err) { next(err); }
};

/* DELETE /api/clubs/:id/live-scores/:scoreId */
const deleteLiveScore = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `DELETE FROM club_live_scores
       WHERE id = $1::bigint AND club_id = $2::bigint
       RETURNING id, fixture_id, event_id, winner_name, division`,
      [req.params.scoreId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Scoreboard not found.' });
    const deleted = rows[0];
    /* Clean up the orphaned MVP record so restarting the same match starts fresh
       instead of leaving stale MVP data behind alongside the new one. */
    await pgPool.query(`DELETE FROM match_mvp WHERE score_id = $1::bigint`, [req.params.scoreId]);

    /* This scoreboard's result is gone — reset the fixture it fed so the bracket
       correctly reports the match as unplayed again, and retract any later-round
       fixture that was only auto-created because of the now-undone winner. Scoped to
       this scoreboard's own division so an identically-named team in the other
       division is never touched. */
    if (deleted.fixture_id) {
      await pgPool.query(
        `UPDATE event_fixtures SET score_a = NULL, score_b = NULL, winner_name = NULL WHERE id = $1::bigint`,
        [deleted.fixture_id]
      ).catch(() => {});
    }
    if (deleted.event_id && deleted.winner_name) {
      bracketEngine.retractDownstream({
        eventId: deleted.event_id, teamName: deleted.winner_name, division: deleted.division, io: req.app.get('io'),
      }).catch(() => {});
    }
    if (deleted.event_id) {
      autoRefreshReportIfExists(deleted.event_id).catch(() => {});
    }

    res.json({ message: 'Scoreboard deleted.' });
  } catch (err) { next(err); }
};

module.exports = {
  getMembership,
  getLeadership, setLeadership,
  getMessages, postMessage,
  getTasks, createTask, updateTask, deleteTask, getTaskCompletions, saveTaskCompletions,
  updateOverview,
  getAttendance, getAttendanceSession, createAttendanceSession, updateAttendanceRecord, deleteAttendanceSession,
  getLiveScores, createLiveScore, updateLiveScore, deleteLiveScore, startLiveScore, endLiveScore, startLiveTimer, stopLiveTimer, resetLiveTimer,
  getBasketballEvents, logBasketballEvent, editBasketballEvent, undoBasketballEvent, redoBasketballEvent,
  getMvp, getEventMvp, uploadMvpPhotoCtrl, setMvpPlayer,
};
