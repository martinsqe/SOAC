const { pgPool } = require('../config/db');
const { sendPushToUser, sendPushToUsers } = require('./webPush');

/* Central seam for "notify this user of something" — every trigger point calls
   through here instead of touching member_notifications or webPush.js directly.
   Writes both the in-app notification and the push message; each is independently
   try/caught so one channel failing never blocks the other. Never throws — always
   safe to call fire-and-forget. */
async function notifyUser({ userId, clubId = null, title, body, type, url = '/' }) {
  console.log(`[notify] notifyUser called: userId=${userId} type=${type}`);
  try {
    await pgPool.query(
      `INSERT INTO member_notifications (user_id, club_id, title, body, type)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, clubId, title, body, type]
    );
  } catch (e) { console.error('[notify] member_notifications insert failed:', e.message); }

  /* The push payload carries the recipient's current unread total so the
     service worker can set the OS app-icon badge straight from the push
     event — it has no logged-in session/localStorage to call the API itself. */
  let badge;
  try {
    const { rows } = await pgPool.query(
      `SELECT COUNT(*)::int AS count FROM member_notifications WHERE user_id = $1 AND is_read = false`,
      [userId]
    );
    badge = rows[0]?.count;
  } catch { /* badge is best-effort — push still sends without it */ }

  sendPushToUser(userId, { title, body, url, type, badge }).catch(() => {});
}

/* Fan-out variant — same title/body/type/url to many users at once (announcements,
   group chat, SOAC-wide notices). One multi-row insert instead of N round trips.
   Each recipient still gets their OWN badge count (unread totals differ per user),
   resolved via one grouped query rather than N individual round trips. */
async function notifyManyUsers({ userIds, clubId = null, title, body, type, url = '/' }) {
  if (!userIds?.length) return;
  try {
    await pgPool.query(
      `INSERT INTO member_notifications (user_id, club_id, title, body, type)
       SELECT unnest($1::int[]), $2, $3, $4, $5`,
      [userIds, clubId, title, body, type]
    );
  } catch (e) { console.error('[notify] batch insert failed:', e.message); }

  let badgeByUserId = null;
  try {
    const { rows } = await pgPool.query(
      `SELECT user_id, COUNT(*)::int AS count FROM member_notifications
       WHERE user_id = ANY($1::int[]) AND is_read = false GROUP BY user_id`,
      [userIds]
    );
    badgeByUserId = {};
    rows.forEach(r => { badgeByUserId[r.user_id] = r.count; });
  } catch { /* badge is best-effort — push still sends without it */ }

  sendPushToUsers(userIds, { title, body, url, type }, badgeByUserId).catch(() => {});
}

module.exports = { notifyUser, notifyManyUsers };
