const { pgPool } = require('../config/db');
const { sendPushToUser, sendPushToUsers } = require('./webPush');

/* Central seam for "notify this user of something" — every trigger point calls
   through here instead of touching member_notifications or webPush.js directly.
   Writes both the in-app notification and the push message; each is independently
   try/caught so one channel failing never blocks the other. Never throws — always
   safe to call fire-and-forget. */
async function notifyUser({ userId, clubId = null, title, body, type, url = '/' }) {
  try {
    await pgPool.query(
      `INSERT INTO member_notifications (user_id, club_id, title, body, type)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, clubId, title, body, type]
    );
  } catch (e) { console.error('[notify] member_notifications insert failed:', e.message); }
  sendPushToUser(userId, { title, body, url, type }).catch(() => {});
}

/* Fan-out variant — same title/body/type/url to many users at once (announcements,
   group chat, SOAC-wide notices). One multi-row insert instead of N round trips. */
async function notifyManyUsers({ userIds, clubId = null, title, body, type, url = '/' }) {
  if (!userIds?.length) return;
  try {
    await pgPool.query(
      `INSERT INTO member_notifications (user_id, club_id, title, body, type)
       SELECT unnest($1::int[]), $2, $3, $4, $5`,
      [userIds, clubId, title, body, type]
    );
  } catch (e) { console.error('[notify] batch insert failed:', e.message); }
  sendPushToUsers(userIds, { title, body, url, type }).catch(() => {});
}

module.exports = { notifyUser, notifyManyUsers };
