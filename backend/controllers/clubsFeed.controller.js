const { pgPool }         = require('../config/db');
const { buildClubsFeed } = require('../services/clubsFeed.service');

/**
 * GET /api/clubs-feed
 *
 * Authenticated student endpoint. Fetches the student's joined clubs, then
 * delegates to clubsFeed.service for a freshly-shuffled, topic-relevant
 * YouTube video feed. Returns { clubs, videos, topics, apiKeySet }.
 */
const getFeed = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { rows: clubs } = await pgPool.query(
      `SELECT c.id, c.name, c.category, c.tags
       FROM   student_clubs sc
       JOIN   clubs c ON c.id = sc.club_id AND c.is_active = true
       WHERE  sc.user_id = $1 AND sc.is_active = true
       ORDER  BY sc.joined_at ASC`,
      [userId]
    );

    const feed = await buildClubsFeed(clubs);
    res.json({ clubs, ...feed });
  } catch (err) {
    next(err);
  }
};

module.exports = { getFeed };
