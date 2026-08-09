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

const MAX_SEND_ATTEMPTS = 3;
const RETRY_DELAY_MS = [300, 900]; // between attempts 1→2 and 2→3

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/* Codes that mean "this token is permanently dead" — retrying changes nothing,
   drop the row immediately. Anything else (network blips, transient FCM-side
   errors, quota hiccups) is worth a couple of quick retries before giving up,
   since those are exactly the kind of failure that silently drops a
   notification for no recoverable reason otherwise. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/* Sends to one FCM token; deletes the row if Firebase reports the token is
   dead (the standard FCM contract for an expired registration). Data-only
   payload (no top-level "notification" key) so the service worker's
   onBackgroundMessage is always the single source of truth for what gets
   displayed — a "notification" payload would make some browsers auto-display
   a system notification too, causing duplicates. */
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
    const message = {
      token: sub.fcm_token,
      data,
      /* Data-only messages default to normal/low priority without this —
         FCM can then legitimately defer, batch, or drop delivery once a
         device is idle or battery-saving, which matches exactly what we saw:
         send() succeeds and returns a real message ID every time, but the
         message never actually reaches the device except sporadically.
         Explicit high priority on every platform is required for prompt,
         reliable delivery of data-only payloads. */
      android: { priority: 'high' },
      webpush: {
        headers: { Urgency: 'high' },
        fcmOptions: { link: payload.url || '/' },
      },
      apns: { headers: { 'apns-priority': '10' } },
    };

    let lastErr;
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      try {
        const messageId = await messaging.send(message);
        console.log(`[push] sent OK (user ${sub.user_id}, subscription ${sub.id}, attempt ${attempt}): ${messageId}`);
        return true;
      } catch (err) {
        lastErr = err;
        const code = err.code || '';
        if (DEAD_TOKEN_CODES.has(code)) {
          console.log(`[push] dropping stale token (user ${sub.user_id}, subscription ${sub.id}): ${code}`);
          await pgPool.query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]).catch(() => {});
          return false;
        }
        if (attempt < MAX_SEND_ATTEMPTS) {
          console.warn(`[push] send attempt ${attempt} failed (user ${sub.user_id}): code=${code} message=${err.message} — retrying`);
          await sleep(RETRY_DELAY_MS[attempt - 1]);
        }
      }
    }
    console.error(`[push] send failed after ${MAX_SEND_ATTEMPTS} attempts (user ${sub.user_id}): code=${lastErr.code || ''} message=${lastErr.message}`);
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
  if (!PUSH_ENABLED) {
    console.log(`[push] sendPushToUser(${userId}): skipped, PUSH_ENABLED=false`);
    return { sent: 0 };
  }
  try {
    const { rows } = await pgPool.query(
      `SELECT id, user_id, fcm_token FROM push_subscriptions WHERE user_id = $1`,
      [userId]
    );
    console.log(`[push] sendPushToUser(${userId}): found ${rows.length} subscription(s)`);
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
