const { pgPool } = require('../config/db');
const { getFileValue } = require('../config/multer');

/* Safe schema migration: drop old table if it uses post_type (wrong schema) */
pgPool.query(`
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'explore_posts'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'explore_posts' AND column_name = 'section'
    ) THEN
      DROP TABLE explore_posts;
    END IF;
  END $$;

  CREATE TABLE IF NOT EXISTS explore_posts (
    id          BIGSERIAL    PRIMARY KEY,
    club_id     BIGINT,
    coord_id    BIGINT       NOT NULL,
    category    VARCHAR(32)  NOT NULL DEFAULT 'social',
    section     VARCHAR(32)  NOT NULL DEFAULT 'gallery',
    title       VARCHAR(255) NOT NULL DEFAULT '',
    image_url   VARCHAR(512) NOT NULL DEFAULT '',
    club_name   VARCHAR(255) NOT NULL DEFAULT '',
    coord_name  VARCHAR(255) NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_explore_section ON explore_posts(section);
  CREATE INDEX IF NOT EXISTS idx_explore_created ON explore_posts(created_at DESC);
`).catch(err => console.error('[explore] table init:', err.message));

const VALID_SECTIONS = ['workshops', 'competitions', 'carnivals', 'sports', 'national_days', 'gallery'];

const getPosts = async (req, res, next) => {
  try {
    const { section, category, limit = 200 } = req.query;
    const conditions = [];
    const params = [];

    if (section && VALID_SECTIONS.includes(section)) {
      params.push(section);
      conditions.push(`ep.section = $${params.length}`);
    }
    if (category && category !== 'all') {
      params.push(category);
      conditions.push(`ep.category = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(Number(limit));

    const { rows } = await pgPool.query(
      `SELECT ep.*, c.logo AS club_logo
       FROM explore_posts ep
       LEFT JOIN clubs c ON ep.club_id = c.id
       ${where}
       ORDER BY ep.created_at DESC
       LIMIT $${params.length}`,
      params
    );

    res.json({ posts: rows });
  } catch (err) { next(err); }
};

const createPost = async (req, res, next) => {
  try {
    const { title = '', category = 'social', section, club_name = '', club_id } = req.body;
    const coord_id = req.user.id;
    const image_url = req.file ? (getFileValue(req.file) || '') : '';

    if (!section || !VALID_SECTIONS.includes(section)) {
      return res.status(400).json({ message: 'A valid section is required.' });
    }
    if (!image_url) {
      return res.status(400).json({ message: 'An image or poster is required.' });
    }

    const { rows: userRows } = await pgPool.query(
      `SELECT name FROM users WHERE id = $1`, [coord_id]
    );
    const coord_name = userRows[0]?.name || '';

    const { rows } = await pgPool.query(
      `INSERT INTO explore_posts
         (club_id, coord_id, category, section, title, image_url, club_name, coord_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [club_id || null, coord_id, category, section, title, image_url, club_name, coord_name]
    );

    res.status(201).json({ post: rows[0] });
  } catch (err) { next(err); }
};

const deletePost = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    const cond   = isAdmin ? `id = $1` : `id = $1 AND coord_id = $2`;
    const params = isAdmin ? [req.params.id] : [req.params.id, userId];

    const { rows } = await pgPool.query(
      `DELETE FROM explore_posts WHERE ${cond} RETURNING id`, params
    );
    if (!rows.length) return res.status(404).json({ message: 'Post not found or not authorized.' });
    res.json({ message: 'Post deleted.' });
  } catch (err) { next(err); }
};

module.exports = { getPosts, createPost, deletePost };
