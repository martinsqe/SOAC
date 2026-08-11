const { pgPool }         = require('../config/db');
const { buildClubsFeed } = require('../services/clubsFeed.service');

/* Per-student-per-topic watch time — the engagement signal that lets the
   feed show more of what a student actually watches, not just what club
   they joined. Deliberately its own small table (not member_notifications
   or anywhere else) since it's pure behavioral data, never user-facing. */
(async () => {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS clubs_feed_engagement (
        id             BIGSERIAL     PRIMARY KEY,
        user_id        INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        topic          VARCHAR(500)  NOT NULL,
        watch_seconds  INTEGER       NOT NULL DEFAULT 0,
        watch_count    INTEGER       NOT NULL DEFAULT 0,
        updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, topic)
      )
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_clubs_feed_engagement_user ON clubs_feed_engagement(user_id)`);
    console.log('[ClubsFeed] engagement table ready');
  } catch (err) {
    console.error('[ClubsFeed] engagement migration failed:', err.message);
  }
})();

/**
 * GET /api/clubs-feed
 *
 * Authenticated student endpoint. Fetches the student's joined clubs and
 * their per-topic watch-time history, then delegates to clubsFeed.service
 * for a freshly-shuffled, engagement-weighted YouTube video feed. Returns
 * { clubs, videos, topics, apiKeySet }.
 */
const getFeed = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { rows: clubs } = await pgPool.query(
      `SELECT c.id, c.name, c.category, c.tags, c.description, c.vision
       FROM   student_clubs sc
       JOIN   clubs c ON c.id = sc.club_id AND c.is_active = true
       WHERE  sc.user_id = $1 AND sc.is_active = true
       ORDER  BY sc.joined_at ASC`,
      [userId]
    );

    const { rows: engagementRows } = await pgPool.query(
      `SELECT topic, watch_seconds FROM clubs_feed_engagement WHERE user_id = $1`,
      [userId]
    );
    const engagementByTopic = {};
    engagementRows.forEach(r => { engagementByTopic[r.topic] = r.watch_seconds; });

    const feed = await buildClubsFeed(clubs, engagementByTopic);
    res.json({ clubs, ...feed });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/clubs-feed/watch
 * Body: { topic: string, seconds: number }
 *
 * Records how long a student actually watched a video from a given topic.
 * Fire-and-forget from the frontend — never blocks playback/scrolling.
 * Upserts (accumulates) rather than replacing, so this is a running total.
 */
const recordWatch = async (req, res, next) => {
  try {
    const { topic, seconds } = req.body;
    const watched = Math.round(Number(seconds));
    if (!topic || !Number.isFinite(watched) || watched <= 0) {
      return res.status(400).json({ message: 'topic and a positive seconds value are required.' });
    }
    /* Cap a single report at 2 hours — a stray client-side bug reporting a
       runaway duration should never be able to permanently skew a topic's
       weight for a student. */
    const clamped = Math.min(watched, 7200);

    await pgPool.query(
      `INSERT INTO clubs_feed_engagement (user_id, topic, watch_seconds, watch_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (user_id, topic) DO UPDATE SET
         watch_seconds = clubs_feed_engagement.watch_seconds + EXCLUDED.watch_seconds,
         watch_count   = clubs_feed_engagement.watch_count + 1,
         updated_at    = NOW()`,
      [req.user.id, String(topic).slice(0, 500), clamped]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

module.exports = { getFeed, recordWatch };
