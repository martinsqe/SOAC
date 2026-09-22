const { pgPool }   = require('../config/db');
const { ensureSoacTables, asEvent } = require('../services/soacData');
const { assertCoordOwnsEvent } = require('../services/coordAuth');
const { destroyImage } = require('../config/cloudinary');
const { getFileValue, uploadImageBuffer } = require('../config/multer');
const { autoRefreshReportIfExists } = require('./reports.controller');
const { notifyUser, notifyManyUsers } = require('../services/notify');
const { sendGaloreActivityAssignment } = require('../config/email');
const cache = require('../services/cache');
const { syncPastEvents } = require('../services/eventStatus');

/* ── Column lists ───────────────────────────────────────────────────────────*/
const EVENT_COLS = [
  'id', 'title', 'club', 'club_id', 'category', 'status', 'date', 'start_date',
  'time', 'venue', 'description', 'image', 'tags', 'seats',
  'highlight', 'registration_url', 'is_free', 'fee_amount',
  'is_active', 'created_at', 'updated_at', 'fixtures_declared',
  'certificates_finalized_at',
  'event_format', 'captain_name', 'captain_email', 'captain_phone',
  'team_members', 'payment_link', 'team_size', 'min_team_size',
  'parent_event_id',
].join(', ');

/* Galore: every department competing this year. Matches the DEPTS list already
   duplicated in frontend/src/pages/Events/Events.jsx, StudentEvents.jsx, and
   JoinModal.jsx (the app's existing, real department taxonomy — individual
   registration already offers this exact list as a dropdown) rather than a
   separate/narrower one, so Galore validation never rejects a real department.
   A fixed, hand-maintained list (not a DB table) — no admin CRUD need for it
   yet, and adding one later is a small, isolated change if that ever changes.
   Only enforced (see assertGaloreCategoryCap / dept validation below) for
   events that hang off a Galore umbrella via parent_event_id — every
   pre-existing event keeps accepting free-text dept exactly as before. */
const GALORE_DEPARTMENTS = ['ACH', 'AI/ML', 'FOT', 'SDS', 'SOE', 'SPT', 'SOP', 'SOM', 'SOS'];

/* Galore: every activity is pre-programmed — admin's only job per activity is
   assigning who coordinates it (see createGaloreEvent below), not building it
   from scratch. A fixed catalog (not a DB table, same reasoning as
   GALORE_DEPARTMENTS) of every activity this fest runs, one row per activity:
   its category (drives the boys/girls-vs-open division rule and which of
   Sports/Cultural/Academic tab it lands under), and whether it's team-based
   (reuses the Sports Fiesta captain/roster flow) or individual (reuses the
   plain public register() flow), plus a sane roster-size range for team ones. */
const GALORE_ACTIVITIES_CATALOG = [
  { key: 'football',        title: 'Football',        category: 'sports',   participationType: 'team',       minTeamSize: 7,  teamSize: 15 },
  { key: 'basketball',      title: 'Basketball',      category: 'sports',   participationType: 'team',       minTeamSize: 5,  teamSize: 10 },
  { key: 'cricket',         title: 'Cricket',         category: 'sports',   participationType: 'team',       minTeamSize: 11, teamSize: 16 },
  { key: 'volleyball',      title: 'Volleyball',      category: 'sports',   participationType: 'team',       minTeamSize: 6,  teamSize: 12 },
  { key: 'table_tennis',    title: 'Table Tennis',    category: 'sports',   participationType: 'individual' },
  { key: 'carrom',          title: 'Carrom',          category: 'sports',   participationType: 'individual' },
  { key: 'chess',           title: 'Chess',           category: 'sports',   participationType: 'individual' },
  { key: 'badminton',       title: 'Badminton',       category: 'sports',   participationType: 'individual' },
  { key: 'group_dancing',   title: 'Group Dancing',   category: 'cultural', participationType: 'team',       minTeamSize: 4,  teamSize: 15 },
  { key: 'fashion',         title: 'Fashion',         category: 'cultural', participationType: 'team',       minTeamSize: 4,  teamSize: 15 },
  { key: 'singing',         title: 'Singing',         category: 'cultural', participationType: 'individual' },
  { key: 'public_speaking', title: 'Public Speaking', category: 'academic', participationType: 'individual' },
];

/* team_members is a jsonb column, so its INSERT/UPDATE param must be a valid
   JSON *string* — re-stringifying (rather than passing the parsed array) keeps
   this safe from node-pg's array-literal serialization of raw JS arrays. */
function toTeamMembersJson(raw) {
  if (!raw) return '[]';
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(Array.isArray(parsed) ? parsed : []);
  } catch {
    return '[]';
  }
}

/* Whoever pastes a payment link may leave off the scheme (e.g. "pay.example.com/x")
   — without one, an <a href> treats it as a relative path on our own site instead
   of navigating out to the actual payment page. Default to https:// so any link
   the admin adds always redirects straight there. */
function normalizePaymentLink(raw) {
  const link = String(raw || '').trim();
  if (!link) return '';
  return /^https?:\/\//i.test(link) ? link : `https://${link}`;
}

