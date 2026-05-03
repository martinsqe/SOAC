/**
 * Direct messages + conversation list.
 * Group chat messages stay in clubDetail.controller.js (club_messages table).
 */
const { pgPool } = require('../config/db');
const { ensureSoacTables } = require('../services/soacData');

/* ── GET /api/messages/conversations ───────────────────────────────────────
   Returns all group chats (clubs student joined) + DM threads, each with
   the latest message preview, sorted newest-first. */
const getConversations = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const uid = req.user.id;

    /* 1. Group chats — admin sees ALL clubs; others see only their joined clubs */
    let groups;
    if (req.user.role === 'admin') {
      const { rows } = await pgPool.query(
        `SELECT
           c.id::text     AS id,
           c.name,
           c.color,
           c.logo,
           lm.content     AS last_message,
           lm.user_name   AS last_sender,
           lm.created_at  AS last_at
         FROM clubs c
         LEFT JOIN LATERAL (
           SELECT content, user_name, created_at
           FROM   club_messages
           WHERE  club_id = c.id
           ORDER  BY created_at DESC
           LIMIT  1
         ) lm ON true
         WHERE c.is_active = true
         ORDER BY lm.created_at DESC NULLS LAST, c.name ASC`
      );
      groups = rows;
    } else {
      const { rows } = await pgPool.query(
        `SELECT
           sc.club_id::text  AS id,
           sc.club_name      AS name,
           c.color,
           c.logo,
           lm.content        AS last_message,
           lm.user_name      AS last_sender,
           lm.created_at     AS last_at
         FROM student_clubs sc
         JOIN clubs c ON c.id = sc.club_id AND c.is_active = true
         LEFT JOIN LATERAL (
           SELECT content, user_name, created_at
           FROM   club_messages
           WHERE  club_id = sc.club_id
           ORDER  BY created_at DESC
           LIMIT  1
         ) lm ON true
         WHERE sc.user_id = $1
         ORDER BY lm.created_at DESC NULLS LAST, sc.joined_at DESC`,
        [uid]
      );
      groups = rows;
    }

    /* 2. DM threads — latest message per partner + unread count */
    const { rows: dms } = await pgPool.query(
      `WITH all_msgs AS (
         SELECT
           CASE WHEN from_user = $1 THEN to_user ELSE from_user END AS partner_id,
           content, created_at, (from_user = $1) AS is_mine
         FROM direct_messages
         WHERE from_user = $1 OR to_user = $1
       ),
       unread AS (
         SELECT from_user AS partner_id, COUNT(*)::int AS cnt
         FROM direct_messages
         WHERE to_user = $1 AND read_at IS NULL
         GROUP BY from_user
       )
       SELECT DISTINCT ON (a.partner_id)
         a.partner_id,
         u.name   AS partner_name,
         u.avatar AS partner_avatar,
         a.content    AS last_message,
         a.created_at AS last_at,
         a.is_mine,
         COALESCE(un.cnt, 0) AS unread_count
       FROM all_msgs a
       JOIN users u ON u.id = a.partner_id
       LEFT JOIN unread un ON un.partner_id = a.partner_id
       ORDER BY a.partner_id, a.created_at DESC`,
      [uid]
    );

    res.json({ groups, dms });
  } catch (err) { next(err); }
};

/* ── GET /api/messages/dm/:userId ──────────────────────────────────────────
   Returns messages in the DM thread between current user and :userId.
   Permission check: Current user must be a participant in the conversation.
   ?limit=60   — page size
   ?after=<id> — poll: new messages since id
   ?before=<id>— load older messages */
const getDMs = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const me    = req.user.id;
    const other = parseInt(req.params.userId, 10);
    if (isNaN(other)) return res.status(400).json({ message: 'Invalid user id.' });
    if (me === other) return res.status(400).json({ message: 'Cannot message yourself.' });

    const limit  = Math.min(100, parseInt(req.query.limit, 10) || 60);
    const { after, before } = req.query;

    /* Fetch partner info */
    const { rows: partnerRows } = await pgPool.query(
      `SELECT id, name, avatar, role FROM users WHERE id = $1 AND is_active = true`,
      [other]
    );
    if (!partnerRows.length) return res.status(404).json({ message: 'User not found.' });

    // SECURITY: Verify current user is participant in this DM thread
    // This prevents users from reading arbitrary DM conversations
    const { rows: participantCheck } = await pgPool.query(
      `SELECT 1 FROM direct_messages
       WHERE (from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1)
       LIMIT 1`,
      [me, other]
    );
    if (!participantCheck.length) {
      return res.status(403).json({ message: 'No conversation found.' });
    }

    const values = [me, other, other, me];
    let extra = '';
    if (after)  { values.push(after);  extra = ` AND dm.id > $${values.length}::bigint`; }
    if (before) { values.push(before); extra = ` AND dm.id < $${values.length}::bigint`; }
    values.push(limit);

    const { rows } = await pgPool.query(
      `SELECT dm.id, dm.from_user, dm.to_user, dm.content, dm.read_at, dm.created_at,
              u.name AS from_name, u.avatar AS from_avatar
       FROM   direct_messages dm
       JOIN   users u ON u.id = dm.from_user
       WHERE  ((dm.from_user = $1 AND dm.to_user = $2)
            OR (dm.from_user = $3 AND dm.to_user = $4))
              ${extra}
       ORDER  BY ${after ? 'dm.created_at ASC' : 'dm.created_at DESC'}
       LIMIT  $${values.length}`,
      values
    );

    /* Mark unread messages as read */
    pgPool.query(
      `UPDATE direct_messages SET read_at = NOW()
       WHERE to_user = $1 AND from_user = $2 AND read_at IS NULL`,
      [me, other]
    ).catch(() => {});

    res.json({
      messages: after ? rows : rows.reverse(),
      partner:  partnerRows[0],
    });
  } catch (err) { next(err); }
};

