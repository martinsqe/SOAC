const { pgPool } = require('../config/db');

/* ── Compute ISO date range for a period anchor ─────────────────────────── */
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getDateRange(period, dateStr) {
  const base = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const y = base.getFullYear(), mo = base.getMonth(), dy = base.getDate();
  switch (period) {
    case 'day': {
      const s = fmtDate(base);
      return { start: s, end: s };
    }
    case 'week': {
      const dow = (base.getDay() + 6) % 7; // 0=Mon
      const mon = new Date(base); mon.setDate(dy - dow);
      const sun = new Date(mon);  sun.setDate(mon.getDate() + 6);
      return { start: fmtDate(mon), end: fmtDate(sun) };
    }
    case 'month': {
      const first = new Date(y, mo, 1);
      const last  = new Date(y, mo + 1, 0);
      return { start: fmtDate(first), end: fmtDate(last) };
    }
    case 'year':
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    default: {
      const dow = (base.getDay() + 6) % 7;
      const mon = new Date(base); mon.setDate(dy - dow);
      const sun = new Date(mon);  sun.setDate(mon.getDate() + 6);
      return { start: fmtDate(mon), end: fmtDate(sun) };
    }
  }
}

/* ── Apply threshold label to a numeric score ───────────────────────────── */
function getLabel(param, value) {
  const ts = Array.isArray(param.thresholds) ? param.thresholds : [];
  if (!ts.length) return { label: null, color: '#6b7280' };
  if (param.measurement_type === 'lower_better') {
    // thresholds sorted from best (lowest value) to worst (highest value)
    for (const t of ts) {
      if (value <= Number(t.value)) return { label: t.label, color: t.color || '#6b7280' };
    }
  } else {
    // higher_better: sorted from best (highest value) to worst
    for (const t of ts) {
      if (value >= Number(t.value)) return { label: t.label, color: t.color || '#6b7280' };
    }
  }
  return { label: ts[ts.length - 1].label, color: ts[ts.length - 1].color || '#6b7280' };
}