(async () => {
  try {
    await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS fixtures_declared BOOLEAN NOT NULL DEFAULT false`);
    await pgPool.query(`ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS gender CHAR(1) DEFAULT NULL`);
    /* event_format drives the 3 admin creation tabs (Other Events / Sports Fiesta /
       Galore) — a distinct dimension from `category` (sports/cultural/academic/...),
       which existing sports-specific features (Teams, Fixtures, Scoreboard, cert
       sport-detection) already key off. Every pre-existing event defaults to
       'other', so it keeps showing under the Other Events tab exactly as before.
       The captain/team/payment-link columns are only ever populated for
       'sports_fiesta' events; left null/empty for every other format. */
    await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS event_format VARCHAR(20) NOT NULL DEFAULT 'other'`);
    await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS captain_name VARCHAR(255) NOT NULL DEFAULT ''`);
    await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS captain_email VARCHAR(255) NOT NULL DEFAULT ''`);
    await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS captain_phone VARCHAR(20) NOT NULL DEFAULT ''`);
    await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS team_members JSONB NOT NULL DEFAULT '[]'`);
    await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS payment_link VARCHAR(500) NOT NULL DEFAULT ''`);
    /* team_size (max) and min_team_size (min) are the roster-size bounds the
       admin sets at creation time — the guest-facing team-roster form
       (captain fills in member names) enforces both client- and server-side.
       team_members starts empty and is filled in later from there. */
    await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS team_size INTEGER NOT NULL DEFAULT 0`);
    await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS min_team_size INTEGER NOT NULL DEFAULT 0`);
    /* Galore: a child activity event (Football, Chess, Public Speaking, ...) points
       back at its umbrella Galore event via parent_event_id. NULL for every normal
       event — Sports Fiesta/Other Events/Galore umbrellas themselves are all still
       top-level (no parent). Deleting the umbrella cascades to its activities. */
    await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS parent_event_id BIGINT REFERENCES events(id) ON DELETE CASCADE`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_events_parent ON events(parent_event_id)`);
    /* The department a team represents — only meaningful for teams registered
       under a Galore child activity (see submitTeamRoster). Free text elsewhere,
       same as event_registrations.dept always has been. */
    await pgPool.query(`ALTER TABLE event_teams ADD COLUMN IF NOT EXISTS dept VARCHAR(10) NOT NULL DEFAULT ''`);
    /* Galore: direct coordinator-to-activity assignment ("the Football
       coordinator") — independent of the club-based model every other event
       uses. See coordAuth.js's assertCoordOwnsEvent, which checks this table
       first and falls back to club ownership, so every existing per-event
       controller's checkAccess gained Galore support with no other change. */
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS event_coordinators (
        id          BIGSERIAL     PRIMARY KEY,
        event_id    BIGINT        NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        user_id     INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        UNIQUE (event_id, user_id)
      )
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_event_coordinators_event ON event_coordinators(event_id)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_event_coordinators_user  ON event_coordinators(user_id)`);
    console.log('[events] migrations ready');
  } catch (err) {
    console.error('[events] migration failed:', err.message);
  }
})();

const REG_COLS = [
  'id', 'event_id', 'event_title', 'name', 'enrollment_no',
  'dept', 'course', 'phone', 'email', 'gender', 'registered_at',
].join(', ');

