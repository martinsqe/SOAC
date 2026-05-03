const { pgPool }    = require('../config/db');
const { buildFeed } = require('../services/newsFeed.service');

/**
 * GET /api/news-feed
 *
 * Authenticated student endpoint.
 * 1. Fetches the student's joined clubs (with category + tags for the algorithm).
 * 2. Delegates to newsFeed.service to fetch + score + cache the feed.
 * 3. Returns { clubs, items, queries, apiStatus }.
 */
const getFeed = async (req, res, next) => {
  try {
    const userId = req.user.id;

    /* Fetch full club rows for the student so the service has category + tags */
    const { rows: clubs } = await pgPool.query(
      `SELECT c.id, c.name, c.category, c.color, c.tags, c.slug
       FROM   student_clubs sc
       JOIN   clubs c ON c.id = sc.club_id AND c.is_active = true
       WHERE  sc.user_id = $1
       ORDER  BY sc.joined_at ASC`,
      [userId]
    );

    const feed = await buildFeed(clubs);

    res.json({ clubs, ...feed });
  } catch (err) {
    next(err);
  }
};

module.exports = { getFeed };
