/**
 * Announcements controller.
 *
 * Two feeds:
 *   • Club news  — club_id = <id>  (posted by coordinator of that club)
 *   • SOAC-wide  — club_id = NULL  (posted by admin only)
 *
 * Routes:
 *   GET  /api/announcements?clubId=<id>   — club feed   (public)
 *   GET  /api/announcements/soac          — SOAC feed   (public)
 *   POST /api/announcements               — coordinator posts to own club (auth)
 *   POST /api/announcements/soac          — admin posts SOAC-wide (admin)
 *   DELETE /api/announcements/:id         — author or admin soft-deletes (auth)
 */
const { pgPool } = require('../config/db');
const { ensureSoacTables } = require('../services/soacData');
const { assertCoordOwnsClub } = require('../services/coordAuth');
const cache = require('../services/cache');

const COLS = [
  'id', 'club_id', 'author_id', 'author_name',
  'title', 'body', 'tag', 'pinned', 'is_active',
  'created_at', 'updated_at',
].join(', ');

const toAnn = (r) => ({
  _id:        String(r.id),
  id:         String(r.id),
  clubId:     r.club_id ? String(r.club_id) : null,
  authorId:   r.author_id,
  authorName: r.author_name,
  title:      r.title,
  body:       r.body       || '',
  tag:        r.tag        || 'Announcement',
  pinned:     !!r.pinned,
  isActive:   !!r.is_active,
  createdAt:  r.created_at,
  updatedAt:  r.updated_at,
});

/* ── GET /api/announcements?clubId=<id>  (public — club news feed) ── */
const getClubFeed = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { clubId } = req.query;
    if (!clubId) {
      return res.status(400).json({ message: 'clubId query parameter is required.' });
    }

    const cacheKey = `announcements:club:${clubId}`;
    const cached   = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const { rows } = await pgPool.query(
      `SELECT ${COLS}
       FROM club_announcements
       WHERE club_id = $1::bigint AND is_active = true
       ORDER BY pinned DESC, created_at DESC
       LIMIT 100`,
      [clubId]
    );

    const result = { announcements: rows.map(toAnn) };
    await cache.set(cacheKey, result, 30);
    res.json(result);
  } catch (err) { next(err); }
};

/* ── GET /api/announcements/soac  (public — SOAC-wide feed) ── */
const getSOACFeed = async (req, res, next) => {
  try {
    await ensureSoacTables();

    const cached = await cache.get('announcements:soac');
    if (cached) return res.json(cached);

    const { rows } = await pgPool.query(
      `SELECT ${COLS}
       FROM club_announcements
       WHERE club_id IS NULL AND is_active = true
       ORDER BY pinned DESC, created_at DESC
       LIMIT 100`
    );

    const result = { announcements: rows.map(toAnn) };
    await cache.set('announcements:soac', result, 30);
    res.json(result);
  } catch (err) { next(err); }
};

/* ── POST /api/announcements  (coordinator → posts to own club) ── */
const createClubAnnouncement = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { title, body, tag, pinned } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ message: 'Title is required.' });
    }

    /* Coordinators can only post to their assigned clubs */
    let clubId = null;
    if (req.user.role === 'coordinator') {
      const requestedClubId = req.body.clubId || null;
      if (!requestedClubId) {
        return res.status(400).json({ message: 'clubId is required.' });
      }
      const ok = await assertCoordOwnsClub(req.user.id, requestedClubId);
      if (!ok) {
        return res.status(403).json({ message: 'You can only post announcements for your assigned clubs.' });
      }
      clubId = requestedClubId;
    } else if (req.user.role === 'admin') {
      /* Admin can also post to a specific club if clubId is provided */
      clubId = req.body.clubId || null;
    }

    if (!clubId) {
      return res.status(400).json({ message: 'clubId is required for club announcements.' });
    }

    const validTags = ['Announcement','Event','Achievement','Update','Important','Deadline','Finance'];
    const safeTag   = validTags.includes(tag) ? tag : 'Announcement';

    const { rows } = await pgPool.query(
      `INSERT INTO club_announcements
         (club_id, author_id, author_name, title, body, tag, pinned)
       VALUES ($1::bigint, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLS}`,
      [
        clubId,
        req.user.id,
        req.user.name,
        title.trim(),
        (body || '').trim(),
        safeTag,
        !!pinned,
      ]
    );

    await cache.del(`announcements:club:${clubId}`);
    res.status(201).json({ announcement: toAnn(rows[0]) });
  } catch (err) { next(err); }
};

/* ── POST /api/announcements/soac  (admin → posts SOAC-wide) ── */
const createSOACAnnouncement = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { title, body, tag, pinned } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ message: 'Title is required.' });
    }

    const validTags = ['Announcement','Event','Achievement','Update','Important','Deadline','Finance'];
    const safeTag   = validTags.includes(tag) ? tag : 'Announcement';

    const { rows } = await pgPool.query(
      `INSERT INTO club_announcements
         (club_id, author_id, author_name, title, body, tag, pinned)
       VALUES (NULL, $1, $2, $3, $4, $5, $6)
       RETURNING ${COLS}`,
      [
        req.user.id,
        req.user.name,
        title.trim(),
        (body || '').trim(),
        safeTag,
        !!pinned,
      ]
    );

    await cache.del('announcements:soac');
    res.status(201).json({ announcement: toAnn(rows[0]) });
  } catch (err) { next(err); }
};

/* ── DELETE /api/announcements/:id  (author or admin — soft-delete) ── */
const remove = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT id, club_id, author_id FROM club_announcements WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Announcement not found.' });

    const ann = rows[0];
    /* Only admin or the original author may delete */
    if (req.user.role !== 'admin' && req.user.id !== ann.author_id) {
      return res.status(403).json({ message: 'You can only delete your own announcements.' });
    }

    await pgPool.query(
      `UPDATE club_announcements SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );

    /* Bust both possible cache keys */
    const toDelete = ann.club_id
      ? [`announcements:club:${ann.club_id}`]
      : ['announcements:soac'];
    await cache.del(...toDelete);

    res.json({ message: 'Announcement deleted.' });
  } catch (err) { next(err); }
};

module.exports = { getClubFeed, getSOACFeed, createClubAnnouncement, createSOACAnnouncement, remove };