const RKU_DOMAIN = '@rku.ac.in';
/* Accepts an optional +91/91 prefix and spaces/dashes, but the underlying number must be exactly 10 digits */
const isValidMobile = (phone) => /^\d{10}$/.test(String(phone || '').replace(/[\s-]/g, '').replace(/^(\+?91)/, ''));

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
    await syncPastEvents();
    const { status, category, club, clubId } = req.query;
    const { page, limit, offset }            = parsePage(req.query);

    const cacheKey = cache.hashKey('events', { status, category, club, clubId, page, limit });
    const cached   = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const values  = [];
    /* A Galore activity (parent_event_id set) is never its own standalone
       listing — it only ever shows up nested inside its umbrella's own
       registration form / the admin's "Manage Activities" panel. Without this,
       every activity would leak into the general events list as its own
       separately-registerable card, right alongside the umbrella itself. */
    const clauses = ['e.is_active = true', 'e.parent_event_id IS NULL'];

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
  COALESCE(NULLIF(ls.home_team, ''), c.name) AS home_team_name`;

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
    await syncPastEvents();
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

/* GET /api/events/:id/activities  (public — Galore umbrella's child activities)
   Powers the admin "manage activities" panel and the public Galore event page:
   every activity event underneath this umbrella, with a quick registration/team
   count so the list is useful without opening each one. */
const getActivities = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT e.id, e.title, e.category, e.event_format,
              e.team_size, e.min_team_size, e.status,
              (SELECT COUNT(*)::int FROM event_registrations er WHERE er.event_id = e.id) AS registration_count,
              (SELECT COUNT(*)::int FROM event_teams et WHERE et.event_id = e.id) AS team_count
       FROM events e
       WHERE e.parent_event_id = $1 AND e.is_active = true
       ORDER BY e.category, e.title`,
      [req.params.id]
    );
    res.json({
      activities: rows.map(r => ({
        id:                String(r.id),
        _id:               String(r.id), // matches the shape every other event object has (see asEvent)
        title:             r.title,
        category:          r.category,
        eventFormat:       r.event_format,
        /* Every Galore activity registers individually now (event_format is
           always 'other') — team_size > 0 is what actually marks a team-based
           activity (the coordinator's later cue to build teams from the
           registrant pool), not event_format anymore. */
        participationType: Number(r.team_size || 0) > 0 ? 'team' : 'individual',
        teamSize:          Number(r.team_size || 0),
        minTeamSize:       Number(r.min_team_size || 0),
        status:            r.status,
        registrationCount: r.registration_count,
        teamCount:         r.team_count,
      })),
    });
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
      eventFormat, teamSize, minTeamSize, paymentLink, parentEventId,
    } = req.body;

    const format = ['sports_fiesta', 'galore'].includes(eventFormat) ? eventFormat : 'other';

    /* A Galore activity (parentEventId set) must point at a real Galore umbrella —
       checked up front so a bad id fails clearly instead of silently orphaning. */
    let resolvedParentEventId = null;
    if (parentEventId) {
      const { rows: parentRows } = await pgPool.query(
        `SELECT id FROM events WHERE id = $1 AND is_active = true AND event_format = 'galore'`,
        [parentEventId]
      );
      if (!parentRows.length) return res.status(400).json({ message: 'Galore event not found.' });
      resolvedParentEventId = parentRows[0].id;
    }

    /* Sports Fiesta events are created with just a roster-size range (the
       admin's call) and a payment link — the captain fills in their own
       contact details plus the team member names later, via the public
       event page's team-roster form, so captain_* and team_members always
       start blank/empty here regardless of what's posted. */
    let minSize = 0, maxSize = 0;
    if (format === 'sports_fiesta') {
      maxSize = Number(teamSize);
      minSize = Number(minTeamSize);
      if (!maxSize || maxSize < 1) return res.status(400).json({ message: 'Maximum number of players is required.' });
      if (!minSize || minSize < 1) return res.status(400).json({ message: 'Minimum number of players is required.' });
      if (minSize > maxSize) return res.status(400).json({ message: 'Minimum number of players cannot be greater than the maximum.' });
    }

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
    /* Sports Fiesta events default to category 'sports' even if the caller
       omits it — that's what turns on the existing Teams/Fixtures/Scoreboard
       tabs and sport-detection for certificates elsewhere in the app. */
    const resolvedCategory = category || (format === 'sports_fiesta' ? 'sports' : 'general');
    const { rows } = await pgPool.query(
      `INSERT INTO events
       (title, club, club_id, category, status, date, start_date, time, venue,
        description, image, tags, seats, highlight, registration_url, is_free, fee_amount,
        event_format, captain_name, captain_email, captain_phone, team_members, payment_link, team_size, min_team_size,
        parent_event_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
       RETURNING ${EVENT_COLS}`,
      [
        title, clubName, resolvedClubId, resolvedCategory, status || 'upcoming', date || '',
        startDate ? new Date(startDate) : null, time || '', venue || '', description || '', image,
        tags ? JSON.parse(tags) : [], seats || '', highlight || '', registrationUrl || '',
        is_free, is_free ? 0 : Number(feeAmount) || 0,
        /* captain_* and team_members always start blank/empty — the captain
           fills all of it in later via the public event page's team-roster
           form (see submitTeamRoster below), bounded by the admin's min/max. */
        format, '', '', '',
        '[]', normalizePaymentLink(paymentLink), maxSize, minSize,
        resolvedParentEventId,
      ]
    );
    const event = asEvent(rows[0]);
    await logAudit(req.user.id, req.user.name, 'CREATE_EVENT', 'event', event.id, { title });
    await Promise.all([cache.delPattern('events:*'), cache.del('stats:admin')]);
    res.status(201).json({ event: withImageUrl(event) });

    /* Notify students a new event was posted — fire-and-forget, after the
       response, so a large club/SOAC-wide fan-out never delays the creator's
       own confirmation. Club-scoped events notify only that club's active
       members; general/SOAC events (no clubId) notify every active student. */
    const notifTitle = 'New event posted';
    const notifBody  = `${clubName || 'SOAC'} posted a new event: "${event.title}".`;
    const notifUrl   = `/student/events/${event.id}`;
    if (resolvedClubId) {
      pgPool.query(
        `SELECT u.id FROM student_clubs sc
         JOIN users u ON u.id = sc.user_id AND u.is_active = true
         WHERE sc.club_id = $1::bigint AND sc.is_active = true`,
        [resolvedClubId]
      ).then(({ rows: members }) => {
        if (!members.length) return;
        notifyManyUsers({
          userIds: members.map(m => m.id),
          clubId:  resolvedClubId,
          title:   notifTitle,
          body:    notifBody,
          type:    'event',
          url:     notifUrl,
        });
      }).catch(() => {});
    } else {
      pgPool.query(`SELECT id FROM users WHERE role = 'student' AND is_active = true`)
        .then(({ rows: students }) => {
          if (!students.length) return;
          notifyManyUsers({
            userIds: students.map(s => s.id),
            title:   notifTitle,
            body:    notifBody,
            type:    'event',
            url:     notifUrl,
          });
        }).catch(() => {});
    }
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
    /* A past event's own details (title/date/venue/fee/...) are locked once
       it's over — coordinators can't touch it at all; admin keeps a narrow
       escape hatch for genuine corrections (a typo noticed after the fact,
       or manually reopening one). This is separate from — and doesn't
       affect — Teams/Groups/Fixtures/Attendance/Report/Certifications,
       which stay open regardless of status since that's exactly the
       post-event work coordinators still need to do. */
    if (cur[0].status === 'past' && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'This event is past and its details can no longer be edited.' });
    }
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
           captain_name     = COALESCE($19, captain_name),
           captain_email    = COALESCE($20, captain_email),
           captain_phone    = COALESCE($21, captain_phone),
           team_members     = COALESCE($22, team_members),
           payment_link     = COALESCE($23, payment_link),
           team_size        = COALESCE($24, team_size),
           min_team_size    = COALESCE($25, min_team_size),
           updated_at       = NOW()
       WHERE id = $26
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
        req.body.captainName  ?? null,   // $19
        req.body.captainEmail ?? null,   // $20
        req.body.captainPhone ?? null,   // $21
        req.body.teamMembers ? toTeamMembersJson(req.body.teamMembers) : null,  // $22
        req.body.paymentLink !== undefined ? normalizePaymentLink(req.body.paymentLink) : null,   // $23
        req.body.teamSize !== undefined ? Number(req.body.teamSize) || 0 : null,  // $24
        req.body.minTeamSize !== undefined ? Number(req.body.minTeamSize) || 0 : null,  // $25
        req.params.id,                   // $26
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

/* Sends the actual "you're registered" confirmation — fires on EVERY successful
   registration. Registration doesn't require an account, so this
   silently no-ops if the email doesn't match an active user. */
async function notifyRegistrationConfirmed(event, email) {
  try {
    const { rows: userRows } = await pgPool.query(
      `SELECT id FROM users WHERE LOWER(email) = $1 AND is_active = true LIMIT 1`, [email]
    );
    if (!userRows.length) return;
    await notifyUser({
      userId: userRows[0].id, clubId: null,
      title: 'Registration confirmed',
      body:  `You're registered for "${event.title}". See you there!`,
      type:  'registration',
      url:   `/student/events/${event.id}`,
    });
  } catch (e) {
    console.error('[notify] notifyRegistrationConfirmed error:', e.message);
  }
}

/* POST /api/events/:id/register  (public) */
/* Galore: caps how many activities of the SAME category (sports/cultural/academic)
   a student can register for under one Galore umbrella — counted across the event
   being registered for right now plus every sibling activity event under the same
   parent_event_id. A no-op (returns null = fine) for any event that isn't part of
   a Galore umbrella, so every pre-existing event/registration flow is unaffected. */
const assertGaloreCategoryCap = async (email, event) => {
  if (!event.parent_event_id) return null;
  const { rows: siblingRows } = await pgPool.query(
    `SELECT id FROM events WHERE parent_event_id = $1 AND category = $2`,
    [event.parent_event_id, event.category]
  );
  const siblingIds = siblingRows.map(r => r.id);
  if (!siblingIds.length) return null;
  const { rows: regRows } = await pgPool.query(
    `SELECT DISTINCT event_id FROM event_registrations WHERE event_id = ANY($1::bigint[]) AND LOWER(email) = $2`,
    [siblingIds, email.toLowerCase()]
  );
  const alreadyIn = new Set(regRows.map(r => String(r.event_id)));
  if (alreadyIn.has(String(event.id))) return null; // re-submitting the same one — let the normal duplicate check handle it
  if (alreadyIn.size >= 2) {
    return `You've already registered for 2 ${event.category} events in Galore — that's the limit per category.`;
  }
  return null;
};

