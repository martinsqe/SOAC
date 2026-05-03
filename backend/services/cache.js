/**
 * Cache utility — thin wrapper around the Redis client.
 *
 * All helpers are no-ops when Redis is not ready, so the app
 * continues to work correctly without a Redis instance.
 *
 * Key namespace:  soac:<entity>:<identifier>
 *
 * Reserved keys (used by controllers):
 *   clubs                        — full list (all active clubs)
 *   clubs:<id>                   — single club
 *   clubs:<id>:members           — member list for a club
 *   events                       — full list (all active events)
 *   events:<id>                  — single event
 *   stats:admin                  — admin dashboard analytics
 *   student:<id>                 — student profile + enrolled clubs
 *   session:user:<id>            — authenticated user profile (/me)
 *   session:coord:<id>           — coordinator profile (/me)
 *   session:tokens:<userId>      — refresh-token validity flag
 */

const crypto = require('crypto');
const redis  = require('../config/redis');

const PREFIX = 'soac:';

/** TTL constants (seconds) */
const TTL = {
  CLUBS_LIST:    60,   // club list — refreshed every minute
  CLUB:         120,   // single club — refreshed every 2 min
  CLUB_MEMBERS:  30,   // membership list — refreshed every 30 s
  EVENTS_LIST:   60,   // event list — refreshed every minute
  EVENT:        120,   // single event — refreshed every 2 min
  STATS:         30,   // admin analytics — refreshed every 30 s
  STUDENT:       60,   // student profile — refreshed every minute
  SESSION:       60,   // /me user profile — refreshed every minute
  SESSION_TOKEN: 7 * 24 * 3600,  // refresh-token validity — 7 days
};

/* ── internal ─────────────────────────────────────────────────────────────── */

const isReady = () => redis.status === 'ready';

const prefixed = (key) => PREFIX + key;

/**
 * Build a stable short hash suffix from a params object.
 * Used to key parameterised list queries.
 * e.g. hashKey('clubs', { category: 'academic', search: 'chess' })
 *      → 'clubs:a3f1c9d2'
 */
const hashKey = (base, params = {}) => {
  const h = crypto
    .createHash('md5')
    .update(JSON.stringify(params))
    .digest('hex')
    .slice(0, 8);
  return `${base}:${h}`;
};

/* ── public API ───────────────────────────────────────────────────────────── */

/**
 * get(key) → parsed value or null on miss/error/Redis-down.
 */
const get = async (key) => {
  if (!isReady()) return null;
  try {
    const raw = await redis.get(prefixed(key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

/**
 * set(key, value, ttl?) — serialises value and stores it with TTL.
 * Silent no-op when Redis is unavailable.
 */
const set = async (key, value, ttl = 60) => {
  if (!isReady()) return;
  try {
    await redis.setex(prefixed(key), ttl, JSON.stringify(value));
  } catch {}
};

/**
 * del(...keys) — remove one or more exact keys.
 */
const del = async (...keys) => {
  if (!isReady() || !keys.length) return;
  try {
    await redis.del(keys.map(prefixed));
  } catch {}
};

/**
 * delPattern(pattern) — remove all keys matching a glob pattern.
 * Uses KEYS — acceptable for this dataset size; avoid in huge keyspaces.
 * Example: delPattern('clubs:*')  clears every cached club entry.
 */
const delPattern = async (pattern) => {
  if (!isReady()) return;
  try {
    const found = await redis.keys(prefixed(pattern));
    if (found.length) await redis.del(found);
  } catch {}
};

/**
 * incr(key) — atomically increment a counter, returning the new value.
 * Returns 1 (as if first call) when Redis is unavailable — lockout is
 * skipped gracefully without Redis.
 */
const incr = async (key) => {
  if (!isReady()) return 1;
  try {
    return await redis.incr(prefixed(key));
  } catch {
    return 1;
  }
};

/**
 * expire(key, ttlSeconds) — set a TTL on an existing key.
 * Silent no-op when Redis is unavailable.
 */
const expire = async (key, ttlSeconds) => {
  if (!isReady()) return;
  try {
    await redis.expire(prefixed(key), ttlSeconds);
  } catch {}
};

module.exports = { TTL, hashKey, get, set, del, delPattern, incr, expire };
