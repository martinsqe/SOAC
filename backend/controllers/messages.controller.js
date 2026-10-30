/**
 * Direct messages + conversation list.
 * Group chat messages stay in clubDetail.controller.js (club_messages table).
 */
const { pgPool } = require('../config/db');
const { ensureSoacTables } = require('../services/soacData');
const { notifyUser } = require('../services/notify');
const { getCoordClubIds, getClubCoordinatorIds } = require('../services/coordAuth');
const { adminCampus } = require('../services/campus');
const { notifyDirectMessage } = require('../services/chatNotify');

/* The club a DM is "from": a club both people belong to (as member or staff),
   else the sender's own club; admins write as SOAC. */
const dmFromLabel = async (senderId, senderRole, recipientId) => {
  if (senderRole === 'admin') return 'SOAC';
  const { rows } = await pgPool.query(
    `WITH links AS (
       SELECT user_id, club_id FROM student_clubs WHERE is_active = true
       UNION
       SELECT user_id, club_id FROM coordinator_club_assignments WHERE is_active = true
     )
     SELECT c.name, (b.user_id IS NOT NULL) AS shared
     FROM links a
     JOIN clubs c ON c.id = a.club_id AND c.is_active = true
     LEFT JOIN links b ON b.club_id = a.club_id AND b.user_id = $2
     WHERE a.user_id = $1
     ORDER BY shared DESC, c.name
     LIMIT 1`,
    [senderId, recipientId]
  );
  return rows[0]?.name || 'SOAC';
};

/* Student Coordinator and Faculty Coordinator share coordinator_club_assignments
   and both count as "the coordinators of a club" for DM purposes below. */
const isCoordLike = (role) => role === 'coordinator' || role === 'faculty_coordinator';

/* Students may DM admins and the coordinators (Student or Faculty) of clubs they
   belong to, never another student. Coordinators may DM admins, other
   coordinators (either tier), and students in clubs they manage. Admin is
   unrestricted on both sides. Checked symmetrically since either party can call
   sendDM. Uses getClubCoordinatorIds() (not a direct coordinator_club_assignments
   join) so a coordinator with a stale/missing assignment row — the exact problem
   coordAuth.js exists to paper over — doesn't become unreachable by their
   own students. */
async function isDmAllowed(userA, roleA, userB, roleB) {
  if (roleA === 'admin' || roleB === 'admin') return true;
  if (isCoordLike(roleA) && isCoordLike(roleB)) return true;

  let studentId, coordinatorId;
  if (roleA === 'student' && isCoordLike(roleB))      { studentId = userA; coordinatorId = userB; }
  else if (isCoordLike(roleA) && roleB === 'student') { studentId = userB; coordinatorId = userA; }
  else return false; // student <-> student, or any other combination

  const { rows: memberships } = await pgPool.query(
    `SELECT club_id FROM student_clubs WHERE user_id = $1 AND is_active = true`,
    [studentId]
  );
  for (const m of memberships) {
    const coordIds = await getClubCoordinatorIds(m.club_id);
    if (coordIds.includes(coordinatorId)) return true;
  }
  return false;
}

/* ── GET /api/messages/conversations ───────────────────────────────────────
   Returns all group chats (clubs student joined) + DM threads, each with
   the latest message preview, sorted newest-first. */