/* ── GET /api/clubs/:id/performance/params ───────────────────────────────── */
const getParams = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT id, name, description, unit, measurement_type, max_value,
              category, thresholds, sort_order, is_active, created_at
       FROM club_performance_params
       WHERE club_id = $1::bigint
       ORDER BY sort_order ASC, created_at ASC`,
      [req.params.id]
    );
    res.json({ params: rows });
  } catch (err) { next(err); }
};

/* ── POST /api/clubs/:id/performance/params ──────────────────────────────── */
const createParam = async (req, res, next) => {
  try {
    const {
      name, description = '', unit = '', measurement_type = 'higher_better',
      max_value = null, category = 'General', thresholds = [], sort_order = 0
    } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Parameter name is required.' });
    const { rows } = await pgPool.query(
      `INSERT INTO club_performance_params
         (club_id, name, description, unit, measurement_type, max_value,
          category, thresholds, sort_order, created_by)
       VALUES ($1::bigint,$2,$3,$4,$5,$6::numeric,$7,$8::jsonb,$9,$10)
       RETURNING *`,
      [
        req.params.id, name.trim(), description, unit, measurement_type,
        max_value || null, category, JSON.stringify(thresholds),
        sort_order, req.user.id
      ]
    );
    res.status(201).json({ param: rows[0] });
  } catch (err) { next(err); }
};

/* ── PUT /api/clubs/:id/performance/params/:paramId ─────────────────────── */
const updateParam = async (req, res, next) => {
  try {
    const { name, description, unit, measurement_type, max_value,
            category, thresholds, sort_order, is_active } = req.body;
    const { rows } = await pgPool.query(
      `UPDATE club_performance_params SET
         name             = COALESCE($1,  name),
         description      = COALESCE($2,  description),
         unit             = COALESCE($3,  unit),
         measurement_type = COALESCE($4,  measurement_type),
         max_value        = CASE WHEN $5::text IS NOT NULL THEN $5::numeric ELSE max_value END,
         category         = COALESCE($6,  category),
         thresholds       = CASE WHEN $7::text IS NOT NULL THEN $7::jsonb ELSE thresholds END,
         sort_order       = COALESCE($8,  sort_order),
         is_active        = COALESCE($9,  is_active),
         updated_at       = NOW()
       WHERE id = $10::bigint AND club_id = $11::bigint
       RETURNING *`,
      [
        name?.trim() || null, description ?? null, unit ?? null,
        measurement_type || null,
        max_value !== undefined ? String(max_value) : null,
        category || null,
        thresholds !== undefined ? JSON.stringify(thresholds) : null,
        sort_order ?? null, is_active ?? null,
        req.params.paramId, req.params.id
      ]
    );
    if (!rows.length) return res.status(404).json({ message: 'Parameter not found.' });
    res.json({ param: rows[0] });
  } catch (err) { next(err); }
};

/* ── DELETE /api/clubs/:id/performance/params/:paramId — soft deactivate ── */
const deleteParam = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `UPDATE club_performance_params
       SET is_active = false, updated_at = NOW()
       WHERE id = $1::bigint AND club_id = $2::bigint AND is_active = true
       RETURNING id`,
      [req.params.paramId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Parameter not found.' });
    res.json({ message: 'Parameter deactivated.' });
  } catch (err) { next(err); }
};

/* ── POST /api/clubs/:id/performance/records ─────────────────────────────── */
const recordAssessment = async (req, res, next) => {
  try {
    const { paramId, recordedDate, records = [] } = req.body;
    if (!paramId) return res.status(400).json({ message: 'paramId is required.' });
    const date = recordedDate || fmtDate(new Date());

    const { rows: pRows } = await pgPool.query(
      `SELECT id FROM club_performance_params
       WHERE id = $1::bigint AND club_id = $2::bigint AND is_active = true`,
      [paramId, req.params.id]
    );
    if (!pRows.length) return res.status(404).json({ message: 'Parameter not found or inactive.' });

    const validRecords = records.filter(r => r.userId && r.value != null && r.value !== '');
    if (!validRecords.length) return res.status(400).json({ message: 'No valid records to save.' });

    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      for (const r of validRecords) {
        await client.query(
          `INSERT INTO club_performance_records
             (param_id, club_id, user_id, user_name, value, recorded_date, notes, recorded_by)
           VALUES ($1::bigint,$2::bigint,$3::int,$4,$5::numeric,$6::date,$7,$8)`,
          [paramId, req.params.id, r.userId, r.userName || '', r.value, date, r.notes || '', req.user.id]
        );
      }
      await client.query('COMMIT');
      res.status(201).json({ message: `${validRecords.length} assessment(s) recorded.` });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }
  } catch (err) { next(err); }
};

/* ── GET /api/clubs/:id/performance/dashboard?period=week&date=2024-06-28 ── */
const getProgressDashboard = async (req, res, next) => {
  try {
    const clubId = req.params.id;
    const period = req.query.period || 'week';
    const range  = getDateRange(period, req.query.date);

    /* 1. All active members with XP/level */
    const { rows: members } = await pgPool.query(
      `SELECT sc.user_id, u.name AS user_name, u.avatar,
              COALESCE(mp.level,'Beginner') AS level,
              COALESCE(mp.xp, 0)::int       AS xp,
              mp.notes AS progress_notes
       FROM student_clubs sc
       JOIN users u ON u.id = sc.user_id AND u.is_active = true
       LEFT JOIN member_progress mp ON mp.user_id = sc.user_id AND mp.club_id = sc.club_id
       WHERE sc.club_id = $1::bigint
       ORDER BY COALESCE(mp.xp,0) DESC, u.name`,
      [clubId]
    );

    /* 2. Active performance params */
    const { rows: params } = await pgPool.query(
      `SELECT id, name, unit, measurement_type, max_value, category, thresholds
       FROM club_performance_params
       WHERE club_id = $1::bigint AND is_active = true
       ORDER BY sort_order, created_at`,
      [clubId]
    );

    if (!members.length) {
      return res.json({ period, dateRange: range, params, players: [] });
    }

    const userIds = members.map(m => m.user_id);
    const paramIds = params.map(p => p.id);

    /* Run attendance, task, and perf queries in parallel */
    const [attRes, taskRes, perfRes] = await Promise.all([
      pgPool.query(
        `SELECT user_id,
                COUNT(*)::int                                  AS sessions,
                COUNT(*) FILTER (WHERE status='present')::int  AS present,
                COUNT(*) FILTER (WHERE status='late')::int     AS late,
                COUNT(*) FILTER (WHERE status='absent')::int   AS absent,
                COUNT(*) FILTER (WHERE status='excused')::int  AS excused
         FROM club_attendance_records
         WHERE club_id=$1::bigint AND user_id=ANY($2::int[])
           AND session_date BETWEEN $3::date AND $4::date
         GROUP BY user_id`,
        [clubId, userIds, range.start, range.end]
      ),
      pgPool.query(
        `SELECT user_id,
                COUNT(*)::int                              AS total,
                COUNT(*) FILTER (WHERE is_completed)::int AS completed
         FROM task_completion_records
         WHERE club_id=$1::bigint AND user_id=ANY($2::int[])
           AND saved_at::date BETWEEN $3::date AND $4::date
         GROUP BY user_id`,
        [clubId, userIds, range.start, range.end]
      ),
      paramIds.length
        ? pgPool.query(
            `SELECT DISTINCT ON (user_id, param_id)
                    user_id, param_id, value::float, recorded_date
             FROM club_performance_records
             WHERE club_id=$1::bigint AND user_id=ANY($2::int[]) AND param_id=ANY($3::bigint[])
               AND recorded_date BETWEEN $4::date AND $5::date
             ORDER BY user_id, param_id, recorded_date DESC`,
            [clubId, userIds, paramIds, range.start, range.end]
          )
        : Promise.resolve({ rows: [] })
    ]);

    const attMap  = Object.fromEntries(attRes.rows.map(r => [String(r.user_id), r]));
    const taskMap = Object.fromEntries(taskRes.rows.map(r => [String(r.user_id), r]));

    const paramIndex = Object.fromEntries(params.map(p => [String(p.id), p]));
    const perfMap = {};
    for (const r of perfRes.rows) {
      const uid = String(r.user_id), pid = String(r.param_id);
      if (!perfMap[uid]) perfMap[uid] = {};
      const param = paramIndex[pid];
      const { label, color } = param ? getLabel(param, r.value) : { label: null, color: '#6b7280' };
      perfMap[uid][pid] = { value: r.value, date: r.recorded_date, label, color };
    }

    const MULT = { Expert: 3, Advanced: 2, Alumni: 2, Intermediate: 1.5 };
    const players = members.map(m => {
      const uid  = String(m.user_id);
      const att  = attMap[uid]  || { sessions: 0, present: 0, late: 0, absent: 0, excused: 0 };
      const task = taskMap[uid] || { total: 0, completed: 0 };
      const perf = perfMap[uid] || {};
      const coins = Math.floor(m.xp * (MULT[m.level] || 1));
      const attRate  = att.sessions  ? Math.round(((att.present + att.late * 0.5) / att.sessions) * 100) : null;
      const taskRate = task.total    ? Math.round((task.completed / task.total) * 100) : null;
      return {
        userId: uid, userName: m.user_name, avatar: m.avatar,
        level: m.level, xp: m.xp, coins,
        progressNotes: m.progress_notes || '',
        attendance: { ...att, rate: attRate },
        tasks: { ...task, rate: taskRate },
        params: perf,
      };
    });

    res.json({ period, dateRange: range, params, players });
  } catch (err) { next(err); }
};

/* ── GET /api/clubs/:id/performance/player/:userId?period=week&date=... ──── */
const getPlayerTimeline = async (req, res, next) => {
  try {
    const { id: clubId, userId } = req.params;
    const period = req.query.period || 'month';
    const range  = getDateRange(period, req.query.date);

    const { rows: params } = await pgPool.query(
      `SELECT id, name, unit, measurement_type, max_value, category, thresholds
       FROM club_performance_params WHERE club_id=$1::bigint AND is_active=true ORDER BY sort_order`,
      [clubId]
    );

    const [perfRes, attRes, taskRes] = await Promise.all([
      pgPool.query(
        `SELECT pr.param_id, pr.value::float, pr.recorded_date, pr.notes,
                p.name AS param_name, p.unit
         FROM club_performance_records pr
         JOIN club_performance_params p ON p.id = pr.param_id
         WHERE pr.club_id=$1::bigint AND pr.user_id=$2::int
           AND pr.recorded_date BETWEEN $3::date AND $4::date
         ORDER BY pr.param_id, pr.recorded_date ASC`,
        [clubId, userId, range.start, range.end]
      ),
      pgPool.query(
        `SELECT r.session_date, r.status, r.notes,
                COALESCE(s.session_label,'') AS session_label
         FROM club_attendance_records r
         LEFT JOIN club_attendance_sessions s ON s.id = r.session_id
         WHERE r.club_id=$1::bigint AND r.user_id=$2::int
           AND r.session_date BETWEEN $3::date AND $4::date
         ORDER BY r.session_date`,
        [clubId, userId, range.start, range.end]
      ),
      pgPool.query(
        `SELECT task_title, is_completed, coins_awarded, saved_at::date AS completed_date
         FROM task_completion_records
         WHERE club_id=$1::bigint AND user_id=$2::int
           AND saved_at::date BETWEEN $3::date AND $4::date
         ORDER BY saved_at`,
        [clubId, userId, range.start, range.end]
      ),
    ]);

    const paramIndex = Object.fromEntries(params.map(p => [String(p.id), p]));
    const perfByParam = {};
    for (const r of perfRes.rows) {
      const pid = String(r.param_id);
      if (!perfByParam[pid]) perfByParam[pid] = [];
      const param = paramIndex[pid];
      const { label, color } = param ? getLabel(param, r.value) : { label: null, color: '#6b7280' };
      perfByParam[pid].push({ date: r.recorded_date, value: r.value, notes: r.notes, label, color });
    }

    res.json({
      period, dateRange: range, params,
      performance: perfByParam,
      attendance: attRes.rows,
      tasks: taskRes.rows,
    });
  } catch (err) { next(err); }
};

module.exports = {
  getParams, createParam, updateParam, deleteParam,
  recordAssessment, getProgressDashboard, getPlayerTimeline,
};
