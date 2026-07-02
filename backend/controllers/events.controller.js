const { pgPool }   = require('../config/db');
const { ensureSoacTables, asEvent } = require('../services/soacData');
const { getCoordClubIds } = require('../services/coordAuth');
const { destroyImage } = require('../config/cloudinary');
const { getFileValue } = require('../config/multer');
const cache = require('../services/cache');

/* ── Column lists ───────────────────────────────────────────────────────────*/
const EVENT_COLS = [
  'id', 'title', 'club', 'club_id', 'category', 'status', 'date', 'start_date',
  'time', 'venue', 'description', 'image', 'tags', 'seats',
  'highlight', 'registration_url', 'is_free', 'fee_amount',
  'is_active', 'created_at', 'updated_at', 'fixtures_declared',
].join(', ');

(async () => {
  try {
    await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS fixtures_declared BOOLEAN NOT NULL DEFAULT false`);
    await pgPool.query(`ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS gender CHAR(1) DEFAULT NULL`);
    console.log('[events] migrations ready');
  } catch (err) {
    console.error('[events] migration failed:', err.message);
  }
})();

const REG_COLS = [
  'id', 'event_id', 'event_title', 'name', 'enrollment_no',
  'dept', 'course', 'phone', 'email', 'gender', 'registered_at',
].join(', ');

/* idempotent migration */
pgPool.query(`ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS gender CHAR(1) DEFAULT NULL`).catch(() => {});

/* ── Pagination helper ──────────────────────────────────────────────────────*/
const parsePage = (query) => {
  const page  = Math.max(1, parseInt(query.page,  10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
  return { page, limit, offset: (page - 1) * limit };
};

const logAudit = async (userId, userName, action, entityType, entityId, meta = {}) => {
  try {
    await pgPool.query(
      `INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, meta)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, userName, action, entityType, String(entityId), JSON.stringify(meta)]
    );
  } catch (_) {}
};

const imageUrl = (filename) => {
  if (!filename) return '';
  if (filename.startsWith('http')) return filename;          // Cloudinary URL
  if (/^\d{13}-/.test(filename)) return `/uploads/events/${filename}`; // legacy local
  return `/images/${filename}`;                              // seeded asset
};

const withImageUrl = (event) => {
  const obj = { ...event };
  obj._id      = String(obj._id || obj.id);
  obj.imageUrl = imageUrl(obj.image);
  return obj;
};

/* GET /api/events  (public)
   Supports ?page=&limit=&status=&category=&club=&clubId=
   ?clubId= (preferred) filters by club ID via a join — exact, no name-matching issues.
   ?club=   (legacy) filters by club name via ILIKE for backward compatibility.
   COUNT(*) OVER() gives total without a second query.
   Cache-aside: events:<hash> → 60 s */
