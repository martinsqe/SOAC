const crypto = require('crypto');
const { pgPool } = require('../config/db');

/**
 * Token revocation — logout (one access token) and "sign out everywhere"
 * (password change / reset, account deactivated).
 *
 * Stored in Postgres, so revocation keeps working when Redis is down or not
 * configured (it used to live only in Redis and silently stopped working —
 * fail-open — without it). Tokens are stored as SHA-256 hashes, never raw.
 * A read failure fails CLOSED: a request whose revocation status can't be
 * checked is treated as revoked rather than let through.
 */

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

let ready = null;
const ensureTables = () => {
  if (!ready) {
    ready = (async () => {
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS revoked_access_tokens (
          token_hash CHAR(64)    PRIMARY KEY,
          expires_at TIMESTAMPTZ NOT NULL
        )`);
      await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_revoked_access_tokens_exp ON revoked_access_tokens(expires_at)`);
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS user_token_revocations (
          user_id    INTEGER     PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          revoked_at TIMESTAMPTZ NOT NULL
        )`);
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
};

/* Expired rows are useless — prune now and then, never on every request */
let lastPrune = 0;
const prune = () => {
  if (Date.now() - lastPrune < 60 * 60 * 1000) return;
  lastPrune = Date.now();
  pgPool.query(`DELETE FROM revoked_access_tokens WHERE expires_at < NOW()`).catch(() => {});
};

/** Revoke one access token (logout). expiresIn = seconds until it expires anyway. */
const revokeToken = async (token, expiresIn = 900) => {
  if (!token) return false;
  try {
    await ensureTables();
    await pgPool.query(
      `INSERT INTO revoked_access_tokens (token_hash, expires_at)
       VALUES ($1, NOW() + ($2::int * INTERVAL '1 second'))
       ON CONFLICT (token_hash) DO NOTHING`,
      [sha256(token), Math.max(60, Math.ceil(expiresIn) + 60)]
    );
    prune();
    return true;
  } catch (err) {
    console.error('[tokenBlacklist] revokeToken failed:', err.message);
    return false;
  }
};

/** Revoke every token issued to this user up to now (password change etc). */
const revokeAllUserTokens = async (userId) => {
  if (!userId) return false;
  try {
    await ensureTables();
    await pgPool.query(
      `INSERT INTO user_token_revocations (user_id, revoked_at) VALUES ($1, NOW())
       ON CONFLICT (user_id) DO UPDATE SET revoked_at = NOW()`,
      [userId]
    );
    return true;
  } catch (err) {
    console.error('[tokenBlacklist] revokeAllUserTokens failed:', err.message);
    return false;
  }
};

/**
 * One query for both checks. Returns a reason string when the token must be
 * rejected ('revoked' | 'user_revoked' | 'unavailable'), or null when it's fine.
 */
const checkToken = async (token, userId, issuedAt) => {
  try {
    await ensureTables();
    const { rows } = await pgPool.query(
      `SELECT EXISTS (SELECT 1 FROM revoked_access_tokens WHERE token_hash = $1 AND expires_at > NOW()) AS revoked,
              (SELECT revoked_at FROM user_token_revocations WHERE user_id = $2) AS user_revoked_at`,
      [sha256(token), Number.isInteger(userId) ? userId : -1]
    );
    if (rows[0].revoked) return 'revoked';
    const at = rows[0].user_revoked_at;
    /* iat has 1-second precision; a token issued in the same second as the
       revocation (e.g. the new login right after a password change) stays valid */
    if (at && issuedAt && issuedAt < Math.floor(new Date(at).getTime() / 1000)) return 'user_revoked';
    return null;
  } catch (err) {
    console.error('[tokenBlacklist] check failed — rejecting request:', err.message);
    return 'unavailable';
  }
};

/* Kept for callers that only need one of the two checks */
const isRevoked = async (token) => (await checkToken(token, -1, null)) !== null;
const wasRevokedByUser = async (userId, issuedAt) => (await checkToken('', userId, issuedAt)) === 'user_revoked';

module.exports = { revokeToken, revokeAllUserTokens, checkToken, isRevoked, wasRevokedByUser, sha256 };
