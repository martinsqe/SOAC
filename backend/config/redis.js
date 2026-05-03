const Redis = require('ioredis');

/**
 * Redis client — connects automatically on require.
 * If Redis is unreachable the app continues to function;
 * cache helpers in services/cache.js check client.status
 * before every operation and silently skip on failure.
 */
const client = new Redis(process.env.REDIS_URL || {
  host:     process.env.REDIS_HOST     || '127.0.0.1',
  port:     parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD || undefined,
  // Don't queue commands while disconnected — fail fast so callers
  // can fall back to the database immediately.
  enableOfflineQueue: false,
  retryStrategy: (times) => {
    if (times > 5) return null; // stop retrying; app works without Redis
    return Math.min(times * 500, 3000);
  },
  maxRetriesPerRequest: 1,
});

client.on('connect', () => console.log('✅  Redis connected'));
client.on('ready',   () => console.log('✅  Redis ready'));
client.on('error',   (err) => console.warn(`⚠️   Redis: ${err.message}`));

module.exports = client;