const getAll = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { status, category, club, clubId } = req.query;
    const { page, limit, offset }            = parsePage(req.query);

    const cacheKey = cache.hashKey('events', { status, category, club, clubId, page, limit });
    const cached   = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const values  = [];
    const clauses = ['e.is_active = true'];

    if (status   && status   !== 'all') { values.push(status);        clauses.push(`e.status   = $${values.length}`); }
    if (category && category !== 'all') { values.push(category);      clauses.push(`e.category = $${values.length}`); }

    // clubId (preferred): filter directly by events.club_id FK
    if (clubId) {
      values.push(clubId);
      clauses.push(`e.club_id = $${values.length}::bigint`);
    } else if (club) {
      // Legacy: filter by club name substring
      values.push(`%${club}%`);
      clauses.push(`e.club ILIKE $${values.length}`);
    }

    values.push(limit, offset);
    const { rows } = await pgPool.query(
      `SELECT ${EVENT_COLS.split(', ').map(c => `e.${c}`).join(', ')}, COUNT(*) OVER() AS total_count
       FROM events e
       WHERE ${clauses.join(' AND ')}
       ORDER BY e.start_date ASC NULLS LAST, e.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    const total  = Number(rows[0]?.total_count ?? 0);
    const result = {
      events:     rows.map((r) => withImageUrl(asEvent(r))),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
    await cache.set(cacheKey, result, cache.TTL.EVENTS_LIST);
    res.json(result);
  } catch (err) { next(err); }
};

/* Shared row → object mapper for public score endpoints */
const mapPublicScore = (r, playByPlay = []) => ({
  id: String(r.id),
  clubId: String(r.club_id),
  clubName: r.club_name,
  clubLogo: r.logo || '',
  sport: r.sport,
  matchTitle: r.match_title || '',
  homeTeam: r.home_team_name || r.club_name || '',
  opponentName: r.opponent_name || '',
  venue: r.venue || '',
  status: r.status,
  gameClock: r.game_clock || '',
  teamScore: Number(r.team_score || 0),
  opponentScore: Number(r.opponent_score || 0),
  scoreData: r.score_data || {},
  stats: r.stats || {},
  homePlayers: r.home_players || [],
  awayPlayers: r.away_players || [],
  timeRemainingSeconds: (() => {
    let remaining = Number(r.time_remaining_seconds || 0);
    if (r.timer_running && r.timer_last_started_at) {
      const elapsed = Math.max(0, Math.floor((Date.now() - new Date(r.timer_last_started_at).getTime()) / 1000));
      remaining = Math.max(0, remaining - elapsed);
    }
    return remaining;
  })(),
  timerRunning: !!r.timer_running,
  scoreByQuarter: (r.score_data || {}).scoreByQuarter || { home: {}, away: {} },
  possession: (r.score_data || {}).possession || 'home',
  shotClock: Number((r.score_data || {}).shotClock ?? 24),
  playerStats: (r.stats || {}).playerStats || { home: {}, away: {} },
  teamFouls: (r.stats || {}).teamFouls || { home: 0, away: 0 },
  timeoutsUsed: (r.stats || {}).timeoutsUsed || { home: 0, away: 0 },
  playByPlay,
  startedAt: r.started_at,
  endedAt: r.ended_at || null,
  updatedAt: r.updated_at,
});

const SCORE_SELECT = `
  ls.id, ls.club_id, ls.sport, ls.match_title, ls.opponent_name, ls.venue,
  ls.status, ls.game_clock, ls.team_score, ls.opponent_score,
  ls.score_data, ls.stats, ls.home_players, ls.away_players,
  ls.time_remaining_seconds, ls.timer_running, ls.timer_last_started_at,
  ls.started_at, ls.ended_at, ls.updated_at,
  c.name AS club_name, c.logo,
  COALESCE(ls.score_data->>'homeTeamName', c.name) AS home_team_name`;

/* GET /api/events/live-scores (public)
   Returns live games + ended games within the past 24 hours. */
const getLiveScores = async (_req, res, next) => {
  try {
    await ensureSoacTables();
    const { rows } = await pgPool.query(
      `SELECT ${SCORE_SELECT}
       FROM club_live_scores ls
       JOIN clubs c ON c.id = ls.club_id
       WHERE ls.status = 'live'
          OR (ls.status = 'ended' AND ls.ended_at >= NOW() - INTERVAL '24 hours')
       ORDER BY ls.started_at DESC NULLS LAST, ls.updated_at DESC`
    );
    const ids = rows.map(r => r.id);
    let eventsByScore = {};
    if (ids.length) {
      const { rows: evRows } = await pgPool.query(
        `SELECT score_id, id, event_type, team_side, player_name, points, game_clock, quarter, created_at
         FROM basketball_game_events
         WHERE score_id = ANY($1::bigint[]) AND is_reverted = false
         ORDER BY created_at DESC, id DESC`,
        [ids]
      );
      eventsByScore = evRows.reduce((acc, ev) => {
        const key = String(ev.score_id);
        if (!acc[key]) acc[key] = [];
        if (acc[key].length < 30) acc[key].push(ev);
        return acc;
      }, {});
    }
    res.json({
      liveScores: rows.map(r => mapPublicScore(r, eventsByScore[String(r.id)] || [])),
    });
  } catch (err) { next(err); }
};

/* GET /api/events/past-scores?sport=&q=&page=&limit= (public)
   All ended games — searchable, filterable, paginated. */
const getPastScores = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { sport, q } = req.query;
    const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const values  = [];
    const clauses = ["ls.status = 'ended'"];

    if (sport && sport !== 'all') {
      values.push(sport.toLowerCase());
      clauses.push(`ls.sport = $${values.length}`);
    }
    if (q && q.trim()) {
      values.push(`%${q.trim()}%`);
      const n = values.length;
      clauses.push(`(ls.match_title ILIKE $${n} OR ls.opponent_name ILIKE $${n} OR c.name ILIKE $${n})`);
    }

    values.push(limit, offset);
    const { rows } = await pgPool.query(
      `SELECT ${SCORE_SELECT}, COUNT(*) OVER() AS total_count
       FROM club_live_scores ls
       JOIN clubs c ON c.id = ls.club_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY COALESCE(ls.ended_at, ls.updated_at) DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    res.json({
      pastScores: rows.map(r => mapPublicScore(r)),
      total: rows.length ? Number(rows[0].total_count) : 0,
      page,
      limit,
    });
  } catch (err) { next(err); }
};