/* POST /api/events/:id/register  where :id is a Galore UMBRELLA event.
   One unified form: a student gives their details once and picks which
   activities (any mix, across categories, up to 2 per category) they want
   to join — no separate per-activity form, and no self-service team/captain
   flow. Each selected activity gets its own event_registrations row with
   the same student details; a coordinator later groups each activity's
   department-wise registrants into teams themselves (Teams tab), for the
   team-based ones. */
const registerForGaloreUmbrella = async (umbrella, req, res) => {
  const { name, email, phone, enrollmentNo, dept, course, gender, activityIds } = req.body;
  if (!name?.trim())   return res.status(400).json({ message: 'Name is required.' });
  if (!email?.trim())  return res.status(400).json({ message: 'Email is required.' });
  if (!email.toLowerCase().endsWith(RKU_DOMAIN)) {
    return res.status(400).json({ message: 'Only RKU institutional emails (@rku.ac.in) are allowed to register.' });
  }
  if (!dept?.trim() || !GALORE_DEPARTMENTS.includes(dept.trim().toUpperCase())) {
    return res.status(400).json({ message: `Department must be one of: ${GALORE_DEPARTMENTS.join(', ')}.` });
  }
  if (!course?.trim()) return res.status(400).json({ message: 'Course is required.' });
  if (!phone?.trim())  return res.status(400).json({ message: 'Mobile number is required.' });
  if (!isValidMobile(phone)) return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
  if (!gender || !['M', 'F'].includes(gender.toUpperCase())) {
    return res.status(400).json({ message: 'Gender is required. Please select M or F.' });
  }
  const ids = Array.isArray(activityIds) ? [...new Set(activityIds.map(String))] : [];
  if (!ids.length) return res.status(400).json({ message: 'Select at least one activity.' });

  const { rows: actRows } = await pgPool.query(
    `SELECT id, title, category FROM events WHERE id = ANY($1::bigint[]) AND parent_event_id = $2 AND is_active = true`,
    [ids, umbrella.id]
  );
  if (actRows.length !== ids.length) {
    return res.status(400).json({ message: 'One or more selected activities are invalid.' });
  }

  const emailNorm = email.trim().toLowerCase();
  const { rows: existingRegs } = await pgPool.query(
    `SELECT e.id AS event_id, e.category FROM event_registrations er
     JOIN events e ON e.id = er.event_id
     WHERE e.parent_event_id = $1 AND LOWER(er.email) = $2`,
    [umbrella.id, emailNorm]
  );
  const alreadyRegisteredIds = new Set(existingRegs.map(r => String(r.event_id)));
  const existingByCat = {};
  for (const r of existingRegs) existingByCat[r.category] = (existingByCat[r.category] || 0) + 1;

  /* Only activities this email isn't already registered for count as "new" against
     the cap — resubmitting one already on file (e.g. the form was submitted twice,
     or this batch mixes a couple of old picks with a new one) is harmless, not an
     attempt to exceed the limit; it just gets silently skipped down in the insert
     loop via the (event_id, email) unique constraint. */
  const newActs = actRows.filter(a => !alreadyRegisteredIds.has(String(a.id)));
  const newByCat = {};
  for (const a of newActs) newByCat[a.category] = (newByCat[a.category] || 0) + 1;
  for (const [cat, n] of Object.entries(newByCat)) {
    const already = existingByCat[cat] || 0;
    if (already + n > 2) {
      const message = already > 0
        ? `You've already registered for ${already} ${cat} activit${already === 1 ? 'y' : 'ies'} — 2 is the limit per category, so you can pick at most ${2 - already} more.`
        : `You can select at most 2 ${cat} activities.`;
      return res.status(400).json({ message });
    }
  }

  const deptUpper = dept.trim().toUpperCase();
  const pgClient = await pgPool.connect();
  try {
    await pgClient.query('BEGIN');
    const created = [];
    const skipped = [];
    for (const act of actRows) {
      /* A per-row SAVEPOINT is required here: once any statement inside a
         transaction errors, Postgres aborts the whole transaction and every
         later statement fails with 25P02 ("current transaction is aborted")
         until a ROLLBACK — so catching just the 23505 and looping to the next
         activity would silently break every insert after the first duplicate. */
      await pgClient.query('SAVEPOINT act_reg');
      try {
        await pgClient.query(
          `INSERT INTO event_registrations (event_id, event_title, name, enrollment_no, dept, course, phone, email, gender)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            act.id, act.title, name.trim(),
            enrollmentNo ? enrollmentNo.trim().toUpperCase() : '',
            deptUpper, course.trim(), phone.trim(), emailNorm, gender.toUpperCase(),
          ]
        );
        created.push(act.title);
      } catch (err) {
        if (err.code === '23505') {
          await pgClient.query('ROLLBACK TO SAVEPOINT act_reg');
          skipped.push(act.title); // already registered for this one
          continue;
        }
        throw err;
      }
    }
    await pgClient.query('COMMIT');
    await cache.delPattern('events:*');
    const notifyOne = actRows.find(a => created.includes(a.title));
    if (notifyOne) {
      notifyRegistrationConfirmed({ id: umbrella.id, title: umbrella.title }, emailNorm).catch(() => {});
    }
    res.status(201).json({
      message: skipped.length ? `Registered for ${created.length} activit${created.length === 1 ? 'y' : 'ies'}; already registered for: ${skipped.join(', ')}.` : 'Registered!',
      created, skipped,
    });
  } catch (err) {
    await pgClient.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    pgClient.release();
  }
};

const register = async (req, res, next) => {
  try {
    /* Only fetch what we need: id, title, status, category, event_format + parent_event_id */
    const { rows: eventRows } = await pgPool.query(
      `SELECT id, title, status, category, event_format, parent_event_id FROM events WHERE id = $1 AND is_active = true`,
      [req.params.id]
    );
    if (!eventRows.length) return res.status(404).json({ message: 'Event not found.' });
    const event = eventRows[0];
    if (event.status === 'past') return res.status(400).json({ message: 'Registrations for this event are closed.' });

    if (event.event_format === 'galore' && !event.parent_event_id) {
      return await registerForGaloreUmbrella(event, req, res);
    }

    const { name, email, phone, enrollmentNo, dept, course, gender } = req.body;
    if (!name?.trim())   return res.status(400).json({ message: 'Name is required.' });
    if (!email?.trim())  return res.status(400).json({ message: 'Email is required.' });
    if (!email.toLowerCase().endsWith(RKU_DOMAIN)) {
      return res.status(400).json({ message: 'Only RKU institutional emails (@rku.ac.in) are allowed to register.' });
    }
    if (!dept?.trim())   return res.status(400).json({ message: 'Department is required.' });
    if (event.parent_event_id && !GALORE_DEPARTMENTS.includes(dept.trim().toUpperCase())) {
      return res.status(400).json({ message: `Department must be one of: ${GALORE_DEPARTMENTS.join(', ')}.` });
    }
    if (!course?.trim()) return res.status(400).json({ message: 'Course is required.' });
    if (!phone?.trim())  return res.status(400).json({ message: 'Mobile number is required.' });
    if (!isValidMobile(phone)) {
      return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
    }
    if (!gender || !['M', 'F'].includes(gender.toUpperCase())) {
      return res.status(400).json({ message: 'Gender is required. Please select M or F.' });
    }
    const capError = await assertGaloreCategoryCap(email.trim(), event);
    if (capError) return res.status(400).json({ message: capError });

    const { rows } = await pgPool.query(
      `INSERT INTO event_registrations
       (event_id, event_title, name, enrollment_no, dept, course, phone, email, gender)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING ${REG_COLS}`,
      [
        event.id, event.title, name.trim(),
        enrollmentNo ? enrollmentNo.trim().toUpperCase() : '',
        event.parent_event_id ? dept.trim().toUpperCase() : dept.trim(), course.trim(),
        phone ? phone.trim() : '',
        email.trim().toLowerCase(),
        gender.toUpperCase(),
      ]
    );
    await cache.del(`events:${req.params.id}`);
    const regEmail = email.trim().toLowerCase();
    notifyRegistrationConfirmed(event, regEmail).catch(() => {});
    res.status(201).json({ message: 'Registration successful!', registration: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'You have already registered for this event.' });
    }
    next(err);
  }
};

/* POST /api/events/:id/team-roster  (public — no auth)
   A Sports Fiesta captain's link to submit their own contact details and
   their team's member names, within the min/max player range the admin set
   at creation. Unlike Other Events (individual public self-registration,
   teams built by the coordinator afterward), a single submission here
   creates the whole team directly — a real event_teams row plus one
   event_registrations + event_team_members pair per person (captain
   included) — so it plugs straight into the same Teams/Groups/Fixtures/
   Scoreboard pipeline Other Events use, and the coordinator only has to
   build fixtures, not assemble teams by hand. The event accepts as many
   teams as different captains submit — one submission per captain email; a
   captain email that's already registered a team for this event is
   rejected, so they know to contact their coordinator instead of
   double-submitting. */
const submitTeamRoster = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT id, title, status, event_format, team_size, min_team_size, category, parent_event_id
       FROM events WHERE id = $1 AND is_active = true`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Event not found.' });
    const event = rows[0];
    if (event.status === 'past') return res.status(400).json({ message: 'Registrations for this event are closed.' });
    if (event.event_format !== 'sports_fiesta') {
      return res.status(400).json({ message: 'This event does not accept a team roster submission.' });
    }

    const { teamName: rawTeamName, captainName, captainEmail, captainPhone, teamMembers, division: rawDivision, dept } = req.body;
    if (!rawTeamName?.trim())  return res.status(400).json({ message: 'Team name is required.' });
    if (!captainName?.trim())  return res.status(400).json({ message: "Captain's name is required." });
    if (!captainEmail?.trim()) return res.status(400).json({ message: "Captain's email is required." });
    if (!captainEmail.toLowerCase().endsWith(RKU_DOMAIN)) {
      return res.status(400).json({ message: 'Only RKU institutional emails (@rku.ac.in) are allowed.' });
    }
    if (!captainPhone?.trim()) return res.status(400).json({ message: "Captain's phone number is required." });
    if (!isValidMobile(captainPhone)) {
      return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
    }
    /* Only sports activities are gender-split (see CoordEvents.jsx's per-category
       DIVISIONS) — a Galore cultural/academic team always lands in the single
       'open' division regardless of what's posted; only a sports team gets to
       pick 'boys' or 'girls'. Non-Galore Sports Fiesta events (no parent_event_id)
       keep defaulting to 'boys', exactly as before this feature existed. */
    const division = event.category === 'sports'
      ? (['boys', 'girls'].includes(rawDivision) ? rawDivision : 'boys')
      : 'open';
    if (event.parent_event_id) {
      if (!dept?.trim() || !GALORE_DEPARTMENTS.includes(dept.trim().toUpperCase())) {
        return res.status(400).json({ message: `Department must be one of: ${GALORE_DEPARTMENTS.join(', ')}.` });
      }
    }
    if (!Array.isArray(teamMembers)) return res.status(400).json({ message: 'Team members list is required.' });
    const cleaned = teamMembers.map(m => String(m || '').trim()).filter(Boolean);
    if (!cleaned.length) return res.status(400).json({ message: 'Add at least one team member.' });
    /* min/max count the whole team — captain included — matching how
       event_teams.max_size is set below (cleaned.length + 1). */
    const totalPlayers = cleaned.length + 1;
    if (event.min_team_size && totalPlayers < event.min_team_size) {
      return res.status(400).json({ message: `This team needs at least ${event.min_team_size} player(s) in total, including you as captain.` });
    }
    if (event.team_size && totalPlayers > event.team_size) {
      return res.status(400).json({ message: `This team can have at most ${event.team_size} player(s) in total, including you as captain.` });
    }
    const emailNorm = captainEmail.trim().toLowerCase();

    /* Only captains ever submit a real email on this form (teammates get a
       synthetic one below), so a match here means this exact email already
       registered a team for this event. */
    const { rows: dupe } = await pgPool.query(
      `SELECT id FROM event_registrations WHERE event_id = $1 AND email = $2`,
      [event.id, emailNorm]
    );
    if (dupe.length) {
      return res.status(409).json({ message: 'This email has already registered a team for this event.' });
    }

    const capError = await assertGaloreCategoryCap(emailNorm, event);
    if (capError) return res.status(400).json({ message: capError });

    /* Team names must be unique per (event, division) — the captain picks the
       name, but if it collides with an existing team we disambiguate rather
       than reject, so a common name (e.g. "Titans") doesn't block signup. */
    const { rows: existingTeamNames } = await pgPool.query(
      `SELECT name FROM event_teams WHERE event_id = $1 AND division = $2`, [event.id, division]
    );
    const takenNames = new Set(existingTeamNames.map(r => r.name));
    let teamName = rawTeamName.trim();
    let suffix = 2;
    while (takenNames.has(teamName)) { teamName = `${rawTeamName.trim()} (${suffix})`; suffix++; }

    /* dept is only ever non-empty for a Galore activity (validated above) — every
       member of the team, captain and teammates alike, shares this one department,
       so it's written onto each of their own event_registrations rows too, not
       just event_teams.dept — that's what powers the department-wise registrant
       view (getDepartmentRegistrations) and the department cap check. */
    const resolvedDept = event.parent_event_id ? dept.trim().toUpperCase() : '';

    const pgClient = await pgPool.connect();
    try {
      await pgClient.query('BEGIN');

      /* The captain's own registration carries their real identity. */
      const { rows: capReg } = await pgClient.query(
        `INSERT INTO event_registrations (event_id, event_title, name, email, phone, dept)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name`,
        [event.id, event.title, captainName.trim(), emailNorm, captainPhone.trim(), resolvedDept]
      );

      /* One team, named after the captain — max_size covers the captain + roster cap. */
      const { rows: teamRows } = await pgClient.query(
        `INSERT INTO event_teams (event_id, name, max_size, division, dept) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [event.id, teamName, cleaned.length + 1, division, resolvedDept]
      );
      const teamId = teamRows[0].id;

      await pgClient.query(
        `INSERT INTO event_team_members (team_id, registration_id, member_name, enrollment_no, is_captain) VALUES ($1, $2, $3, '', true)`,
        [teamId, capReg[0].id, capReg[0].name]
      );

      /* Teammates have no email of their own on this form, so each gets a
         synthetic, event-scoped placeholder — unique enough to satisfy the
         (event_id, email) constraint, never shown anywhere, and never relied
         on for login/notification (only the captain's real email is). */
      for (let i = 0; i < cleaned.length; i++) {
        const memberName = cleaned[i];
        const placeholderEmail = `sf-roster-${event.id}-${teamId}-${i}-${Date.now()}@roster.internal`;
        const { rows: memReg } = await pgClient.query(
          `INSERT INTO event_registrations (event_id, event_title, name, email, dept) VALUES ($1, $2, $3, $4, $5) RETURNING id, name`,
          [event.id, event.title, memberName, placeholderEmail, resolvedDept]
        );
        await pgClient.query(
          `INSERT INTO event_team_members (team_id, registration_id, member_name, enrollment_no) VALUES ($1, $2, $3, '')`,
          [teamId, memReg[0].id, memberName]
        );
      }

      /* Mirror the most recent submission onto the event row too — a cheap,
         informational-only summary (the event can have many teams/captains;
         the live, authoritative roster for all of them always lives in
         event_teams, shown in full on the coordinator's Teams tab). */
      await pgClient.query(
        `UPDATE events SET captain_name = $1, captain_email = $2, captain_phone = $3, team_members = $4, updated_at = NOW() WHERE id = $5`,
        [captainName.trim(), captainEmail.trim(), captainPhone.trim(), JSON.stringify(cleaned), event.id]
      );

      await pgClient.query('COMMIT');
    } catch (err) {
      await pgClient.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      pgClient.release();
    }

    const { rows: updated } = await pgPool.query(`SELECT ${EVENT_COLS} FROM events WHERE id = $1`, [event.id]);
    await cache.del(`events:${req.params.id}`);
    res.json({ message: 'Team submitted!', event: withImageUrl(asEvent(updated[0])) });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ message: 'This email has already registered a team for this event.' });
    }
    next(err);
  }
};

/* GET /api/events/:id/registrations  (admin or coordinator for their own club's event)
   Supports ?page=&limit= */
const listRegistrations = async (req, res, next) => {
  try {
    // Coordinators may only view registrations for events they own — directly
    // (a Galore activity assignment) or via their club — see coordAuth.js.
    if (req.user.role === 'coordinator' || req.user.role === 'faculty_coordinator') {
      const ok = await assertCoordOwnsEvent(req.user.id, req.params.id);
      if (!ok) return res.status(403).json({ message: 'You can only view registrations for your own events.' });
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

/* PATCH /api/events/:id/registrations/:regId  (admin only)
   Lets admin correct a student's submitted registration details. Email anchors the
   registrant's identity across the platform (login, my-status lookups)
   so it's intentionally NOT editable here — only the details they filled in at
   registration are. If this registration has already been added to a team, the
   same corrected name/enrollment number are pushed into that team's roster
   snapshot too, so the edit is reflected everywhere it's displayed: the
   coordinator's team/fixtures views, the public Teams & Bracket view students see,
   and (on next regenerate) event reports. */
const updateRegistration = async (req, res, next) => {
  try {
    const { rows: existing } = await pgPool.query(
      `SELECT id FROM event_registrations WHERE id = $1 AND event_id = $2`,
      [req.params.regId, req.params.id]
    );
    if (!existing.length) return res.status(404).json({ message: 'Registration not found.' });

    const { name, enrollmentNo, dept, course, phone, gender } = req.body;
    if (!name?.trim())   return res.status(400).json({ message: 'Name is required.' });
    if (!dept?.trim())   return res.status(400).json({ message: 'Department is required.' });
    if (!course?.trim()) return res.status(400).json({ message: 'Course is required.' });
    if (phone?.trim() && !isValidMobile(phone)) {
      return res.status(400).json({ message: 'Enter a valid 10-digit mobile number.' });
    }
    if (gender && !['M', 'F'].includes(gender.toUpperCase())) {
      return res.status(400).json({ message: 'Gender must be M or F.' });
    }

    const nameT  = name.trim();
    const enrolT = enrollmentNo ? enrollmentNo.trim().toUpperCase() : '';

    const { rows } = await pgPool.query(
      `UPDATE event_registrations
       SET name = $1, enrollment_no = $2, dept = $3, course = $4, phone = $5, gender = $6
       WHERE id = $7 AND event_id = $8
       RETURNING ${REG_COLS}`,
      [
        nameT, enrolT, dept.trim(), course.trim(),
        phone ? phone.trim() : '', gender ? gender.toUpperCase() : null,
        req.params.regId, req.params.id,
      ]
    );

    /* Keep any team roster snapshot this registrant is part of in sync */
    await pgPool.query(
      `UPDATE event_team_members SET member_name = $1, enrollment_no = $2 WHERE registration_id = $3`,
      [nameT, enrolT, req.params.regId]
    );

    const io = req.app.get('io');
    if (io) {
      io.emit('registration:updated', { eventId: String(req.params.id), registrationId: String(req.params.regId) });
    }
    autoRefreshReportIfExists(req.params.id).catch(() => {});

    res.json({ registration: rows[0] });
  } catch (err) { next(err); }
};

/* DELETE /api/events/:id/registrations/:regId  (admin only)
   Works the same for every event format — an individual Other Events
   sign-up or one person (captain or teammate) out of a Sports Fiesta team.
   event_team_members.registration_id has no DB-level cascade, so if this
   registrant was already placed on a team, their membership row is removed
   in the same transaction — otherwise it'd be left pointing at nothing. */
const deleteRegistration = async (req, res, next) => {
  const pgClient = await pgPool.connect();
  try {
    const { rows: existing } = await pgClient.query(
      `SELECT id FROM event_registrations WHERE id = $1 AND event_id = $2`,
      [req.params.regId, req.params.id]
    );
    if (!existing.length) return res.status(404).json({ message: 'Registration not found.' });

    await pgClient.query('BEGIN');
    await pgClient.query(`DELETE FROM event_team_members WHERE registration_id = $1`, [req.params.regId]);
    await pgClient.query(`DELETE FROM event_registrations WHERE id = $1 AND event_id = $2`, [req.params.regId, req.params.id]);
    await pgClient.query('COMMIT');

    await cache.del(`events:${req.params.id}`);
    const io = req.app.get('io');
    if (io) {
      io.emit('registration:deleted', { eventId: String(req.params.id), registrationId: String(req.params.regId) });
    }
    autoRefreshReportIfExists(req.params.id).catch(() => {});

    res.json({ message: 'Registration deleted.' });
  } catch (err) {
    await pgClient.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    pgClient.release();
  }
};

/* GET /api/events/galore/departments  (public) — the fixed department list, so the
   frontend never hand-duplicates it and can't drift from server-side validation. */
const getGaloreDepartments = (req, res) => res.json({ departments: GALORE_DEPARTMENTS });

/* GET /api/events/galore/activities-catalog  (admin) — every pre-programmed
   activity, so the "create Galore event" screen can render one coordinator
   picker per activity without the frontend hand-duplicating this list. */
const getGaloreCatalog = (req, res) => res.json({ activities: GALORE_ACTIVITIES_CATALOG });

/* GET /api/events/galore/coordinators  (admin) — every active coordinator
   account, for the per-activity assignment dropdowns. */
const getGaloreCoordinators = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT id, name, email FROM users WHERE role = 'coordinator' AND is_active = true ORDER BY name`
    );
    res.json({ coordinators: rows });
  } catch (err) { next(err); }
};

/* POST /api/events/galore  (admin only)
   Creates the whole Galore event in one transaction: the umbrella event plus
   every catalog activity underneath it (parent_event_id), each with its
   assigned coordinator already wired up via event_coordinators — nothing is
   created unless EVERY activity has a valid coordinator, so a Galore event
   can never exist half-staffed. Never paid — is_free/fee_amount are left at
   their table defaults (true / 0) on every row created here. */
const createGaloreEvent = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { title, venue, startDate, date, time, description, seats, highlight } = req.body;
    if (!title?.trim()) return res.status(400).json({ message: 'Event title is required.' });

    let activityCoordinators;
    try { activityCoordinators = JSON.parse(req.body.activityCoordinators || '{}'); }
    catch { return res.status(400).json({ message: 'Invalid activity coordinator assignments.' }); }

    const missing = GALORE_ACTIVITIES_CATALOG.filter(a => !activityCoordinators[a.key]);
    if (missing.length) {
      return res.status(400).json({
        message: `Assign a coordinator for every activity before creating the event. Missing: ${missing.map(a => a.title).join(', ')}.`,
      });
    }

    const coordIds = [...new Set(Object.values(activityCoordinators))];
    const { rows: coordRows } = await pgPool.query(
      `SELECT id, name, email FROM users WHERE id = ANY($1::int[]) AND role = 'coordinator' AND is_active = true`,
      [coordIds]
    );
    if (coordRows.length !== coordIds.length) {
      return res.status(400).json({ message: 'One or more assigned coordinators are invalid.' });
    }
    const coordById = new Map(coordRows.map(c => [String(c.id), c]));

    /* uploadEventMemory (memoryStorage) hands us a buffer, not an already-uploaded
       file — upload it here inside a real try/catch. multer-storage-cloudinary's
       streaming engine (used everywhere else) can throw an unhandled "socket hang
       up" promise rejection on a flaky connection, hanging the whole request with
       no response ever sent; this event/its 12 activities/coordinator assignments
       are the important part, so a failed image upload is logged and skipped
       rather than blocking event creation entirely. */
    let image = '';
    if (req.file) {
      try {
        image = await uploadImageBuffer(req.file, 'events');
      } catch (err) {
        console.warn('Galore event image upload failed — creating the event without an image:', err.message);
      }
    }
    const pgClient = await pgPool.connect();
    try {
      await pgClient.query('BEGIN');

      const { rows: umbrellaRows } = await pgClient.query(
        `INSERT INTO events (title, category, status, date, start_date, time, venue, description, image, seats, highlight, event_format)
         VALUES ($1, 'general', 'upcoming', $2, $3, $4, $5, $6, $7, $8, $9, 'galore')
         RETURNING ${EVENT_COLS}`,
        [title.trim(), date || '', startDate ? new Date(startDate) : null, time || '', venue || '', description || '', image, seats || '', highlight || '']
      );
      const umbrella = umbrellaRows[0];

      const createdActivities = [];
      for (const act of GALORE_ACTIVITIES_CATALOG) {
        const isTeam = act.participationType === 'team';
        /* Every activity — team or individual — takes plain individual
           registrations (event_format 'other'): a student just registers
           interest with their own details, once, via the single unified
           Galore registration form (see register() below). For team
           activities, the assigned coordinator later groups each
           department's registrants into teams themselves via the existing
           Teams tab — there's no self-service captain/roster submission
           for Galore. team_size/min_team_size are kept purely as the
           roster-size hint shown to that coordinator. */
        const { rows: actRows } = await pgClient.query(
          `INSERT INTO events (title, category, status, date, start_date, time, venue, event_format, team_size, min_team_size, parent_event_id)
           VALUES ($1, $2, 'upcoming', $3, $4, $5, $6, 'other', $7, $8, $9)
           RETURNING id, title, category`,
          [
            act.title, act.category, date || '', startDate ? new Date(startDate) : null, time || '', venue || '',
            isTeam ? act.teamSize : 0, isTeam ? act.minTeamSize : 0, umbrella.id,
          ]
        );
        const activity = actRows[0];
        await pgClient.query(
          `INSERT INTO event_coordinators (event_id, user_id) VALUES ($1, $2)`,
          [activity.id, activityCoordinators[act.key]]
        );
        createdActivities.push({ id: String(activity.id), key: act.key, title: activity.title, category: activity.category });
      }

      await pgClient.query('COMMIT');
      await Promise.all([cache.delPattern('events:*'), cache.del('stats:admin')]);

      /* Let every assigned coordinator know right away — email + in-app/push,
         each fire-and-forget so one slow/failed send never blocks the response
         or takes down another coordinator's notification. */
      for (const act of createdActivities) {
        const coordId = activityCoordinators[act.key];
        const coord = coordById.get(String(coordId));
        if (!coord) continue;
        sendGaloreActivityAssignment({
          toEmail: coord.email, toName: coord.name,
          activityTitle: act.title, category: act.category, umbrellaTitle: umbrella.title,
        }).catch(err => console.warn('Galore coordinator assignment email failed:', err.message));
        notifyUser({
          userId: coord.id,
          title: `You're coordinating ${act.title}`,
          body: `You've been assigned to coordinate ${act.title} for ${umbrella.title}. Registrations will appear in your dashboard as students sign up.`,
          type: 'galore_coordinator_assignment',
          url: '/coordinator/events',
        }).catch(() => {});
      }

      res.status(201).json({ event: withImageUrl(asEvent(umbrella)), activities: createdActivities });
    } catch (err) {
      await pgClient.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      pgClient.release();
    }
  } catch (err) { next(err); }
};

/* GET /api/events/:id/department-registrations  (admin, or any coordinator
   assigned to one of this Galore umbrella's activities)
   Every registrant, grouped by department, for every activity the requester
   can actually see — admin gets the whole umbrella; a coordinator gets ONLY
   the activity/activities they were personally assigned (e.g. the Football
   coordinator sees Football registrants across every department, and never
   Basketball, Chess, or anything they weren't assigned to). */
const getDepartmentRegistrations = async (req, res, next) => {
  try {
    const { rows: umbrellaRows } = await pgPool.query(
      `SELECT id FROM events WHERE id = $1 AND is_active = true AND event_format = 'galore' AND parent_event_id IS NULL`,
      [req.params.id]
    );
    if (!umbrellaRows.length) return res.status(404).json({ message: 'Galore event not found.' });

    let ownEventIds = null; // null = no restriction (admin sees every activity)
    if (req.user.role === 'coordinator' || req.user.role === 'faculty_coordinator') {
      const { rows: owned } = await pgPool.query(
        `SELECT ec.event_id FROM event_coordinators ec
         JOIN events e ON e.id = ec.event_id
         WHERE ec.user_id = $1 AND e.parent_event_id = $2`,
        [req.user.id, req.params.id]
      );
      if (!owned.length) return res.status(403).json({ message: 'You are not assigned to any activity in this Galore event.' });
      ownEventIds = owned.map(r => r.event_id);
    }

    const { rows } = await pgPool.query(
      `SELECT er.id, er.name, er.email, er.enrollment_no, er.dept, er.course, er.phone, er.gender,
              e.id AS event_id, e.title AS event_title, e.category
       FROM event_registrations er
       JOIN events e ON e.id = er.event_id
       WHERE e.parent_event_id = $1 AND er.email NOT ILIKE '%@roster.internal'
         AND ($2::bigint[] IS NULL OR e.id = ANY($2::bigint[]))
       ORDER BY er.dept, e.category, er.name`,
      [req.params.id, ownEventIds]
    );

    const byDept = {};
    for (const dept of GALORE_DEPARTMENTS) byDept[dept] = [];
    for (const r of rows) {
      const dept = GALORE_DEPARTMENTS.includes(r.dept) ? r.dept : (r.dept || 'Unspecified');
      if (!byDept[dept]) byDept[dept] = [];
      byDept[dept].push({
        registrationId: String(r.id),
        name: r.name, email: r.email, enrollmentNo: r.enrollment_no,
        dept: r.dept, course: r.course, phone: r.phone, gender: r.gender,
        eventId: String(r.event_id), eventTitle: r.event_title, category: r.category,
      });
    }
    res.json({
      departments: Object.entries(byDept).map(([dept, registrants]) => ({ dept, registrants })),
    });
  } catch (err) { next(err); }
};

/* GET /api/events/my-assignments  (coordinator)
   Every event this coordinator is directly assigned to via event_coordinators
   (a Galore activity, independent of any club) — lets a coordinator with no
   club membership at all still see and manage what they've been assigned,
   and lets one with a club ALSO see activities assigned outside it. */
const getMyAssignments = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT ${EVENT_COLS.split(', ').map(c => `e.${c}`).join(', ')}
       FROM events e
       JOIN event_coordinators ec ON ec.event_id = e.id
       WHERE ec.user_id = $1 AND e.is_active = true
       ORDER BY e.created_at DESC`,
      [req.user.id]
    );
    res.json({ events: rows.map(r => withImageUrl(asEvent(r))) });
  } catch (err) { next(err); }
};

module.exports = {
  getAll, getLiveScores, getPastScores, getOne, getActivities,
  getGaloreDepartments, getGaloreCatalog, getGaloreCoordinators, createGaloreEvent, getDepartmentRegistrations,
  getMyAssignments,
  create, update, remove, register, submitTeamRoster, listRegistrations, updateRegistration, deleteRegistration,
};
