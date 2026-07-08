/**
 * Club detail endpoints — leadership, chat, tasks, membership.
 * All routes are under /api/clubs/:id/…
 */
const { pgPool } = require('../config/db');
const { ensureSoacTables } = require('../services/soacData');
const { getFileValue } = require('../config/multer');

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
    res.json({ message: 'Task archived. Completion records and coins have been preserved.' });
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
      `SELECT user_id, is_completed, coins_awarded FROM task_completion_records WHERE task_id = $1::bigint`,
      [taskId]
    );
    const savedMap = Object.fromEntries(saved.map(r => [String(r.user_id), r]));

    res.json({
      task: { id: String(taskRows[0].id), title: taskRows[0].title, isDeleted: taskRows[0].is_deleted },
      members: members.map(m => ({
        userId:       String(m.user_id),
        userName:     m.user_name,
        isCompleted:  savedMap[String(m.user_id)]?.is_completed  ?? false,
        coinsAwarded: savedMap[String(m.user_id)]?.coins_awarded ?? 0,
      })),
      alreadySaved: saved.length > 0,
    });
  } catch (err) { next(err); }
};

/* POST /api/clubs/:id/tasks/:taskId/completions
   Body: { completions: [{ userId, userName, isCompleted }] }
   Awards 100 XP per completed member, adjusts XP diff on re-saves.
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
      let totalCoins = 0;

      for (const c of completions) {
        if (!c.userId) continue;
        const isCompleted = !!c.isCompleted;
        const newCoins    = isCompleted ? 100 : 0;

        /* Get previous state to compute XP diff */
        const { rows: prev } = await client.query(
          `SELECT is_completed, coins_awarded FROM task_completion_records
           WHERE task_id = $1::bigint AND user_id = $2::int`,
          [taskId, c.userId]
        );
        const oldCoins = prev[0]?.coins_awarded ?? 0;

        /* Upsert completion record */
        await client.query(
          `INSERT INTO task_completion_records
             (task_id, club_id, user_id, user_name, task_title, is_completed, coins_awarded, saved_at)
           VALUES ($1::bigint, $2::bigint, $3::int, $4, $5, $6, $7, NOW())
           ON CONFLICT (task_id, user_id) DO UPDATE
             SET is_completed  = EXCLUDED.is_completed,
                 coins_awarded = EXCLUDED.coins_awarded,
                 saved_at      = NOW()`,
          [taskId, clubId, c.userId, c.userName || '', taskTitle, isCompleted, newCoins]
        );

        /* Apply XP delta only if it changed */
        const xpDiff = newCoins - oldCoins;
        if (xpDiff !== 0) {
          await applyXpDelta(client, clubId, c.userId, c.userName || '', xpDiff, req.user.id);
        }
        totalCoins += newCoins;
      }

      await client.query('COMMIT');
      res.json({ message: 'Completions saved.', totalCoinsAwarded: totalCoins });
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

/* Coins awarded per attendance status */
const ATTEND_XP = { present: 100, late: 50, excused: 25, absent: 0 };

/* Motivational messages sent when a member hits 4 present days in a week */
const CONSISTENCY_MESSAGES = [
  "Exceptional dedication this week! Attending 4 sessions proves you are serious about your growth — champions are built on exactly this kind of commitment.",
  "Outstanding consistency! Showing up 4 times in a single week reflects a champion's mindset. Keep pushing — greatness is within your reach.",
  "Remarkable effort this week! Four sessions of committed training — you are laying the foundation for something truly exceptional. Keep it up!",
  "Brilliant work! Your 4-session consistency this week is a clear sign you are ready to level up. Leaders lead by showing up, and you are doing exactly that.",
  "Excellence recognized! Four sessions in one week earns you the Consistency Champion bonus. Your commitment is what sets you apart — never stop.",
];

