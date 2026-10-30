/* One place for "someone sent a message" notices — club group chat and DMs.

   Every message → an in-app notification (and push) to everyone it concerns,
   linking straight to that chat in the recipient's own dashboard.
   Email → "Hey <name>, <sender> just sent a message to <club> club chat / you a
   DM. Please check it out." — at most once per conversation per recipient every
   EMAIL_COOLDOWN_MIN, so a burst of messages doesn't flood inboxes. The message
   text itself is never emailed: people log in to read it. Never throws. */
const { pgPool } = require('../config/db');
const { notifyManyUsers } = require('./notify');
const { sendMessageNotice } = require('../config/email');

const EMAIL_COOLDOWN_MIN = 15;
/* The sender's name as it is in their profile right now — the login token keeps
   the name from when they signed in, which may have been changed since. */
const currentName = async (sender) => {
  const { rows } = await pgPool.query(`SELECT name FROM users WHERE id = $1`, [sender.id]);
  return String(rows[0]?.name || sender.name || 'Someone').trim();
};

const isStaff = (role) => role === 'coordinator' || role === 'faculty_coordinator';

/* Where the chat lives in each portal */
const clubChatUrl = (role, clubId) =>
  role === 'admin' ? `/admin/chats?club=${clubId}`
  : isStaff(role)  ? `/coordinator/messages?club=${clubId}`
  :                  `/student/messages?club=${clubId}`;
const dmUrl = (role, senderId) =>
  role === 'admin' ? `/admin/chats?dm=${senderId}`
  : isStaff(role)  ? `/coordinator/messages?dm=${senderId}`
  :                  `/student/messages?dm=${senderId}`;

let logReady = null;
const ensureLog = () => {
  if (!logReady) {
    logReady = pgPool.query(
      `CREATE TABLE IF NOT EXISTS chat_email_log (
         user_id      INT  NOT NULL,
         thread_key   TEXT NOT NULL,
         last_sent_at TIMESTAMPTZ NOT NULL,
         PRIMARY KEY (user_id, thread_key)
       )`
    ).catch((err) => { logReady = null; throw err; });
  }
  return logReady;
};

/* Returns the ids (of those given) not emailed about this thread recently,
   and marks them as emailed now — atomic, so parallel sends can't double up. */
const claimEmailSlots = async (userIds, threadKey) => {
  if (!userIds.length) return new Set();
  await ensureLog();
  const { rows } = await pgPool.query(
    `INSERT INTO chat_email_log (user_id, thread_key, last_sent_at)
     SELECT unnest($1::int[]), $2, NOW()
     ON CONFLICT (user_id, thread_key) DO UPDATE SET last_sent_at = NOW()
       WHERE chat_email_log.last_sent_at < NOW() - make_interval(mins => $3)
     RETURNING user_id`,
    [userIds, threadKey, EMAIL_COOLDOWN_MIN]
  );
  return new Set(rows.map(r => r.user_id));
};

/* In-app notice to each recipient, grouped by destination link */
const notifyGrouped = (people, urlFor, { clubId, title, body }) => {
  const byUrl = new Map();
  for (const p of people) {
    const url = urlFor(p);
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(p.id);
  }
  for (const [url, userIds] of byUrl) {
    notifyManyUsers({ userIds, clubId, title, body, type: 'message', url }).catch(() => {});
  }
};

const emailClaimed = async (people, threadKey, buildArgs) => {
  const ok = await claimEmailSlots(people.filter(p => p.email).map(p => p.id), threadKey);
  for (const p of people) {
    if (!ok.has(p.id)) continue;
    sendMessageNotice(buildArgs(p)).catch(err => console.error(`[chat] email failed for ${p.email}:`, err.message));
  }
};

/* Club group chat: the club's students, its Faculty Advisors / Student
   Coordinators and every admin — everyone except the sender. */
const notifyClubChatMessage = async ({ clubId, sender, content }) => {
  try {
    const senderName = await currentName(sender);
    const { rows: club } = await pgPool.query(`SELECT name FROM clubs WHERE id = $1::bigint`, [clubId]);
    const clubName = club[0]?.name || 'your club';
    const { rows: people } = await pgPool.query(
      `SELECT DISTINCT ON (u.id) u.id, u.name, u.role, NULLIF(u.email, '') AS email
       FROM users u
       LEFT JOIN student_clubs sc ON sc.user_id = u.id AND sc.club_id = $1::bigint AND sc.is_active = true
       LEFT JOIN coordinator_club_assignments cca ON cca.user_id = u.id AND cca.club_id = $1::bigint AND cca.is_active = true
       WHERE u.is_active = true AND u.id <> $2
         AND (u.role = 'admin'
              OR (u.role = 'student' AND sc.user_id IS NOT NULL)
              OR (u.role IN ('coordinator', 'faculty_coordinator')
                  AND (cca.id IS NOT NULL OR u.managed_club_id = $1::bigint)))
       ORDER BY u.id`,
      [clubId, sender.id]
    );
    if (!people.length) return;

    notifyGrouped(people, p => clubChatUrl(p.role, clubId), {
      clubId,
      title: `${senderName} · ${clubName} club chat`,
      body:  String(content || '').slice(0, 120),
    });

    await emailClaimed(people, `club:${clubId}`, (p) => ({
      toEmail: p.email, toName: p.name, senderName,
      where: 'club', clubName, url: clubChatUrl(p.role, clubId),
    }));
  } catch (err) { console.error('[chat] club chat notify failed:', err.message); }
};

/* Direct message: just the recipient. fromLabel = the club the DM is about
   (or "SOAC" when an admin writes). */
const notifyDirectMessage = async ({ sender, recipientId, content, fromLabel }) => {
  try {
    const senderName = await currentName(sender);
    const { rows } = await pgPool.query(
      `SELECT id, name, role, NULLIF(email, '') AS email FROM users WHERE id = $1 AND is_active = true`,
      [recipientId]
    );
    if (!rows.length) return;
    const p = rows[0];
    const url = dmUrl(p.role, sender.id);

    notifyGrouped([p], () => url, {
      clubId: null,
      title: `${senderName} · DM${fromLabel ? ` (${fromLabel})` : ''}`,
      body:  String(content || '').slice(0, 120),
    });

    await emailClaimed([p], `dm:${sender.id}`, () => ({
      toEmail: p.email, toName: p.name, senderName,
      where: 'dm', clubName: fromLabel, url,
    }));
  } catch (err) { console.error('[chat] DM notify failed:', err.message); }
};

module.exports = { notifyClubChatMessage, notifyDirectMessage };
