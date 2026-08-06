const { messaging, FIREBASE_ENABLED } = require('./firebaseAdmin');
const { pgPool } = require('../config/db');

const PUSH_ENABLED = FIREBASE_ENABLED;

/* ── Concurrency-limited send queue — same acquire/release-slot primitive as
   config/email.js, without the retry/backoff/provider-chain parts. A push failure
   is almost always "this token is dead, clean it up," not "the provider
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

/* Sends to one FCM token; deletes the row if Firebase reports the token is
   dead (unregistered/invalid — the standard FCM contract for an expired
   registration). Data-only payload (no top-level "notification" key) so the
   service worker's onBackgroundMessage is always the single source of truth
   for what gets displayed — a "notification" payload would make some
   browsers auto-display a system notification too, causing duplicates. */
async function _sendToSubscription(sub, payload) {
  await _acquireSlot();
  try {
    const data = {
      title: String(payload.title || 'SOAC RKU'),
      body:  String(payload.body  || ''),
      url:   String(payload.url   || '/'),
      type:  String(payload.type  || ''),
    };
    if (payload.badge != null) data.badge = String(payload.badge);
    await messaging.send({
      token: sub.fcm_token,
      data,
      webpush: { fcmOptions: { link: payload.url || '/' } },
    });
    return true;
  } catch (err) {
    const code = err.code || '';
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      console.log(`[push] dropping stale token (user ${sub.user_id}, subscription ${sub.id}): ${code}`);
      await pgPool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]).catch(() => {});
    } else {
      console.error(`[push] send failed (user ${sub.user_id}): code=${code} message=${err.message}`);
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
      `SELECT id, user_id, fcm_token FROM push_subscriptions WHERE user_id = $1`,
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
 * @param {object} payload
 * @param {Object<number,number>} [badgeByUserId] — per-recipient unread count
 *   (unread totals differ per user, so a single shared payload can't carry it)
 */
async function sendPushToUsers(userIds, payload, badgeByUserId = null) {
  if (!PUSH_ENABLED || !userIds.length) return { sent: 0 };
  try {
    const { rows } = await pgPool.query(
      `SELECT id, user_id, fcm_token FROM push_subscriptions WHERE user_id = ANY($1::int[])`,
      [userIds]
    );
    const results = await Promise.all(rows.map(sub => {
      const badge = badgeByUserId ? badgeByUserId[sub.user_id] : undefined;
      return _sendToSubscription(sub, badge != null ? { ...payload, badge } : payload);
    }));
    return { sent: results.filter(Boolean).length };
  } catch (err) {
    console.error('[push] sendPushToUsers error:', err.message);
    return { sent: 0 };
  }
}

module.exports = { sendPushToUser, sendPushToUsers, PUSH_ENABLED };