/* GET /api/events/:id  (public)
   Cache-aside: events:<id> → 120 s */
const getOne = async (req, res, next) => {
  try {
    const cacheKey = `events:${req.params.id}`;
    const cached   = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const { rows } = await pgPool.query(
      `SELECT ${EVENT_COLS} FROM events WHERE id = $1 AND is_active = true`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Event not found.' });

    const result = { event: withImageUrl(asEvent(rows[0])) };
    await cache.set(cacheKey, result, cache.TTL.EVENT);
    res.json(result);
  } catch (err) { next(err); }
};

/* POST /api/events  (admin/coordinator) */
const create = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const {
      title, clubId, category, status, date, startDate, time, venue,
      description, tags, seats, highlight, registrationUrl,
      isFree, feeAmount,
    } = req.body;

    // Resolve club name from clubId (if provided); SOAC if blank
    let clubName = '';
    let resolvedClubId = null;
    if (clubId) {
      const { rows: clubRows } = await pgPool.query(
        'SELECT id, name FROM clubs WHERE id = $1 AND is_active = true',
        [clubId]
      );
      if (clubRows[0]) { resolvedClubId = clubRows[0].id; clubName = clubRows[0].name; }
    }

    const image   = getFileValue(req.file) ?? '';
    const is_free = isFree === 'false' || isFree === false ? false : true;
    const { rows } = await pgPool.query(
      `INSERT INTO events
       (title, club, club_id, category, status, date, start_date, time, venue,
        description, image, tags, seats, highlight, registration_url, is_free, fee_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING ${EVENT_COLS}`,
      [
        title, clubName, resolvedClubId, category || 'general', status || 'upcoming', date || '',
        startDate ? new Date(startDate) : null, time || '', venue || '', description || '', image,
        tags ? JSON.parse(tags) : [], seats || '', highlight || '', registrationUrl || '',
        is_free, is_free ? 0 : Number(feeAmount) || 0,
      ]
    );
    const event = asEvent(rows[0]);
    await logAudit(req.user.id, req.user.name, 'CREATE_EVENT', 'event', event.id, { title });
    await Promise.all([cache.delPattern('events:*'), cache.del('stats:admin')]);
    res.status(201).json({ event: withImageUrl(event) });
  } catch (err) { next(err); }
};

