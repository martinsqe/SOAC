const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');
const { pgPool } = require('../config/db');
const { cloudinaryInstance, useCloudinary } = require('../config/multer');
const { ensureSoacTables } = require('../services/soacData');
const { sendCredentials } = require('../config/email');
const cache = require('../services/cache');

const AVATAR_ALLOWED = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

/* Upload a file buffer — returns stored value (Cloudinary URL or /uploads path) */
const uploadAvatarBuffer = async (file) => {
  if (useCloudinary && cloudinaryInstance) {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinaryInstance.uploader.upload_stream(
        { folder: 'avatars', resource_type: 'image', allowed_formats: AVATAR_ALLOWED },
        (err, r) => (err ? reject(err) : resolve(r))
      );
      stream.end(file.buffer);
    });
    return result.secure_url;
  }
  // Disk fallback
  const dir = path.join(__dirname, '..', 'uploads', 'avatars');
  fs.mkdirSync(dir, { recursive: true });
  const fname = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  fs.writeFileSync(path.join(dir, fname), file.buffer);
  return `/uploads/avatars/${fname}`;
};

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
   Supports ?page=&limit=
   Includes each student's active club memberships (name + id) — students can belong to up
   to 3 clubs at once, so this is an array, not a single value like coordinators' managed_club_id. */
