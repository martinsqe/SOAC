const redis = require('../config/redis');

/**
 * Token Blacklist Service
 * Maintains a Redis set of revoked JWT tokens to prevent reuse
 * Uses TTL to automatically expire blacklist entries after token lifetime
 *
 * All operations are silent no-ops when Redis is unavailable (fail-open).
 * The app remains functional without Redis; token revocation is best-effort.
 */

const BLACKLIST_PREFIX = 'token:blacklist:';
const REVOKED_TOKENS_PREFIX = 'revoked:tokens:';

const isReady = () => redis.status === 'ready';

/**
 * Add token to blacklist (on logout or security event)
 * @param {string} token - JWT token to revoke
 * @param {number} expiresIn - Seconds until token naturally expires
 */
const revokeToken = async (token, expiresIn = 900) => {
  if (!token || !isReady()) return false;
  try {
    const key = `${BLACKLIST_PREFIX}${token}`;
    await redis.setex(key, expiresIn + 60, '1'); // +60s buffer
    return true;
  } catch {
    return false;
  }
};

/**
 * Check if token is revoked
 * @param {string} token - JWT token to check
 * @returns {boolean} true if token is revoked, false otherwise
 */
const isRevoked = async (token) => {
  if (!token || !isReady()) return false;
  try {
    const key = `${BLACKLIST_PREFIX}${token}`;
    const exists = await redis.exists(key);
    return exists === 1;
  } catch {
    return false;
  }
};

/**
 * Revoke all tokens for a user (on password change, role change, admin action)
 * @param {number} userId - User ID whose tokens to revoke
 */
const revokeAllUserTokens = async (userId) => {
  if (!userId || !isReady()) return false;
  try {
    const key = `${REVOKED_TOKENS_PREFIX}${userId}`;
    await redis.setex(key, 7 * 24 * 60 * 60, Date.now()); // 7 days TTL
    return true;
  } catch {
    return false;
  }
};

/**
 * Check if a user has revoked all tokens (e.g., due to password change)
 * @param {number} userId - User ID to check
 * @param {number} issuedAt - Token iat claim (unix timestamp in seconds)
 * @returns {boolean} true if token was issued before revocation timestamp
 */
const wasRevokedByUser = async (userId, issuedAt) => {
  if (!userId || !issuedAt || !isReady()) return false;
  try {
    const key = `${REVOKED_TOKENS_PREFIX}${userId}`;
    const revocationTimestamp = await redis.get(key);
    if (!revocationTimestamp) return false;
    return issuedAt * 1000 < parseInt(revocationTimestamp, 10);
  } catch {
    return false;
  }
};

module.exports = {
  revokeToken,
  isRevoked,
  revokeAllUserTokens,
  wasRevokedByUser,
};
