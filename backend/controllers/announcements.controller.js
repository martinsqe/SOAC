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
const { notifyManyUsers } = require('../services/notify');
const { sendBroadcastEmail, sendClubAnnouncementEmail } = require('../config/email');
const cache = require('../services/cache');

/* SOAC broadcasts carry who they're for and how they're delivered:
     audience — roles that receive it: student, coordinator (Student Coordinator),
                faculty_coordinator (Faculty Advisor)
     delivery — 'both' (dashboard + email), 'portal' (dashboard only), 'email' (email only) */
const AUDIENCE_ROLES = ['student', 'coordinator', 'faculty_coordinator'];
const DELIVERY_MODES = ['both', 'portal', 'email'];
/* Adds the two columns once, after the base tables exist */
let broadcastColsReady = null;
const ensureTables = async () => {
  await ensureSoacTables();
  if (!broadcastColsReady) {
    broadcastColsReady = pgPool.query(
      `ALTER TABLE club_announcements
         ADD COLUMN IF NOT EXISTS audience TEXT[]      NOT NULL DEFAULT '{student,coordinator,faculty_coordinator}',
         ADD COLUMN IF NOT EXISTS delivery VARCHAR(10) NOT NULL DEFAULT 'both'`
    ).catch(err => { broadcastColsReady = null; throw err; });
  }
  await broadcastColsReady;
};

const COLS = [
  'id', 'club_id', 'author_id', 'author_name',
  'title', 'body', 'tag', 'pinned', 'is_active',
  'created_at', 'updated_at', 'audience', 'delivery',
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
  audience:   r.audience || AUDIENCE_ROLES,
  delivery:   r.delivery || 'both',
});

/* ── GET /api/announcements?clubId=<id>  (public — club news feed) ── */
const getClubFeed = async (req, res, next) => {
  try {
    await ensureTables();
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

/* ── GET /api/announcements/soac[?for=<role>]  (public — SOAC-wide feed)
   ?for=student|coordinator|faculty_coordinator → only the broadcasts addressed to
   that role and shown on the dashboard (not email-only). Without it (admin's
   Broadcast page) every broadcast is listed. ── */
const getSOACFeed = async (req, res, next) => {
  try {
    await ensureTables();
    const role = AUDIENCE_ROLES.includes(req.query.for) ? req.query.for : null;
    const cacheKey = role ? `announcements:soac:${role}` : 'announcements:soac';

    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const { rows } = await pgPool.query(
      `SELECT ${COLS}
       FROM club_announcements
       WHERE club_id IS NULL AND is_active = true
         ${role ? `AND $1 = ANY(audience) AND delivery <> 'email'` : ''}
       ORDER BY pinned DESC, created_at DESC
       LIMIT 100`,
      role ? [role] : []
    );

    const result = { announcements: rows.map(toAnn) };
    await cache.set(cacheKey, result, 30);
    res.json(result);
  } catch (err) { next(err); }
};

const SOAC_CACHE_KEYS = ['announcements:soac', ...AUDIENCE_ROLES.map(r => `announcements:soac:${r}`)];

/* ── POST /api/announcements  (coordinator → posts to own club) ── */
const createClubAnnouncement = async (req, res, next) => {
  try {
    await ensureTables();
    const { title, body, tag, pinned } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ message: 'Title is required.' });
    }

    /* Coordinators can only post to their assigned clubs */
    let clubId = null;
    if (req.user.role === 'coordinator' || req.user.role === 'faculty_coordinator') {
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

    /* Fan out to every active member of this club — fire-and-forget, after the
       response, so a large club doesn't delay the poster's own confirmation. */
    pgPool.query(
      `SELECT u.id FROM student_clubs sc
       JOIN users u ON u.id = sc.user_id AND u.is_active = true
       WHERE sc.club_id = $1::bigint AND sc.is_active = true`,
      [clubId]
    ).then(({ rows: members }) => {
      if (!members.length) return;
      notifyManyUsers({
        userIds: members.map(m => m.id),
        clubId,
        title: title.trim(),
        body:  (body || '').trim().slice(0, 150),
        type:  'announcement',
        url:   `/student/clubs/${clubId}`,
      });
    }).catch(() => {});

    /* Email the club's members the whole announcement (each address once) */
    const ROLE_NAME = { coordinator: 'Student Coordinator', faculty_coordinator: 'Faculty Advisor', admin: 'SOAC Admin' };
    pgPool.query(
      `SELECT c.name AS club_name, m.email, m.name
       FROM clubs c
       JOIN LATERAL (
         SELECT DISTINCT ON (LOWER(u.email)) u.email, u.name
         FROM student_clubs sc
         JOIN users u ON u.id = sc.user_id AND u.is_active = true AND u.role = 'student'
         WHERE sc.club_id = c.id AND sc.is_active = true AND COALESCE(u.email, '') <> ''
       ) m ON true
       WHERE c.id = $1::bigint`,
      [clubId]
    ).then(({ rows: members }) => {
      for (const m of members) {
        sendClubAnnouncementEmail({
          toEmail: m.email, toName: m.name, clubName: m.club_name, clubId,
          title: title.trim(), body: (body || '').trim(), category: safeTag,
          postedBy: `${req.user.name} (${ROLE_NAME[req.user.role] || 'Club'})`,
        }).catch(err => console.error(`[announcements] email failed for ${m.email}:`, err.message));
      }
    }).catch(err => console.error('[announcements] club email lookup failed:', err.message));
  } catch (err) { next(err); }
};