const getAll = async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePage(req.query);
    const { rows } = await pgPool.query(
      `SELECT u.id, u.email, u.name, u.role, u.is_active,
              u.must_change_password, u.managed_club_id, u.created_at, u.last_login,
              COALESCE(
                json_agg(jsonb_build_object('id', sc.club_id, 'name', sc.club_name))
                  FILTER (WHERE sc.id IS NOT NULL),
                '[]'
              ) AS clubs,
              COUNT(*) OVER() AS total_count
       FROM users u
       LEFT JOIN student_clubs sc ON sc.user_id = u.id AND sc.is_active = true
       GROUP BY u.id
       ORDER BY u.created_at DESC
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
    if (is_active === false && Number(req.params.id) === req.user.id) {
      return res.status(400).json({ message: 'You cannot deactivate your own account.' });
    }
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
   Returns per-club coin breakdown for ALL clubs the student belongs to,
   even clubs where no attendance has been recorded yet (shows 0 coins).  */
const myCoins = async (req, res, next) => {
  try {
    /* Start from student_clubs so every enrolled club appears, even with 0 XP */
    const { rows: progRows } = await pgPool.query(
      `SELECT sc.club_id, c.name AS club_name, c.color,
              COALESCE(mp.xp, 0)::int                       AS xp,
              COALESCE(mp.level, 'Beginner')                AS level,
              FLOOR(COALESCE(mp.xp, 0)::float * CASE COALESCE(mp.level, 'Beginner')
                WHEN 'Expert'       THEN 3
                WHEN 'Advanced'     THEN 2
                WHEN 'Alumni'       THEN 2
                WHEN 'Intermediate' THEN 1.5
                ELSE 1
              END)::int AS coins
       FROM student_clubs sc
       JOIN clubs c ON c.id = sc.club_id AND c.is_active = true
       LEFT JOIN member_progress mp
              ON mp.user_id = sc.user_id AND mp.club_id = sc.club_id
       WHERE sc.user_id = $1
       ORDER BY c.name`,
      [req.user.id]
    );

    const xpCoins    = progRows.reduce((s, r) => s + (r.coins || 0), 0);

    /* Event participation coins from coin_transactions */
    const { rows: ctRows } = await pgPool.query(
      `SELECT COALESCE(SUM(amount), 0)::int AS event_coins FROM coin_transactions WHERE user_id = $1`,
      [req.user.id]
    );
    const eventCoins = ctRows[0]?.event_coins || 0;
    const totalCoins = xpCoins + eventCoins;

    /* All coin_transaction rewards list for wallet display */
    const { rows: eventRewardRows } = await pgPool.query(
      `SELECT ct.amount, ct.reason, ct.entity_type, ct.created_at,
              e.title AS event_title
       FROM coin_transactions ct
       LEFT JOIN events e ON e.id::text = ct.entity_id
         AND ct.entity_type IN ('event_clearance', 'event_registration')
       WHERE ct.user_id = $1
       ORDER BY ct.created_at DESC LIMIT 30`,
      [req.user.id]
    );

    /* Global rank — count students with more coins (includes event coins) */
    const { rows: rankRows } = await pgPool.query(
      `SELECT COUNT(*)::int AS ahead
       FROM (
         SELECT sc2.user_id,
                FLOOR(SUM(COALESCE(mp2.xp,0)::float * CASE COALESCE(mp2.level,'Beginner')
                  WHEN 'Expert' THEN 3 WHEN 'Advanced' THEN 2 WHEN 'Alumni' THEN 2
                  WHEN 'Intermediate' THEN 1.5 ELSE 1 END))::int +
                COALESCE((SELECT SUM(ct.amount) FROM coin_transactions ct WHERE ct.user_id = sc2.user_id), 0)::int AS c
         FROM student_clubs sc2
         JOIN users u2 ON u2.id = sc2.user_id AND u2.is_active = true AND u2.role = 'student'
         LEFT JOIN member_progress mp2 ON mp2.user_id = sc2.user_id AND mp2.club_id = sc2.club_id
         GROUP BY sc2.user_id
       ) sub WHERE sub.c > $1`,
      [totalCoins]
    );
    const rank = (rankRows[0]?.ahead ?? 0) + 1;

    res.json({
      coins: totalCoins,
      rank,
      clubs: progRows,
      eventCoins,
      eventRewards: eventRewardRows.map(r => ({
        amount:     r.amount,
        entityType: r.entity_type,
        reason:     r.event_title || r.reason,
        createdAt: r.created_at,
      })),
    });
  } catch (err) { next(err); }
};

/* GET /api/users/me/event-registrations  (any authenticated student)
   Server-truth registration status (by email) for every event this student has ever
   registered for — regardless of which device/session/localStorage state that
   happened in. This is what lets the events page correctly show "already registered"
   for a student who, say, registered for a club's event before joining that club,
   then logs in later (possibly on a different device) after joining — the frontend
   no longer has to rely on localStorage alone to know this. */
const myEventRegistrations = async (req, res, next) => {
  try {
    const email = (req.user?.email || '').toLowerCase();
    if (!email) return res.json({ registrations: [] });

    const { rows } = await pgPool.query(
      `SELECT er.event_id, er.id AS registration_id,
              et.name AS team_name, et.is_cleared
       FROM event_registrations er
       LEFT JOIN event_team_members etm ON etm.registration_id = er.id
       LEFT JOIN event_teams et ON et.id = etm.team_id
       WHERE LOWER(er.email) = $1
       ORDER BY er.registered_at ASC`,
      [email]
    );

    const byEvent = {};
    for (const r of rows) {
      const key = String(r.event_id);
      if (!byEvent[key]) {
        byEvent[key] = {
          eventId:  key,
          status:   r.is_cleared ? 'cleared' : r.team_name ? 'team_assigned' : 'registered',
          teamName: r.team_name || null,
        };
      }
    }
    res.json({ registrations: Object.values(byEvent) });
  } catch (err) { next(err); }
};

/* GET /api/users/me/club-leaderboards  (any authenticated student)
   Per-club coin ranking, scoped to each club the student actually belongs to —
   students only ever see who's top in THEIR clubs, never a platform-wide list.
   Ranked by club XP-based coins only (coordinator-tracked progress); event-
   participation bonus coins still count toward the student's own total on
   /users/me/coins, just not this per-club ranking. Top 3 in a club qualify for
   that club's Free Registration award. */
const myClubLeaderboards = async (req, res, next) => {
  try {
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 3));

    const { rows: myClubs } = await pgPool.query(
      `SELECT sc.club_id, c.name AS club_name, c.color
       FROM student_clubs sc
       JOIN clubs c ON c.id = sc.club_id AND c.is_active = true
       WHERE sc.user_id = $1
       ORDER BY c.name`,
      [req.user.id]
    );
    if (!myClubs.length) return res.json({ clubs: [] });

    const clubIds = myClubs.map(c => c.club_id);
    const { rows: ranked } = await pgPool.query(
      `SELECT mp.club_id, mp.user_id, u.name AS user_name, u.avatar,
              mp.xp::int AS total_xp,
              FLOOR(mp.xp::float * CASE mp.level
                WHEN 'Expert'       THEN 3
                WHEN 'Advanced'     THEN 2
                WHEN 'Alumni'       THEN 2
                WHEN 'Intermediate' THEN 1.5
                ELSE 1
              END)::int AS coins,
              ROW_NUMBER() OVER (
                PARTITION BY mp.club_id
                ORDER BY FLOOR(mp.xp::float * CASE mp.level
                  WHEN 'Expert'       THEN 3
                  WHEN 'Advanced'     THEN 2
                  WHEN 'Alumni'       THEN 2
                  WHEN 'Intermediate' THEN 1.5
                  ELSE 1
                END) DESC, mp.xp DESC, mp.user_id
              )::int AS rank
       FROM member_progress mp
       JOIN users u ON u.id = mp.user_id AND u.is_active = true AND u.role = 'student'
       WHERE mp.club_id = ANY($1::bigint[])`,
      [clubIds]
    );

    const clubs = myClubs.map(c => {
      const clubRanked = ranked.filter(r => String(r.club_id) === String(c.club_id));
      const mine        = clubRanked.find(r => String(r.user_id) === String(req.user.id));
      return {
        clubId:       String(c.club_id),
        clubName:     c.club_name,
        color:        c.color,
        leaderboard:  clubRanked.filter(r => r.rank <= limit)
          .map(r => ({ userId: String(r.user_id), userName: r.user_name, avatar: r.avatar, xp: r.total_xp, coins: r.coins, rank: r.rank })),
        myRank:       mine ? mine.rank  : null,
        myCoins:      mine ? mine.coins : 0,
        totalTracked: clubRanked.length,
      };
    });

    res.json({ clubs });
  } catch (err) { next(err); }
};

/* GET /api/users/me/activity — full event + contribution + coin history */
const myActivity = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { rows: uRows } = await pgPool.query(
      `SELECT LOWER(email) AS email, name FROM users WHERE id = $1 AND is_active = true LIMIT 1`,
      [userId]
    );
    if (!uRows.length) return res.status(404).json({ message: 'Not found.' });
    const { email, name } = uRows[0];

    const [regRes, psContribRes, bgeContribRes] = await Promise.all([
      /* Events this student registered for — with all coin totals per event */
      pgPool.query(
        `SELECT er.event_id, er.event_title, er.registered_at,
                e.date AS event_date, e.venue, e.category,
                c.name AS club_name,
                COALESCE(ct_reg.amount, 0)::int AS reg_coins,
                COALESCE((
                  SELECT SUM(ct2.amount)::int FROM coin_transactions ct2
                  WHERE ct2.user_id = $1 AND ct2.entity_type = 'event_clearance'
                    AND ct2.entity_id IN (
                      SELECT et.id::text FROM event_teams et
                      JOIN event_team_members etm ON etm.team_id = et.id
                      JOIN event_registrations er2 ON er2.id = etm.registration_id
                      WHERE et.event_id = er.event_id AND LOWER(er2.email) = $2
                    )
                ), 0)::int AS clear_coins,
                COALESCE((
                  SELECT SUM(ct3.amount)::int FROM coin_transactions ct3
                  WHERE ct3.user_id = $1 AND ct3.entity_type = 'player_score'
                    AND ct3.entity_id ~ '^ps\|\d'
                    AND SPLIT_PART(ct3.entity_id, '|', 2)::bigint IN (
                      SELECT cls.id FROM club_live_scores cls WHERE cls.event_id = er.event_id
                    )
                ), 0)::int AS match_stat_coins,
                COALESCE((
                  SELECT SUM(ct4.amount)::int FROM coin_transactions ct4
                  JOIN basketball_game_events bge ON bge.id::text = ct4.entity_id
                  JOIN club_live_scores cls2 ON cls2.id = bge.score_id AND cls2.event_id = er.event_id
                  WHERE ct4.user_id = $1 AND ct4.entity_type = 'match_performance'
                ), 0)::int AS game_event_coins
         FROM event_registrations er
         LEFT JOIN events e ON e.id = er.event_id
         LEFT JOIN clubs c ON c.id = e.club_id
         LEFT JOIN coin_transactions ct_reg
           ON ct_reg.user_id = $1 AND ct_reg.entity_type = 'event_registration'
          AND ct_reg.entity_id = er.event_id::text
         WHERE LOWER(er.email) = $2
         ORDER BY er.registered_at DESC`,
        [userId, email]
      ),
      /* Stat-button match contributions (player_score) — per event, with stat detail */
      pgPool.query(
        `SELECT
           ct.amount,
           ct.created_at,
           SPLIT_PART(ct.entity_id, '|', 3) AS stat_name,
           SPLIT_PART(ct.entity_id, '|', 4) AS stat_value,
           cls.event_id
         FROM coin_transactions ct
         JOIN club_live_scores cls
           ON cls.id = SPLIT_PART(ct.entity_id, '|', 2)::bigint
         WHERE ct.user_id = $1
           AND ct.entity_type = 'player_score'
           AND ct.entity_id ~ '^ps\\|\\d'
         ORDER BY ct.created_at DESC`,
        [userId]
      ),
      /* Game-event contributions (match_performance) — per event, with action detail */
      pgPool.query(
        `SELECT
           ct.amount,
           ct.created_at,
           bge.event_type,
           COALESCE(bge.points, 0)::int AS points,
           bge.quarter,
           cls.event_id
         FROM coin_transactions ct
         JOIN basketball_game_events bge ON bge.id::text = ct.entity_id
         JOIN club_live_scores cls ON cls.id = bge.score_id
         WHERE ct.user_id = $1
           AND ct.entity_type = 'match_performance'
         ORDER BY ct.created_at DESC`,
        [userId]
      ),
    ]);

    /* Build event_id → contributions[] map */
    const contribMap = new Map();
    const addContrib = (eventId, entry) => {
      if (!eventId) return;
      const key = String(eventId);
      if (!contribMap.has(key)) contribMap.set(key, []);
      contribMap.get(key).push(entry);
    };
    for (const r of psContribRes.rows) {
      const statName  = r.stat_name  || 'contribution';
      const statValue = Number(r.stat_value) || 0;
      const label     = statName === 'points' || statName === 'goals'
        ? `${statValue} pt${statValue !== 1 ? 's' : ''}`
        : statName;
      addContrib(r.event_id, { label, amount: r.amount, createdAt: r.created_at });
    }
    for (const r of bgeContribRes.rows) {
      const label = r.event_type === 'shot_made'
        ? `${r.points || 2} pt${(r.points || 2) !== 1 ? 's' : ''}${r.quarter ? ` (${r.quarter})` : ''}`
        : r.event_type === 'assist' ? `Assist${r.quarter ? ` (${r.quarter})` : ''}`
        : `Block${r.quarter ? ` (${r.quarter})` : ''}`;
      addContrib(r.event_id, { label, amount: r.amount, createdAt: r.created_at });
    }

    res.json({
      registrations: regRes.rows.map(r => {
        const regCoins   = Number(r.reg_coins        || 0);
        const clearCoins = Number(r.clear_coins       || 0);
        const matchCoins = Number(r.match_stat_coins  || 0) + Number(r.game_event_coins || 0);
        return {
          eventId:       r.event_id,
          eventTitle:    r.event_title,
          clubName:      r.club_name || '—',
          category:      r.category  || '',
          venue:         r.venue     || '',
          eventDate:     r.event_date,
          registeredAt:  r.registered_at,
          regCoins,
          clearCoins,
          matchCoins,
          totalCoins:    regCoins + clearCoins + matchCoins,
          contributions: contribMap.get(String(r.event_id)) || [],
        };
      }),
    });
  } catch (err) { next(err); }
};

/* ── Motivational message banks ─────────────────────────────────────────── */
const WEEK_MSGS = [
  "Outstanding week! Every session brings you closer to greatness. Keep showing up!",
  "Consistency is your superpower. Another week of dedication in the books!",
  "Champions are built one practice at a time. You're building something special!",
  "Your commitment this week sets you apart. Never underestimate the power of showing up!",
  "Hard work beats talent when talent doesn't work hard. You're proving that every week!",
  "Every rep, every session, every task — it all adds up. Trust the process!",
  "This week you were disciplined, dedicated, and driven. That's the recipe for success!",
  "Progress isn't always visible, but it's always happening. Keep grinding!",
  "You showed up when it mattered. That's what separates good from great!",
  "Greatness is earned in the small moments. You're earning it, week by week!",
  "Your energy this week was contagious. Keep inspiring those around you!",
  "Every goal starts with showing up. You showed up — now keep going!",
];
const MONTH_MSGS = [
  "A full month of dedication. Your growth speaks for itself — keep rising!",
  "Month complete! Every session, every task, every effort has built a stronger you.",
  "What a month! Your consistency is turning potential into performance. Keep it up!",
  "Four weeks of showing up. You're not just a member — you're a pillar of this club.",
  "Monthly reflection: you've worked hard, grown stronger, and proven your commitment!",
  "Another month closer to your best self. The journey is the destination — embrace it!",
  "This month's stats tell a story of grit and growth. Write an even better one next month!",
  "Champions are built over months, not days. You're in the building phase — trust it!",
  "Your monthly performance shows real character. Keep this momentum going!",
  "Month done. You gave it your all. Rest, reflect, and come back even stronger!",
  "Consistent effort is the foundation of every great achievement. You're laying it!",
  "Look back at where you started this month. That growth? That's all you!",
];
const YEAR_MSGS = [
  "A full year of dedication! You've grown tremendously — the best is yet to come!",
  "365 days of choices, challenges, and growth. You chose to show up. That's everything!",
  "Year in review: your commitment is shaping who you're becoming. Incredibly proud of you!",
  "One year stronger. The consistency and discipline you've built will carry you far.",
  "Your yearly journey tells the story of a true champion. Carry this into the next year!",
];

function getMotivationalMsg(period, dateRange) {
  switch (period) {
    case 'week': {
      const d = new Date(dateRange.start + 'T12:00:00');
      const dayNum = d.getUTCDay() || 7;
      const tmp = new Date(d); tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
      const weekNum = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
      return WEEK_MSGS[weekNum % WEEK_MSGS.length];
    }
    case 'month': {
      const month = new Date(dateRange.start + 'T12:00:00').getMonth();
      return MONTH_MSGS[month % MONTH_MSGS.length];
    }
    case 'year': {
      const year = new Date(dateRange.start + 'T12:00:00').getFullYear();
      return YEAR_MSGS[year % YEAR_MSGS.length];
    }
    default: return WEEK_MSGS[0];
  }
}

function computeOverallScore(presentSessions, totalSessions, completedTasks, totalTasks) {
  let score = 0, weight = 0;
  if (totalSessions > 0) {
    score  += (presentSessions / totalSessions) * 100 * 0.6;
    weight += 0.6;
  }
  if (totalTasks > 0) {
    score  += (completedTasks / totalTasks) * 100 * 0.4;
    weight += 0.4;
  }
  if (weight === 0) return null;
  return Math.round(weight < 1 ? score / weight : score);
}

function scoreToLabel(score) {
  if (score === null) return { label: 'No data', color: '#9ca3af' };
  if (score >= 90)   return { label: 'Outstanding', color: '#059669' };
  if (score >= 75)   return { label: 'Excellent',   color: '#3b82f6' };
  if (score >= 60)   return { label: 'Good',         color: '#8b5cf6' };
  if (score >= 40)   return { label: 'Average',      color: '#f59e0b' };
  return               { label: 'Improving',    color: '#ef4444' };
}

/* ── Date-range helpers for period-based evaluation ────────────────────── */
function evalFmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function evalGetRange(period, dateStr) {
  const base = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
  const y = base.getFullYear(), mo = base.getMonth(), dy = base.getDate();
  switch (period) {
    case 'day': { const s = evalFmtDate(base); return { start: s, end: s }; }
    case 'week': {
      const dow = (base.getDay() + 6) % 7;
      const mon = new Date(base); mon.setDate(dy - dow);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return { start: evalFmtDate(mon), end: evalFmtDate(sun) };
    }
    case 'month': {
      const first = new Date(y, mo, 1), last = new Date(y, mo + 1, 0);
      return { start: evalFmtDate(first), end: evalFmtDate(last) };
    }
    case 'year':
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    default: {
      const dow = (base.getDay() + 6) % 7;
      const mon = new Date(base); mon.setDate(dy - dow);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return { start: evalFmtDate(mon), end: evalFmtDate(sun) };
    }
  }
}

/* GET /api/users/me/weekly-evaluation?period=week&date=2026-06-28
   Returns per-club progress summary (attendance + tasks + coins) for the
   requested period, plus unread motivational notifications.              */
const weeklyEvaluation = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const period = req.query.period || 'week';
    const range  = evalGetRange(period, req.query.date);

    /* All clubs the user belongs to */
    const { rows: clubs } = await pgPool.query(
      `SELECT sc.club_id, c.name AS club_name, c.color
       FROM student_clubs sc
       JOIN clubs c ON c.id = sc.club_id
       WHERE sc.user_id = $1 AND c.is_active = true
       ORDER BY c.name`,
      [userId]
    );

    if (!clubs.length) {
      return res.json({ period, dateRange: range, clubs: [], notifications: [] });
    }

    const clubIds = clubs.map(c => c.club_id);

    /* Attendance records in period */
    const { rows: records } = await pgPool.query(
      `SELECT r.club_id, r.session_date, r.status, r.notes,
              COALESCE(s.session_label, '') AS session_label
       FROM club_attendance_records r
       LEFT JOIN club_attendance_sessions s ON s.id = r.session_id
       WHERE r.user_id = $1
         AND r.club_id = ANY($2::bigint[])
         AND r.session_date BETWEEN $3::date AND $4::date
       ORDER BY r.session_date ASC`,
      [userId, clubIds, range.start, range.end]
    );

    /* Task completion records in period */
    const { rows: taskRecs } = await pgPool.query(
      `SELECT club_id, task_title, is_completed, coins_awarded,
              saved_at::date AS completed_date
       FROM task_completion_records
       WHERE user_id = $1
         AND club_id = ANY($2::bigint[])
         AND saved_at::date BETWEEN $3::date AND $4::date
       ORDER BY saved_at ASC`,
      [userId, clubIds, range.start, range.end]
    );

    /* Consistency bonuses in period (any week whose week_start falls inside range) */
    const { rows: bonusRows } = await pgPool.query(
      `SELECT club_id FROM attendance_consistency_bonuses
       WHERE user_id = $1
         AND week_start BETWEEN $2::date AND $3::date`,
      [userId, range.start, range.end]
    );
    const bonusClubIds = new Set(bonusRows.map(b => String(b.club_id)));

    /* Coins & level per club from member_progress (total, not period-specific) */
    const { rows: progRows } = await pgPool.query(
      `SELECT mp.club_id, COALESCE(mp.level,'Beginner') AS level,
              FLOOR(COALESCE(mp.xp,0)::float * CASE COALESCE(mp.level,'Beginner')
                WHEN 'Expert'       THEN 3
                WHEN 'Advanced'     THEN 2
                WHEN 'Alumni'       THEN 2
                WHEN 'Intermediate' THEN 1.5
                ELSE 1 END)::int AS coins
       FROM member_progress mp
       WHERE mp.user_id = $1 AND mp.club_id = ANY($2::bigint[])`,
      [userId, clubIds]
    );
    const progMap = Object.fromEntries(progRows.map(p => [String(p.club_id), p]));

    /* All special coins earned in this period (registrations, clearances, match performance) */
    const { rows: evCoinRows } = await pgPool.query(
      `SELECT ct.amount, ct.reason, ct.entity_type, ct.created_at,
              e.title AS event_title
       FROM coin_transactions ct
       LEFT JOIN events e ON e.id::text = ct.entity_id
         AND ct.entity_type IN ('event_clearance', 'event_registration')
       WHERE ct.user_id = $1
         AND ct.created_at::date BETWEEN $2::date AND $3::date
       ORDER BY ct.created_at ASC`,
      [userId, range.start, range.end]
    );

    /* Motivational message for this period */
    const motMsg = getMotivationalMsg(period, range);

    /* Build per-club summary */
    const clubData = clubs.map(cl => {
      const cid      = String(cl.club_id);
      const clRecs   = records.filter(r => String(r.club_id) === cid);
      const clTasks  = taskRecs.filter(r => String(r.club_id) === cid);
      const present  = clRecs.filter(r => r.status === 'present').length;
      const late     = clRecs.filter(r => r.status === 'late').length;
      const absent   = clRecs.filter(r => r.status === 'absent').length;
      const excused  = clRecs.filter(r => r.status === 'excused').length;
      const hasBonus = bonusClubIds.has(cid);
      const prog     = progMap[cid] || { coins: 0 };
      const tasksDone  = clTasks.filter(t => t.is_completed).length;
      const tasksTotal = clTasks.length;
      const attCoins   = present * 100 + late * 50 + excused * 25 + (hasBonus ? 100 : 0);
      const taskCoins  = clTasks.filter(t => t.is_completed).reduce((s, t) => s + (Number(t.coins_awarded) || 0), 0);
      const efficiency = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : null;
      const score      = computeOverallScore(present, clRecs.length, tasksDone, tasksTotal);
      const sl         = scoreToLabel(score);

      return {
        clubId:        cid,
        clubName:      cl.club_name,
        color:         cl.color || '#635bff',
        totalCoins:    prog.coins,
        attendance: {
          sessions: clRecs.length,
          present, late, absent, excused,
          coinsEarned:      attCoins,
          consistencyBonus: hasBonus,
          daysToBonus:      hasBonus ? 0 : Math.max(0, 4 - present),
          list: clRecs.map(r => ({
            date: r.session_date, label: r.session_label, status: r.status,
          })),
        },
        tasks: {
          total:      tasksTotal,
          completed:  tasksDone,
          efficiency,
          coinsEarned: taskCoins,
          list: clTasks.map(t => ({
            title:        t.task_title,
            completed:    t.is_completed,
            coinsAwarded: Number(t.coins_awarded) || 0,
            date:         t.completed_date,
          })),
        },
        overallScore:        score,
        scoreLabel:          sl.label,
        scoreColor:          sl.color,
        motivationalMessage: motMsg,
        /* keep flat fields for backwards compat */
        periodPresent:    present,
        periodTasksDone:  tasksDone,
        periodTotalTasks: tasksTotal,
        consistencyBonus: hasBonus,
        daysToBonus:      hasBonus ? 0 : Math.max(0, 4 - present),
        sessions: clRecs.map(r => ({ date: r.session_date, label: r.session_label, status: r.status })),
      };
    });

    /* Recent notifications (unread first, max 20) */
    const { rows: notifs } = await pgPool.query(
      `SELECT id, club_id, title, body, type, is_read, created_at
       FROM member_notifications
       WHERE user_id = $1
       ORDER BY is_read ASC, created_at DESC
       LIMIT 20`,
      [userId]
    );

    res.json({
      period,
      dateRange: range,
      clubs: clubData,
      eventRewards: {
        total: evCoinRows.reduce((s, r) => s + (r.amount || 0), 0),
        list:  evCoinRows.map(r => ({
          amount:     r.amount,
          entityType: r.entity_type,
          reason:     r.event_title || r.reason,
          createdAt:  r.created_at,
        })),
      },
      notifications: notifs.map(n => ({
        id:        String(n.id),
        clubId:    n.club_id ? String(n.club_id) : null,
        title:     n.title,
        body:      n.body,
        type:      n.type,
        isRead:    n.is_read,
        createdAt: n.created_at,
      })),
    });
  } catch (err) { next(err); }
};

/* GET /api/users/me/notifications — unread notifications + WoF status */
const getNotifications = async (req, res, next) => {
  try {
    const [notifRes, wofRes] = await Promise.all([
      pgPool.query(
        `SELECT id, club_id, title, body, type, is_read, created_at
         FROM member_notifications
         WHERE user_id = $1 AND is_read = false
         ORDER BY created_at DESC LIMIT 15`,
        [req.user.id]
      ),
      pgPool.query(
        `SELECT 1 FROM wall_of_fame
         WHERE LOWER(email) = LOWER($1) AND is_active = true LIMIT 1`,
        [req.user.email]
      ),
    ]);
    res.json({
      isWallOfFamer: wofRes.rows.length > 0,
      notifications: notifRes.rows.map(n => ({
        id:        String(n.id),
        clubId:    n.club_id ? String(n.club_id) : null,
        title:     n.title,
        body:      n.body,
        type:      n.type,
        isRead:    n.is_read,
        createdAt: n.created_at,
      })),
    });
  } catch (err) { next(err); }
};

/* PATCH /api/users/me/notifications/:id/read  — mark a notification read */
const markNotificationRead = async (req, res, next) => {
  try {
    await pgPool.query(
      `UPDATE member_notifications SET is_read = true WHERE id = $1::bigint AND user_id = $2`,
      [req.params.notifId, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
};

/* PUT /api/users/me/profile  (any authenticated user) */
const updateProfile = async (req, res, next) => {
  try {
    const { name } = req.body;
    const updates = []; const vals = []; let i = 1;

    if (name?.trim()) { updates.push(`name = $${i++}`); vals.push(name.trim()); }

    if (req.file) {
      const avatarVal = await uploadAvatarBuffer(req.file);
      updates.push(`avatar = $${i++}`);
      vals.push(avatarVal);
    }

    if (!updates.length) return res.status(400).json({ message: 'Nothing to update.' });

    vals.push(req.user.id);
    const { rows } = await pgPool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${i}
       RETURNING id, email, name, role, avatar, managed_club_id`,
      vals
    );
    const u = rows[0];

    // Bust user session cache
    await cache.del(`session:user:${req.user.id}`);

    // If a coordinator changed their avatar, bust their clubs' cache so the
    // Faculty Coordinator card in the student view updates immediately
    if (req.file && req.user.role === 'coordinator') {
      const { rows: clubRows } = await pgPool.query(
        `SELECT club_id FROM coordinator_club_assignments WHERE user_id = $1 AND is_active = true`,
        [req.user.id]
      );
      await Promise.all(clubRows.map(r => cache.del(`clubs:${r.club_id}`)));
    }

    res.json({ user: { ...u, avatar: u.avatar || '', managedClubId: u.managed_club_id || null } });
  } catch (err) { next(err); }
};