/* Upsert XP delta into member_progress (inside an existing client transaction) */
const applyXpDelta = (client, clubId, userId, userName, xpDelta, updatedBy) =>
  client.query(
    `INSERT INTO member_progress (club_id, user_id, user_name, xp, updated_by, updated_at)
     VALUES ($1::bigint, $2::int, $3, GREATEST(0, $4::int), $5, NOW())
     ON CONFLICT (club_id, user_id) DO UPDATE
       SET xp         = GREATEST(0, member_progress.xp + $4::int),
           user_name  = EXCLUDED.user_name,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
    [clubId, userId, userName, xpDelta, updatedBy]
  );

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
        /* Award base attendance XP */
        const xp = ATTEND_XP[status] ?? 0;
        if (xp > 0) {
          await applyXpDelta(client, clubId, r.user_id, r.user_name || '', xp, req.user.id);
        }
        /* Consistency bonus: +100 coins when member is present for the 4th time this week */
        if (status === 'present') {
          const { rows: [{ cnt }] } = await client.query(
            `SELECT COUNT(DISTINCT session_date)::int AS cnt
             FROM club_attendance_records
             WHERE user_id = $1 AND club_id = $2::bigint AND status = 'present'
               AND DATE_TRUNC('week', session_date) = DATE_TRUNC('week', $3::date)`,
            [r.user_id, clubId, session_date]
          );
          if (cnt >= 4) {
            /* Only award once per (club, user, week) */
            const { rows: bonusGranted } = await client.query(
              `INSERT INTO attendance_consistency_bonuses (club_id, user_id, week_start)
               VALUES ($1::bigint, $2::int, DATE_TRUNC('week', $3::date)::date)
               ON CONFLICT (club_id, user_id, week_start) DO NOTHING RETURNING id`,
              [clubId, r.user_id, session_date]
            );
            if (bonusGranted.length) {
              await applyXpDelta(client, clubId, r.user_id, r.user_name || '', 100, req.user.id);
              const msg = CONSISTENCY_MESSAGES[Math.floor(Math.random() * CONSISTENCY_MESSAGES.length)];
              await client.query(
                `INSERT INTO member_notifications (user_id, club_id, title, body, type)
                 VALUES ($1::int, $2::bigint, $3, $4, 'achievement')`,
                [r.user_id, clubId, 'Consistency Champion! +100 bonus coins', msg]
              );
            }
          }
        }
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
    const clubId    = req.params.id;
    const recordId  = req.params.recordId;

    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');

      // Fetch current record to get old status and user identity
      const { rows: existing } = await client.query(
        `SELECT id, user_id, user_name, status AS old_status
         FROM club_attendance_records WHERE id = $1::bigint`,
        [recordId]
      );
      if (!existing.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Record not found.' });
      }
      const { user_id, user_name, old_status } = existing[0];
      const newStatus = status || old_status;

      // Update the record
      const { rows } = await client.query(
        `UPDATE club_attendance_records
         SET status = COALESCE($1, status), notes = COALESCE($2, notes)
         WHERE id = $3::bigint RETURNING id, user_id, user_name, status, notes`,
        [status || null, notes ?? null, recordId]
      );

      // Adjust XP for the status change
      if (status && status !== old_status) {
        const xpDiff = (ATTEND_XP[newStatus] ?? 0) - (ATTEND_XP[old_status] ?? 0);
        if (xpDiff !== 0) {
          await applyXpDelta(client, clubId, user_id, user_name, xpDiff, req.user.id);
        }
      }

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
   and all coins previously allocated remain intact. */
const deleteAttendanceSession = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `DELETE FROM club_attendance_sessions WHERE id = $1::bigint AND club_id = $2::bigint RETURNING id`,
      [req.params.sessionId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Session not found.' });
    res.json({ message: 'Session deleted. Attendance records and allocated coins have been preserved.' });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════════════════════════════════
   MEMBER PROGRESS
══════════════════════════════════════════════════════════════════════════ */

/* GET /api/clubs/:id/progress */
const getProgress = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { rows } = await pgPool.query(
      `SELECT mp.id, mp.user_id, mp.user_name, mp.level, mp.xp, mp.notes, mp.updated_at,
              u.avatar
       FROM   member_progress mp
       LEFT JOIN users u ON u.id = mp.user_id
       WHERE  mp.club_id = $1::bigint
       ORDER  BY mp.xp DESC, mp.user_name`,
      [req.params.id]
    );
    res.json({ progress: rows });
  } catch (err) { next(err); }
};

/* PUT /api/clubs/:id/progress/:userId  — upsert member progress */
const upsertProgress = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { level, xp, notes, user_name } = req.body;
    const { rows: userRows } = await pgPool.query(`SELECT name FROM users WHERE id = $1`, [req.params.userId]);
    const name = user_name || userRows[0]?.name || '';
    const { rows } = await pgPool.query(
      `INSERT INTO member_progress (club_id, user_id, user_name, level, xp, notes, updated_by, updated_at)
       VALUES ($1::bigint, $2::int, $3, $4, $5::int, $6, $7, NOW())
       ON CONFLICT (club_id, user_id) DO UPDATE SET
         level      = EXCLUDED.level,
         xp         = EXCLUDED.xp,
         notes      = EXCLUDED.notes,
         user_name  = EXCLUDED.user_name,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING id, user_id, user_name, level, xp, notes, updated_at`,
      [req.params.id, req.params.userId, name, level || 'Beginner', Number(xp) || 0, notes || '', req.user.id]
    );
    res.json({ progress: rows[0] });
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
  volleyball: 90 * 60,
  badminton: 60 * 60,
};
const LIVE_SCORE_SELECT = `id, club_id, sport, match_title, home_team, opponent_name, venue, status,
              game_clock, team_score, opponent_score, score_data, stats, home_players, away_players,
              time_remaining_seconds, timer_running, timer_last_started_at,
              winner_name, fixture_id, event_id,
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
    const { rows } = await pgPool.query(
      `INSERT INTO club_live_scores
         (club_id, sport, match_title, home_team, opponent_name, venue, game_clock,
          team_score, opponent_score, score_data, stats, home_players, away_players,
          time_remaining_seconds, status, created_by, updated_by, fixture_id, event_id)
       VALUES ($1::bigint, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14, 'draft', $15, $15, $16, $17)
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
        req.body.fixtureId ? Number(req.body.fixtureId) : null,
        req.body.eventId   ? Number(req.body.eventId)   : null,
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

    /* Snapshot current player rosters before update so we can diff for coin awards */
    let prevHome = null, prevAway = null, snapshotClubId = null, snapshotSport = null;
    const willUpdatePlayers = updates.homePlayers !== undefined || updates.awayPlayers !== undefined;
    if (willUpdatePlayers) {
      const { rows: cur } = await pgPool.query(
        `SELECT home_players, away_players, sport, club_id FROM club_live_scores WHERE id = $1::bigint AND club_id = $2::bigint`,
        [req.params.scoreId, req.params.id]
      );
      if (cur.length) {
        prevHome       = cur[0].home_players || [];
        prevAway       = cur[0].away_players || [];
        snapshotSport  = cur[0].sport;
        snapshotClubId = cur[0].club_id;
      }
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

    /* Detect any positive stat change and award 62 coins per stat milestone — fire-and-forget */
    if (willUpdatePlayers && prevHome !== null) {
      const cid       = rows[0].club_id || snapshotClubId;
      const sid       = req.params.scoreId;
      const checkDiff = (prev, next) => {
        for (const np of (next || [])) {
          if (!np.name) continue;
          const pp       = (prev || []).find(p => p.name === np.name);
          const oldStats = pp?.stats || {};
          const newStats = np.stats  || {};
          for (const stat of Object.keys(newStats)) {
            if (NON_REWARD_STATS.has(stat)) continue;
            const oldVal = Number(oldStats[stat] ?? 0);
            const newVal = Number(newStats[stat] ?? 0);
            if (newVal > oldVal) {
              awardPlayerScoreCoins(sid, cid, np.name, stat, newVal).catch(() => {});
            }
          }
        }
      };
      checkDiff(prevHome, rows[0].home_players || []);
      checkDiff(prevAway, rows[0].away_players || []);
    }

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
      };

      const homeScore = Number(current.team_score     || 0);
      const awayScore = Number(current.opponent_score || 0);

      if (current.fixture_id) {
        /* Explicitly linked fixture — update winner + scores */
        pgPool.query(
          `UPDATE event_fixtures SET winner_name = $1, score_a = $2, score_b = $3 WHERE id = $4::bigint`,
          [winnerName, homeScore, awayScore, current.fixture_id]
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
            [winnerName, homeScore, awayScore, fx[0].id]
          ).then(() => broadcastResult(fx[0].id, fx[0].event_id));
        }).catch(() => {});
      }
    }

    /* Auto-detect MVP: player with highest score stat across both rosters */
    try {
      const sport     = current.sport || 'basketball';
      const scoreStat = SPORT_SCORE_STAT[sport] || 'points';
      const allPlayers = [
        ...(current.home_players || []),
        ...(current.away_players || []),
      ].filter(p => p.name);
      if (allPlayers.length) {
        const mvp = allPlayers.reduce((best, p) => {
          const pv = Number(p.stats?.[scoreStat] ?? 0);
          const bv = Number(best?.stats?.[scoreStat] ?? -1);
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
              rows[0].team_score, rows[0].opponent_score,
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
      `SELECT event_id, home_team, opponent_name, team_score, opponent_score FROM club_live_scores
       WHERE id = $1::bigint`, [req.params.scoreId]
    );
    const live = cls[0] || {};
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
        live.team_score || 0, live.opponent_score || 0,
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

/* Basketball game-event types that earn 62 coins via the event log */
const COIN_EARN_EVENTS = new Set(['shot_made', 'assist', 'block', 'steal', 'rebound_off', 'rebound_def']);

/* Per-player stat button stats that do NOT earn coins (negative / neutral) */
const NON_REWARD_STATS = new Set(['yellow_cards', 'errors', 'fouls', 'turnovers', 'balls']);

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
  basketball: [['points','PTS'],['assists','AST'],['rebounds','REB']],
  football:   [['goals','GLS'],['assists','AST'],['yellow_cards','YC']],
  cricket:    [['runs','RUNS'],['wickets','WKTS'],['balls','BALLS']],
  volleyball: [['points','PTS'],['assists','AST'],['blocks','BLK']],
  badminton:  [['points','PTS'],['winners','WIN'],['errors','ERR']],
  kabaddi:    [['points','PTS'],['tackles','TKLS'],['raids','RAIDS']],
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

/* Award 62 coins to a player for a scoring action — fire-and-forget */
async function awardMatchPerformanceCoins(scoreId, gameEventId, playerName, eventType) {
  if (!COIN_EARN_EVENTS.has(eventType) || !playerName) return;
  try {
    /* Get club_id from the live score row */
    const { rows: scoreRows } = await pgPool.query(
      `SELECT club_id FROM club_live_scores WHERE id = $1::bigint LIMIT 1`, [scoreId]
    );
    if (!scoreRows.length) return;
    const clubId = scoreRows[0].club_id;

    /* Find the student user by name within this club */
    const { rows: userRows } = await pgPool.query(
      `SELECT DISTINCT u.id AS user_id
       FROM users u
       JOIN student_clubs sc ON sc.user_id = u.id AND sc.club_id = $1::bigint
       WHERE u.is_active = true AND u.name ILIKE $2
       LIMIT 1`,
      [clubId, playerName.trim()]
    );
    if (!userRows.length) return;
    const userId = userRows[0].user_id;
    const entityId = String(gameEventId);

    const actionLabel = eventType === 'shot_made' ? 'scoring' : eventType;
    const ins = await pgPool.query(
      `INSERT INTO coin_transactions (user_id, amount, reason, entity_type, entity_id, academic_year)
       SELECT $1, 62, $2, 'match_performance', $3,
              to_char(NOW(), 'YYYY') || '-' || to_char(NOW() + interval '1 year', 'YY')
       WHERE NOT EXISTS (
         SELECT 1 FROM coin_transactions
         WHERE user_id = $1 AND entity_type = 'match_performance' AND entity_id = $3
       )
       RETURNING id`,
      [userId, `Match performance (${actionLabel})`, entityId]
    );
  } catch (e) {
    console.error('[coins] awardMatchPerformanceCoins error:', e.message);
  }
}

/* Award 62 coins for any positive stat contribution via roster stat buttons.
   entity_id format: ps|{scoreId}|{statName}|{newValue}
   This prefix lets myActivity link back to events via club_live_scores.event_id */
async function awardPlayerScoreCoins(scoreId, clubId, playerName, statName, newValue) {
  if (!playerName) return;
  try {
    /* Try club member first, fall back to any active student with matching name */
    let { rows: userRows } = await pgPool.query(
      `SELECT DISTINCT u.id AS user_id
       FROM users u
       JOIN student_clubs sc ON sc.user_id = u.id AND sc.club_id = $1::bigint
       WHERE u.is_active = true AND u.name ILIKE $2
       LIMIT 1`,
      [clubId, playerName.trim()]
    );
    if (!userRows.length) {
      ({ rows: userRows } = await pgPool.query(
        `SELECT id AS user_id FROM users
         WHERE is_active = true AND name ILIKE $1
         LIMIT 1`,
        [playerName.trim()]
      ));
    }
    if (!userRows.length) {
      console.warn(`[coins] awardPlayerScoreCoins: no user found for player "${playerName}" (score ${scoreId}, stat ${statName})`);
      return;
    }
    const userId   = userRows[0].user_id;
    const entityId = `ps|${scoreId}|${statName}|${newValue}|${playerName.trim().toLowerCase()}`;
    const statLabel = statName === 'goals' ? 'scoring a goal'
                    : statName === 'points' ? 'scoring'
                    : statName;
    const ins = await pgPool.query(
      `INSERT INTO coin_transactions (user_id, amount, reason, entity_type, entity_id, academic_year)
       SELECT $1::int, 62, $2::text, 'player_score', $3::text,
              to_char(NOW(), 'YYYY') || '-' || to_char(NOW() + interval '1 year', 'YY')
       WHERE NOT EXISTS (
         SELECT 1 FROM coin_transactions
         WHERE user_id = $1::int AND entity_type = 'player_score' AND entity_id = $3::text
       )
       RETURNING id`,
      [userId, `Match contribution (${statLabel})`, entityId]
    );
    if (ins.rowCount > 0) {
      console.log(`[coins] +62 awarded to user ${userId} (${playerName}) for ${statLabel} — score ${scoreId}`);
    } else {
      console.log(`[coins] Duplicate skipped for user ${userId} (${playerName}) ${statLabel} val=${newValue}`);
    }
  } catch (e) {
    console.error('[coins] awardPlayerScoreCoins error:', e.message, e.stack);
  }
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
    awardMatchPerformanceCoins(req.params.scoreId, evRows[0].id, playerName, eventType).catch(() => {});
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
       RETURNING id`,
      [req.params.scoreId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Scoreboard not found.' });
    /* Clean up the orphaned MVP record so restarting the same match starts fresh
       instead of leaving stale MVP data behind alongside the new one. */
    await pgPool.query(`DELETE FROM match_mvp WHERE score_id = $1::bigint`, [req.params.scoreId]);
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
  getProgress, upsertProgress,
  getLiveScores, createLiveScore, updateLiveScore, deleteLiveScore, startLiveScore, endLiveScore, startLiveTimer, stopLiveTimer, resetLiveTimer,
  getBasketballEvents, logBasketballEvent, editBasketballEvent, undoBasketballEvent, redoBasketballEvent,
  getMvp, getEventMvp, uploadMvpPhotoCtrl, setMvpPlayer,
};