/* ── POST /api/announcements/soac  (admin → posts SOAC-wide) ── */
const createSOACAnnouncement = async (req, res, next) => {
  try {
    await ensureTables();
    const { title, body, tag, pinned } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({ message: 'Title is required.' });
    }

    const validTags = ['Announcement','Event','Achievement','Update','Important','Deadline','Finance'];
    const safeTag   = validTags.includes(tag) ? tag : 'Announcement';

    const audience = [...new Set((Array.isArray(req.body.audience) ? req.body.audience : AUDIENCE_ROLES)
      .filter(r => AUDIENCE_ROLES.includes(r)))];
    if (!audience.length) return res.status(400).json({ message: 'Choose who should receive this broadcast.' });
    const delivery = DELIVERY_MODES.includes(req.body.delivery) ? req.body.delivery : 'both';

    /* The email exactly as the admin reviewed / edited it on the Broadcast page */
    const EMAIL_PARTS = { subject: 300, category: 60, heading: 300, greeting: 200, body: 20000, signoff: 1000, buttonLabel: 60 };
    const rawEmail = req.body.email && typeof req.body.email === 'object' ? req.body.email : {};
    const email = Object.fromEntries(Object.entries(EMAIL_PARTS)
      .filter(([k]) => typeof rawEmail[k] === 'string')
      .map(([k, max]) => [k, rawEmail[k].replace(/\0/g, '').slice(0, max)]));

    const { rows } = await pgPool.query(
      `INSERT INTO club_announcements
         (club_id, author_id, author_name, title, body, tag, pinned, audience, delivery)
       VALUES (NULL, $1, $2, $3, $4, $5, $6, $7::text[], $8)
       RETURNING ${COLS}`,
      [
        req.user.id,
        req.user.name,
        title.trim(),
        (body || '').trim(),
        safeTag,
        !!pinned,
        audience,
        delivery,
      ]
    );

    await cache.del(...SOAC_CACHE_KEYS);
    res.status(201).json({ announcement: toAnn(rows[0]) });

    /* Dashboard notifications — fire-and-forget. Students and coordinators land
       on different routes, so this is one call per dashboard. */
    if (delivery !== 'email') {
      const staffRoles = audience.filter(r => r !== 'student');
      if (audience.includes('student')) {
        pgPool.query(`SELECT id FROM users WHERE role = 'student' AND is_active = true`)
          .then(({ rows: students }) => {
            if (!students.length) return;
            notifyManyUsers({
              userIds: students.map(s => s.id),
              title: title.trim(),
              body:  (body || '').trim().slice(0, 150),
              type:  'announcement',
              url:   '/student/soac-updates',
            });
          }).catch(() => {});
      }
      if (staffRoles.length) {
        pgPool.query(`SELECT id FROM users WHERE role = ANY($1::text[]) AND is_active = true`, [staffRoles])
          .then(({ rows: coords }) => {
            if (!coords.length) return;
            notifyManyUsers({
              userIds: coords.map(c => c.id),
              title: title.trim(),
              body:  (body || '').trim().slice(0, 150),
              type:  'announcement',
              url:   '/coordinator/soac',
            });
          }).catch(() => {});
      }
    }

    /* Email the chosen roles — each address once — with the category (Event,
       Deadline, Announcement…) clearly labelled. Background, paced by the shared
       email queue. */
    if (delivery !== 'portal') {
      pgPool.query(
        `SELECT DISTINCT ON (LOWER(u.email)) u.email, u.name, u.role
         FROM users u
         WHERE u.is_active = true
           AND u.role = ANY($1::text[])
           AND COALESCE(u.email, '') <> ''
         ORDER BY LOWER(u.email), COALESCE(u.linked_profile, false), u.id`,
        [audience]
      ).then(({ rows: members }) => {
        for (const m of members) {
          sendBroadcastEmail({
            toEmail: m.email, toName: m.name, title: title.trim(), body: (body || '').trim(), category: safeTag, email,
            buttonPath: m.role === 'student' ? '/student/soac-updates' : '/coordinator/soac',
          })
            .catch(err => console.error(`[announcements] broadcast email failed for ${m.email}:`, err.message));
        }
      }).catch(() => {});
    }
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
      : SOAC_CACHE_KEYS;
    await cache.del(...toDelete);

    res.json({ message: 'Announcement deleted.' });
  } catch (err) { next(err); }
};

module.exports = { getClubFeed, getSOACFeed, createClubAnnouncement, createSOACAnnouncement, remove };