/* ── POST /api/messages/dm/:userId ─────────────────────────────────────── */
const sendDM = async (req, res, next) => {
  try {
    let { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ message: 'Message is required.' });

    /* Sanitise: strip null bytes, normalise line endings */
    content = content.replace(/\0/g, '').replace(/\r\n|\r/g, '\n').trim();
    if (!content) return res.status(400).json({ message: 'Message is required.' });
    if (content.length > 2000) return res.status(400).json({ message: 'Message too long.' });

    const me    = req.user.id;
    const other = parseInt(req.params.userId, 10);
    if (isNaN(other) || me === other) {
      return res.status(400).json({ message: 'Invalid recipient.' });
    }

    const { rows: check } = await pgPool.query(`SELECT id FROM users WHERE id = $1`, [other]);
    if (!check.length) return res.status(404).json({ message: 'User not found.' });

    const { rows: ur } = await pgPool.query(`SELECT avatar FROM users WHERE id = $1`, [me]);

    const { rows } = await pgPool.query(
      `INSERT INTO direct_messages (from_user, to_user, content)
       VALUES ($1, $2, $3)
       RETURNING id, from_user, to_user, content, read_at, created_at`,
      [me, other, content.trim()]
    );

    res.status(201).json({
      message: {
        ...rows[0],
        from_name:   req.user.name,
        from_avatar: ur[0]?.avatar || '',
      },
    });
  } catch (err) { next(err); }
};

/* ── GET /api/messages/members ─────────────────────────────────────────────
   Returns all distinct members across every club the current user has joined,
   excluding themselves. Used by the "New Message" compose panel. */
const getClubMembers = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const uid = req.user.id;

    let rows;
    if (req.user.role === 'admin') {
      /* Admin: every active user across all clubs, excluding themselves */
      ({ rows } = await pgPool.query(
        `SELECT DISTINCT ON (u.id)
           u.id, u.name, u.avatar, u.role,
           sc.club_name, sc.club_id::text AS club_id,
           COALESCE(jr.dept, '') AS dept,
           COALESCE(jr.year, '') AS year
         FROM student_clubs sc
         JOIN users u ON u.id = sc.user_id AND u.is_active = true AND u.id != $1
         LEFT JOIN LATERAL (
           SELECT dept, year FROM join_requests
           WHERE email = u.email AND status = 'approved'
           ORDER BY created_at DESC
           LIMIT 1
         ) jr ON true
         ORDER BY u.id, u.name`,
        [uid]
      ));
    } else {
      /* Students + coordinators: clubmates OR any coordinator/admin */
      ({ rows } = await pgPool.query(
        `SELECT DISTINCT ON (u.id)
           u.id, u.name, u.avatar, u.role,
           CASE WHEN u.role = 'admin' THEN 'SOAC Admin'
                ELSE COALESCE(sc.club_name, '')
           END AS club_name,
           COALESCE(sc.club_id::text, '') AS club_id,
           COALESCE(jr.dept, '') AS dept,
           COALESCE(jr.year, '') AS year
         FROM users u
         LEFT JOIN student_clubs sc ON sc.user_id = u.id
         LEFT JOIN LATERAL (
           SELECT dept, year FROM join_requests
           WHERE email = u.email AND status = 'approved'
           ORDER BY created_at DESC
           LIMIT 1
         ) jr ON true
         WHERE u.is_active = true AND u.id != $1
           AND (
             u.role IN ('coordinator', 'admin')
             OR EXISTS (
               SELECT 1 FROM student_clubs me
               JOIN student_clubs other
                 ON other.club_id = me.club_id AND other.user_id = u.id
               WHERE me.user_id = $1
             )
           )
         ORDER BY u.id, sc.club_id NULLS LAST`,
        [uid]
      ));
    }

    res.json({ members: rows });
  } catch (err) { next(err); }
};

module.exports = { getConversations, getDMs, sendDM, getClubMembers };