/* PUT /api/events/:id  (admin/coordinator) */
const update = async (req, res, next) => {
  try {
    const { rows: cur } = await pgPool.query(
      `SELECT id, image, title, club, category, status, date, time, venue, description, seats, highlight, is_free, fee_amount FROM events WHERE id = $1`,
      [req.params.id]
    );
    if (!cur.length) return res.status(404).json({ message: 'Event not found.' });
    if (req.file) await destroyImage(cur[0].image);

    // Resolve club assignment: use clubId FK if provided, else fall back to club text field
    let newClubName = req.body.club ?? null;
    let updateClubId = false;
    let newClubId = null;
    if (req.body.clubId !== undefined) {
      updateClubId = true;
      if (req.body.clubId) {
        const { rows: clubRows } = await pgPool.query(
          'SELECT id, name FROM clubs WHERE id = $1 AND is_active = true',
          [req.body.clubId]
        );
        if (clubRows[0]) { newClubId = clubRows[0].id; newClubName = clubRows[0].name; }
      } else {
        newClubId = null;  // SOAC / no specific club
        newClubName = '';
      }
    }

    const isFreeRaw = req.body.isFree;
    const is_free   = isFreeRaw === undefined ? undefined
                    : isFreeRaw === 'false' || isFreeRaw === false ? false : true;

    const { rows } = await pgPool.query(
      `UPDATE events
       SET title            = COALESCE($1,  title),
           club             = COALESCE($2,  club),
           club_id          = CASE WHEN $3::boolean THEN $4::bigint ELSE club_id END,
           category         = COALESCE($5,  category),
           status           = COALESCE($6,  status),
           date             = COALESCE($7,  date),
           start_date       = COALESCE($8,  start_date),
           time             = COALESCE($9,  time),
           venue            = COALESCE($10, venue),
           description      = COALESCE($11, description),
           seats            = COALESCE($12, seats),
           highlight        = COALESCE($13, highlight),
           registration_url = COALESCE($14, registration_url),
           tags             = COALESCE($15, tags),
           image            = $16,
           is_free          = COALESCE($17, is_free),
           fee_amount       = COALESCE($18, fee_amount),
           updated_at       = NOW()
       WHERE id = $19
       RETURNING ${EVENT_COLS}`,
      [
        req.body.title        ?? null,   // $1
        newClubName,                      // $2
        updateClubId,                     // $3 boolean: should we write club_id?
        newClubId,                        // $4 new club_id value (null = SOAC)
        req.body.category     ?? null,   // $5
        req.body.status       ?? null,   // $6
        req.body.date         ?? null,   // $7
        req.body.startDate ? new Date(req.body.startDate) : null,  // $8
        req.body.time         ?? null,   // $9
        req.body.venue        ?? null,   // $10
        req.body.description  ?? null,   // $11
        req.body.seats        ?? null,   // $12
        req.body.highlight    ?? null,   // $13
        req.body.registrationUrl ?? null, // $14
        req.body.tags ? JSON.parse(req.body.tags) : null,  // $15
        req.file ? getFileValue(req.file) : cur[0].image,  // $16
        is_free   ?? null,               // $17
        is_free === undefined ? null : (is_free ? 0 : Number(req.body.feeAmount) || 0),  // $18
        req.params.id,                   // $19
      ]
    );
    const event = asEvent(rows[0]);

    /* Build before/after diff for the audit trail */
    const evChanges = [];
    const evLabels = {
      title: 'Title', club: 'Club', category: 'Category', status: 'Status',
      date: 'Date', time: 'Time', venue: 'Venue', description: 'Description',
      seats: 'Seats', highlight: 'Highlight', is_free: 'Free Entry', fee_amount: 'Fee',
    };
    const evCandidates = {
      title:       req.body.title       !== undefined ? req.body.title       : undefined,
      club:        req.body.club        !== undefined ? req.body.club        : undefined,
      category:    req.body.category    !== undefined ? req.body.category    : undefined,
      status:      req.body.status      !== undefined ? req.body.status      : undefined,
      date:        req.body.date        !== undefined ? req.body.date        : undefined,
      time:        req.body.time        !== undefined ? req.body.time        : undefined,
      venue:       req.body.venue       !== undefined ? req.body.venue       : undefined,
      description: req.body.description !== undefined ? req.body.description : undefined,
      seats:       req.body.seats       !== undefined ? req.body.seats       : undefined,
      highlight:   req.body.highlight   !== undefined ? req.body.highlight   : undefined,
      is_free:     req.body.isFree      !== undefined ? String(req.body.isFree !== 'false' && req.body.isFree !== false) : undefined,
      fee_amount:  req.body.feeAmount   !== undefined ? String(req.body.feeAmount) : undefined,
    };
    for (const [key, newVal] of Object.entries(evCandidates)) {
      if (newVal === undefined) continue;
      const oldStr = String(cur[0][key] ?? '');
      const newStr = String(newVal ?? '');
      if (oldStr !== newStr) evChanges.push({ field: evLabels[key] || key, from: oldStr, to: newStr });
    }
    if (req.file) evChanges.push({ field: 'Image', from: null, to: 'updated' });

    await logAudit(req.user.id, req.user.name, 'UPDATE_EVENT', 'event', event.id, { title: event.title, changes: evChanges });
    await Promise.all([cache.del(`events:${req.params.id}`), cache.delPattern('events:*')]);
    res.json({ event: withImageUrl(event) });
  } catch (err) { next(err); }
};