/* PUT /api/users/:id/assign-club  (admin) */
const assignClub = async (req, res, next) => {
  try {
    await ensureSoacTables();

    const { clubId } = req.body;
    const userId = req.params.id;

    const { rows } = await pgPool.query(
      `UPDATE users SET managed_club_id = $1
       WHERE id = $2 AND role = 'coordinator'
       RETURNING id, email, name, role, managed_club_id`,
      [clubId || null, userId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Coordinator not found.' });

    if (clubId) {
      await pgPool.query(
        `UPDATE coordinator_club_assignments
         SET is_active = false, updated_at = NOW()
         WHERE club_id = $1 AND user_id != $2`,
        [clubId, userId]
      );
      await pgPool.query(
        `INSERT INTO coordinator_club_assignments (user_id, club_id, is_active)
         VALUES ($1, $2, true)
         ON CONFLICT (user_id, club_id) DO UPDATE
           SET is_active = true, updated_at = NOW()`,
        [userId, clubId]
      );
    } else {
      await pgPool.query(
        `UPDATE coordinator_club_assignments
         SET is_active = false, updated_at = NOW()
         WHERE user_id = $1`,
        [userId]
      );
    }

    await pgPool.query(
      `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, meta)
       VALUES ($1, $2, 'ASSIGN_CLUB', 'user', $3, $4)`,
      [req.user.id, req.user.name, String(userId), JSON.stringify({ clubId })]
    );
    await cache.del(`session:user:${userId}`);
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
};

module.exports = { getAll, create, update, remove, stats, auditLog, myClubs, updateProfile, assignClub, myCoins, myEventRegistrations, myClubLeaderboards, weeklyEvaluation, getNotifications, markNotificationRead, myActivity };
