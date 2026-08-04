const webpush = require('web-push');
const { pgPool } = require('../config/db');

/* Push simply stays inert if VAPID keys aren't configured — same degrade-gracefully
   pattern as email.js when no provider is configured. */
const PUSH_ENABLED = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (PUSH_ENABLED) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@rku.ac.in',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  console.log('🔔 Web Push: enabled');
} else {
  console.log('🔔 Web Push: disabled (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set)');
}

/* ── Concurrency-limited send queue — same acquire/release-slot primitive as
   config/email.js, without the retry/backoff/provider-chain parts. A push failure
   is almost always "this subscription is dead, clean it up," not "the provider
   rate-limited me," so there's no backoff-retry need the way email had. */
const MAX_CONCURRENT_SENDS = 5;
let _activeSends = 0;
const _sendQueue = [];

function _acquireSlot() {
  if (_activeSends < MAX_CONCURRENT_SENDS) {
    _activeSends++;
    return Promise.resolve();
  }
  return new Promise(resolve => _sendQueue.push(resolve));
}
function _releaseSlot() {
  _activeSends--;
  const next = _sendQueue.shift();
  if (next) { _activeSends++; next(); }
}

/* Sends to one subscription row; deletes it if the push service reports it's dead
   (404/410 — the standard web-push contract for an expired/unsubscribed endpoint). */
async function _sendToSubscription(sub, payload) {
  await _acquireSlot();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      await pgPool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]).catch(() => {});
    } else {
      console.error(`[push] send failed (user ${sub.user_id}):`, err.message);
    }
    return false;
  } finally {
    _releaseSlot();
  }
}

/**
 * Push every device this user has subscribed on. Never throws — always safe to
 * call fire-and-forget, same as the existing member_notifications inserts.
 * @param {number} userId
 * @param {{title:string, body:string, url?:string, type?:string}} payload
 */
async function sendPushToUser(userId, payload) {
  if (!PUSH_ENABLED) return { sent: 0 };
  try {
    const { rows } = await pgPool.query(
      `SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
      [userId]
    );
    const results = await Promise.all(rows.map(sub => _sendToSubscription(sub, payload)));
    return { sent: results.filter(Boolean).length };
  } catch (err) {
    console.error('[push] sendPushToUser error:', err.message);
    return { sent: 0 };
  }
}

/**
 * Push to many users at once (announcements, group chat fan-out). Concurrency is
 * already bounded per-subscription by the slot queue above, so this just maps over
 * users — no separate batching needed.
 * @param {number[]} userIds
 */
async function sendPushToUsers(userIds, payload) {
  if (!PUSH_ENABLED || !userIds.length) return { sent: 0 };
  try {
    const { rows } = await pgPool.query(
      `SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::int[])`,
      [userIds]
    );
    const results = await Promise.all(rows.map(sub => _sendToSubscription(sub, payload)));
    return { sent: results.filter(Boolean).length };
  } catch (err) {
    console.error('[push] sendPushToUsers error:', err.message);
    return { sent: 0 };
  }
}

module.exports = { sendPushToUser, sendPushToUsers, PUSH_ENABLED };