/* DELETE /api/events/:id  (admin — soft delete) */
const remove = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `UPDATE events SET is_active = false WHERE id = $1 RETURNING id, title`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Event not found.' });
    await logAudit(req.user.id, req.user.name, 'DELETE_EVENT', 'event', rows[0].id, { title: rows[0].title });
    await Promise.all([
      cache.del(`events:${req.params.id}`),
      cache.delPattern('events:*'),
      cache.del('stats:admin'),
    ]);
    res.json({ message: 'Event removed successfully.' });
  } catch (err) { next(err); }
};

/* POST /api/events/:id/register  (public) */
const register = async (req, res, next) => {
  try {
    /* Only fetch what we need: id, title, status */
    const { rows: eventRows } = await pgPool.query(
      `SELECT id, title, status FROM events WHERE id = $1 AND is_active = true`,
      [req.params.id]
    );
    if (!eventRows.length) return res.status(404).json({ message: 'Event not found.' });
    const event = eventRows[0];
    if (event.status === 'past') return res.status(400).json({ message: 'Registrations for this event are closed.' });

    const { name, email, phone, enrollmentNo, dept, course, gender } = req.body;
    if (!name?.trim())   return res.status(400).json({ message: 'Name is required.' });
    if (!email?.trim())  return res.status(400).json({ message: 'Email is required.' });
    if (!dept?.trim())   return res.status(400).json({ message: 'Department is required.' });
    if (!course?.trim()) return res.status(400).json({ message: 'Course is required.' });
    if (!gender || !['M', 'F'].includes(gender.toUpperCase())) {
      return res.status(400).json({ message: 'Gender is required. Please select M or F.' });
    }

    const { rows } = await pgPool.query(
      `INSERT INTO event_registrations
       (event_id, event_title, name, enrollment_no, dept, course, phone, email, gender)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING ${REG_COLS}`,
      [
        event.id, event.title, name.trim(),
        enrollmentNo ? enrollmentNo.trim().toUpperCase() : '',
        dept.trim(), course.trim(),
        phone ? phone.trim() : '',
        email.trim().toLowerCase(),
        gender.toUpperCase(),
      ]
    );
    await cache.del(`events:${req.params.id}`);
    res.status(201).json({ message: 'Registration successful!', registration: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'You have already registered for this event.' });
    }
    next(err);
  }
};

/* GET /api/events/:id/registrations  (admin or coordinator for their own club's event)
   Supports ?page=&limit= */
const listRegistrations = async (req, res, next) => {
  try {
    // Coordinators may only view registrations for events belonging to their assigned clubs
    if (req.user.role === 'coordinator') {
      // Get all clubs this coordinator manages (with name-based fallback)
      const coordClubIds = await getCoordClubIds(req.user.id);
      if (!coordClubIds.length) {
        return res.status(403).json({ message: 'No club assigned to your coordinator account.' });
      }
      // Check if the event belongs to any of the coordinator's clubs via club_id FK
      const { rows: evRows } = await pgPool.query(
        `SELECT e.id FROM events e
         WHERE e.id = $1 AND e.is_active = true AND e.club_id = ANY($2::bigint[])`,
        [req.params.id, coordClubIds]
      );
      if (!evRows.length) return res.status(403).json({ message: 'You can only view registrations for your own club\'s events.' });
    }

    const { page, limit, offset } = parsePage(req.query);
    const { rows } = await pgPool.query(
      `SELECT ${REG_COLS}, COUNT(*) OVER() AS total_count
       FROM event_registrations
       WHERE event_id = $1
       ORDER BY registered_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    );
    const total = Number(rows[0]?.total_count ?? 0);
    res.json({
      count:         total,
      registrations: rows.map(({ total_count, ...r }) => r),
      pagination:    { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
};

module.exports = { getAll, getLiveScores, getPastScores, getOne, create, update, remove, register, listRegistrations };