const getConversations = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const uid = req.user.id;

    /* 1. Group chats — admin sees every club of the campus they're managing;
          others see only their joined clubs */
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
         WHERE c.is_active = true AND c.campus = $1
         ORDER BY lm.created_at DESC NULLS LAST, c.name ASC`,
        [adminCampus(req)]
      );
      groups = rows;
    } else {
      /* Clubs they've joined, plus — for FAs / SCs — every club they manage */
      const staffClubIds = isCoordLike(req.user.role) ? (await getCoordClubIds(uid)).map(Number) : [];
      const { rows } = await pgPool.query(
        `SELECT
           c.id::text        AS id,
           c.name,
           c.color,
           c.logo,
           lm.content        AS last_message,
           lm.user_name      AS last_sender,
           lm.created_at     AS last_at
         FROM clubs c
         LEFT JOIN LATERAL (
           SELECT content, user_name, created_at
           FROM   club_messages
           WHERE  club_id = c.id
           ORDER  BY created_at DESC
           LIMIT  1
         ) lm ON true
         WHERE c.is_active = true
           AND (c.id IN (SELECT club_id FROM student_clubs WHERE user_id = $1 AND is_active = true)
                OR c.id = ANY($2::bigint[]))
         ORDER BY lm.created_at DESC NULLS LAST, c.name ASC`,
        [uid, staffClubIds]
      );
      groups = rows;
    }

    /* Unread count per group chat (messages from others since they last opened it) */
    const unread = await clubChatUnread(uid, groups.map(g => g.id));
    groups.forEach(g => { g.unread_count = unread.get(String(g.id)) || 0; });

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

    /* Mark unread messages as read — and the matching "sent you a message"
       notifications, so the bell and the chat counts agree */
    pgPool.query(
      `UPDATE direct_messages SET read_at = NOW()
       WHERE to_user = $1 AND from_user = $2 AND read_at IS NULL`,
      [me, other]
    ).catch(() => {});
    pgPool.query(
      `UPDATE member_notifications SET is_read = true
       WHERE user_id = $1 AND type = 'message' AND is_read = false AND url LIKE '%?dm=' || $2::text`,
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

    const { rows: check } = await pgPool.query(`SELECT id, role FROM users WHERE id = $1`, [other]);
    if (!check.length) return res.status(404).json({ message: 'User not found.' });

    const allowed = await isDmAllowed(me, req.user.role, other, check[0].role);
    if (!allowed) {
      return res.status(403).json({ message: 'You can only message admins and your club coordinators.' });
    }

    const { rows: ur } = await pgPool.query(`SELECT avatar, name FROM users WHERE id = $1`, [me]);

    const { rows } = await pgPool.query(
      `INSERT INTO direct_messages (from_user, to_user, content)
       VALUES ($1, $2, $3)
       RETURNING id, from_user, to_user, content, read_at, created_at`,
      [me, other, content.trim()]
    );

    res.status(201).json({
      message: {
        ...rows[0],
        from_name:   ur[0]?.name || req.user.name,
        from_avatar: ur[0]?.avatar || '',
      },
    });

    /* In-app notice + email to the recipient, linking into their OWN portal's
       messages page (see services/chatNotify.js). fromLabel = the club the DM
       is about, or "SOAC" for an admin. */
    dmFromLabel(me, req.user.role, other)
      .catch(() => '')
      .then(fromLabel => notifyDirectMessage({ sender: req.user, recipientId: other, content, fromLabel }));
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
      /* Admin: every active member of the campus's clubs, excluding themselves */
      ({ rows } = await pgPool.query(
        `SELECT DISTINCT ON (u.id)
           u.id, u.name, u.avatar, u.role,
           sc.club_name, sc.club_id::text AS club_id,
           COALESCE(jr.dept, '') AS dept,
           COALESCE(jr.year, '') AS year
         FROM student_clubs sc
         JOIN clubs c ON c.id = sc.club_id AND c.campus = $2
         JOIN users u ON u.id = sc.user_id AND u.is_active = true AND u.id != $1
         LEFT JOIN LATERAL (
           SELECT dept, year FROM join_requests
           WHERE email = u.email AND status = 'approved'
           ORDER BY created_at DESC
           LIMIT 1
         ) jr ON true
         ORDER BY u.id, u.name`,
        [uid, adminCampus(req)]
      ));
    } else if (isCoordLike(req.user.role)) {
      /* Coordinator: any admin/coordinator, plus only students in clubs THEY
         manage (not every club's members). */
      const clubIds = (await getCoordClubIds(uid)).map(Number);
      ({ rows } = await pgPool.query(
        `SELECT DISTINCT ON (u.id)
           u.id, u.name, u.avatar, u.role,
           CASE WHEN u.role = 'admin' THEN 'SOAC Admin' ELSE COALESCE(sc.club_name, '') END AS club_name,
           COALESCE(sc.club_id::text, '') AS club_id,
           COALESCE(jr.dept, '') AS dept,
           COALESCE(jr.year, '') AS year
         FROM users u
         LEFT JOIN student_clubs sc ON sc.user_id = u.id AND sc.is_active = true
         LEFT JOIN LATERAL (
           SELECT dept, year FROM join_requests
           WHERE email = u.email AND status = 'approved'
           ORDER BY created_at DESC
           LIMIT 1
         ) jr ON true
         WHERE u.is_active = true AND u.id != $1
           AND (
             u.role IN ('coordinator', 'faculty_coordinator', 'admin')
             OR (u.role = 'student' AND sc.club_id = ANY($2::bigint[]))
           )
         ORDER BY u.id, sc.club_id NULLS LAST`,
        [uid, clubIds]
      ));
    } else {
      /* Student: admins and the coordinators of clubs they belong to —
         never a fellow student. */
      const { rows: memberships } = await pgPool.query(
        `SELECT club_id, club_name FROM student_clubs WHERE user_id = $1 AND is_active = true`,
        [uid]
      );
      const clubNameByCoord = new Map();
      for (const m of memberships) {
        const coordIds = await getClubCoordinatorIds(m.club_id);
        coordIds.forEach(id => { if (!clubNameByCoord.has(id)) clubNameByCoord.set(id, m.club_name); });
      }
      const coordIds = [...clubNameByCoord.keys()];
      const { rows: userRows } = await pgPool.query(
        `SELECT id, name, avatar, role FROM users
         WHERE is_active = true AND id != $1 AND (role = 'admin' OR id = ANY($2::int[]))
         ORDER BY name`,
        [uid, coordIds]
      );
      rows = userRows.map(u => ({
        ...u,
        club_name: u.role === 'admin' ? 'SOAC Admin' : (clubNameByCoord.get(u.id) || ''),
        club_id: '', dept: '', year: '',
      }));
    }

    res.json({ members: rows });
  } catch (err) { next(err); }
};

/* ── Club group chat read tracking ─────────────────────────────────────────
   club_chat_reads remembers when each person last opened each club's chat, so
   the unread counts are the same on every device. A chat someone has never
   opened starts counting from the first time it's listed for them. */
let readsReady = null;
const ensureReads = () => {
  if (!readsReady) {
    readsReady = pgPool.query(
      `CREATE TABLE IF NOT EXISTS club_chat_reads (
         user_id      INT    NOT NULL,
         club_id      BIGINT NOT NULL,
         last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         PRIMARY KEY (user_id, club_id)
       )`
    ).catch((err) => { readsReady = null; throw err; });
  }
  return readsReady;
};

/* Map of clubId → number of messages from others since the user last read it */
const clubChatUnread = async (uid, clubIds) => {
  const ids = clubIds.map(Number).filter(Boolean);
  if (!ids.length) return new Map();
  await ensureReads();
  await pgPool.query(
    `INSERT INTO club_chat_reads (user_id, club_id, last_read_at)
     SELECT $1, unnest($2::bigint[]), NOW()
     ON CONFLICT (user_id, club_id) DO NOTHING`,
    [uid, ids]
  );
  const { rows } = await pgPool.query(
    `SELECT cm.club_id::text AS id, COUNT(*)::int AS cnt
     FROM club_messages cm
     JOIN club_chat_reads r ON r.user_id = $1 AND r.club_id = cm.club_id
     WHERE cm.club_id = ANY($2::bigint[]) AND cm.user_id IS DISTINCT FROM $1
       AND cm.created_at > r.last_read_at
     GROUP BY cm.club_id`,
    [uid, ids]
  );
  return new Map(rows.map(r => [r.id, r.cnt]));
};

/* ── POST /api/messages/groups/:clubId/read ──────────────────────────────────
   The user has the club chat open: reset its count and clear that chat's
   message notifications. */
const markGroupRead = async (req, res, next) => {
  try {
    const clubId = parseInt(req.params.clubId, 10);
    if (isNaN(clubId)) return res.status(400).json({ message: 'Invalid club.' });
    await ensureReads();
    await pgPool.query(
      `INSERT INTO club_chat_reads (user_id, club_id, last_read_at) VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, club_id) DO UPDATE SET last_read_at = NOW()`,
      [req.user.id, clubId]
    );
    pgPool.query(
      `UPDATE member_notifications SET is_read = true
       WHERE user_id = $1 AND club_id = $2 AND type = 'message' AND is_read = false`,
      [req.user.id, clubId]
    ).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
};

module.exports = { getConversations, getDMs, sendDM, getClubMembers, markGroupRead };
