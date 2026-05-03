const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const { pgPool } = require('../config/db');
const { sendCredentials } = require('../config/email');
const { ensureSoacTables } = require('../services/soacData');
const cache = require('../services/cache');

const RKU_DOMAIN = '@rku.ac.in';

/* ── Column list for user rows returned to clients (never exposes password_hash) */
const USER_PUBLIC_COLS = [
  'id', 'email', 'name', 'role', 'is_active',
  'must_change_password', 'managed_club_id', 'created_at', 'last_login',
].join(', ');

/* ── Pagination helper ──────────────────────────────────────────────────────*/
const parsePage = (query) => {
  const page  = Math.max(1, parseInt(query.page,  10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
  return { page, limit, offset: (page - 1) * limit };
};

/* GET /api/users  (admin)
   Supports ?page=&limit= */
const getAll = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePage(req.query);
    const { rows } = await pgPool.query(
      `SELECT ${USER_PUBLIC_COLS}, COUNT(*) OVER() AS total_count
       FROM users
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const total = Number(rows[0]?.total_count ?? 0);
    res.json({
      users:      rows.map(({ total_count, ...u }) => u),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
};

/* POST /api/users  (admin — create user and email credentials) */
const create = async (req, res, next) => {
  try {
    const { email, name, role = 'admin' } = req.body;
    if (!email || !name)              return res.status(400).json({ message: 'Email and name are required.' });
    if (!email.endsWith(RKU_DOMAIN))  return res.status(400).json({ message: 'Only @rku.ac.in emails are allowed.' });

    const tempPassword = crypto.randomBytes(5).toString('hex').toUpperCase();
    const hash         = await bcrypt.hash(tempPassword, 12);

    const { rows } = await pgPool.query(
      `INSERT INTO users (email, password_hash, name, role, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, name, role, is_active, must_change_password, created_at`,
      [email.toLowerCase(), hash, name, role, req.user.id]
    );
    const newUser = rows[0];

    await pgPool.query(
      `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, meta)
       VALUES ($1, $2, 'CREATE_USER', 'user', $3, $4)`,
      [req.user.id, req.user.name, String(newUser.id), JSON.stringify({ email, role })]
    );

    sendCredentials({ toEmail: email, toName: name, password: tempPassword })
      .catch(err => console.warn('Email send failed:', err.message));

    await cache.del('stats:admin');
    res.status(201).json({ user: newUser, tempPassword });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'A user with that email already exists.' });
    next(err);
  }
};

/* PUT /api/users/:id  (admin) */
const update = async (req, res, next) => {
  try {
    const { name, role, is_active } = req.body;
    const { rows } = await pgPool.query(
      `UPDATE users
       SET name      = COALESCE($1, name),
           role      = COALESCE($2, role),
           is_active = COALESCE($3, is_active)
       WHERE id = $4
       RETURNING id, email, name, role, is_active`,
      [name, role, is_active, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'User not found.' });
    await cache.del(`session:user:${req.params.id}`);
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
};

/* DELETE /api/users/:id  (admin — deactivate) */
const remove = async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ message: 'You cannot deactivate your own account.' });
    }
    await pgPool.query(`UPDATE users SET is_active = false WHERE id = $1`, [req.params.id]);
    await Promise.all([
      cache.del('stats:admin'),
      cache.del(`session:user:${req.params.id}`, `session:tokens:${req.params.id}`),
    ]);
    res.json({ message: 'User deactivated.' });
  } catch (err) { next(err); }
};

/* GET /api/users/meta/stats  (admin)
   8 counts run in parallel via Promise.all — no sequential round-trips.
   Cache-aside: stats:admin → 30 s */
const stats = async (req, res, next) => {
  try {
    await ensureSoacTables();

    const cached = await cache.get('stats:admin');
    if (cached) return res.json(cached);

    const [usersRes, auditRes, clubsRes, eventsRes, upcomingRes, regsRes, pendingReqRes, studentsRes] = await Promise.all([
      pgPool.query(`SELECT COUNT(*)::int AS count FROM users        WHERE is_active = true`),
      pgPool.query(`SELECT user_name, action, entity_type, entity_id, meta, created_at
                    FROM audit_log ORDER BY created_at DESC LIMIT 10`),
      pgPool.query(`SELECT COUNT(*)::int AS count FROM clubs        WHERE is_active = true`),
      pgPool.query(`SELECT COUNT(*)::int AS count FROM events       WHERE is_active = true`),
      pgPool.query(`SELECT COUNT(*)::int AS count FROM events       WHERE is_active = true AND status = 'upcoming'`),
      pgPool.query(`SELECT COUNT(*)::int AS count FROM event_registrations`),
      pgPool.query(`SELECT COUNT(*)::int AS count FROM join_requests WHERE status = 'pending'`),
      pgPool.query(`SELECT COUNT(*)::int AS count FROM users        WHERE role = 'student' AND is_active = true`),
    ]);

    const result = {
      clubs:           clubsRes.rows[0].count,
      events:          eventsRes.rows[0].count,
      upcomingEvents:  upcomingRes.rows[0].count,
      registrations:   regsRes.rows[0].count,
      pendingRequests: pendingReqRes.rows[0].count,
      students:        studentsRes.rows[0].count,
      users:           usersRes.rows[0].count,
      recentAudit:     auditRes.rows,
      mongoReady:      false,
    };
    await cache.set('stats:admin', result, cache.TTL.STATS);
    res.json(result);
  } catch (err) { next(err); }
};

/* GET /api/users/meta/audit  (admin)
   Supports ?page=&limit= — previously hard-capped at 100 rows */
const auditLog = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePage(req.query);
    const { rows } = await pgPool.query(
      `SELECT id, user_id, user_name, action, entity_type, entity_id, meta, created_at,
              COUNT(*) OVER() AS total_count
       FROM audit_log
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const total = Number(rows[0]?.total_count ?? 0);
    res.json({
      log:        rows.map(({ total_count, ...r }) => r),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
};

/* GET /api/users/me/clubs  (student)
   Cache-aside: student:<id> → 60 s */
const myClubs = async (req, res, next) => {
  try {
    const cacheKey = `student:${req.user.id}`;
    const cached   = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const { rows } = await pgPool.query(
      `SELECT club_id, club_name, joined_at
       FROM student_clubs
       WHERE user_id = $1
       ORDER BY joined_at`,
      [req.user.id]
    );
    const result = { clubs: rows };
    await cache.set(cacheKey, result, cache.TTL.STUDENT);
    res.json(result);
  } catch (err) { next(err); }
};

/* GET /api/users/me/coins  (any authenticated student)
   Returns the current student's coins (XP × level multiplier), rank in global
   leaderboard, tier, and a breakdown per club.                              */
const myCoins = async (req, res, next) => {
  try {
    /* Per-club breakdown for this student */
    const { rows: progRows } = await pgPool.query(
      `SELECT mp.club_id, c.name AS club_name, c.color,
              mp.xp, mp.level,
              FLOOR(mp.xp::float * CASE mp.level
                WHEN 'Expert'       THEN 3
                WHEN 'Advanced'     THEN 2
                WHEN 'Alumni'       THEN 2
                WHEN 'Intermediate' THEN 1.5
                ELSE 1
              END)::int AS coins
       FROM member_progress mp
       JOIN clubs c ON c.id = mp.club_id
       WHERE mp.user_id = $1`,
      [req.user.id]
    );

    const totalCoins = progRows.reduce((s, r) => s + (r.coins || 0), 0);

    /* Global rank — count students with more coins */
    const { rows: rankRows } = await pgPool.query(
      `SELECT COUNT(*)::int AS ahead
       FROM (
         SELECT FLOOR(SUM(mp2.xp::float * CASE mp2.level
           WHEN 'Expert' THEN 3 WHEN 'Advanced' THEN 2 WHEN 'Alumni' THEN 2
           WHEN 'Intermediate' THEN 1.5 ELSE 1 END))::int AS c
         FROM member_progress mp2
         JOIN users u2 ON u2.id = mp2.user_id
         WHERE u2.is_active = true AND u2.role = 'student'
         GROUP BY mp2.user_id
       ) sub WHERE sub.c > $1`,
      [totalCoins]
    );
    const rank = (rankRows[0]?.ahead ?? 0) + 1;

    res.json({ coins: totalCoins, rank, clubs: progRows });
  } catch (err) { next(err); }
};

/* PUT /api/users/me/profile  (any authenticated user) */
const updateProfile = async (req, res, next) => {
  try {
    const { name } = req.body;
    const updates = []; const vals = []; let i = 1;
    if (name?.trim()) { updates.push(`name   = $${i++}`); vals.push(name.trim()); }
    if (req.file)     { updates.push(`avatar = $${i++}`); vals.push(req.file.filename); }
    if (!updates.length) return res.status(400).json({ message: 'Nothing to update.' });

    vals.push(req.user.id);
    const { rows } = await pgPool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${i}
       RETURNING id, email, name, role, avatar, managed_club_id`,
      vals
    );
    const u = rows[0];
    await cache.del(`session:user:${req.user.id}`);
    res.json({ user: { ...u, avatar: u.avatar || '', managedClubId: u.managed_club_id || null } });
  } catch (err) { next(err); }
};

/* PUT /api/users/:id/assign-club  (admin) */
const assignClub = async (req, res, next) => {
  try {
    const { clubId } = req.body;
    const { rows } = await pgPool.query(
      `UPDATE users SET managed_club_id = $1
       WHERE id = $2 AND role = 'coordinator'
       RETURNING id, email, name, role, managed_club_id`,
      [clubId || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Coordinator not found.' });
    await pgPool.query(
      `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, meta)
       VALUES ($1, $2, 'ASSIGN_CLUB', 'user', $3, $4)`,
      [req.user.id, req.user.name, String(req.params.id), JSON.stringify({ clubId })]
    );
    await cache.del(`session:user:${req.params.id}`);
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
};

module.exports = { getAll, create, update, remove, stats, auditLog, myClubs, updateProfile, assignClub, myCoins };
