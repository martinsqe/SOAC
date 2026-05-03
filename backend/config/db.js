const { Pool } = require('pg');

/**
 * Connection pool — shared across every request.
 *
 * Tuning knobs (all overridable via env):
 *   PG_POOL_MAX       Max simultaneous connections  (default 20)
 *   PG_IDLE_TIMEOUT   Release idle connections after (default 10 s, reduced from 30s)
 *   PG_CONN_TIMEOUT   Fail if no connection in pool  (default 3 s)
 *   PG_QUERY_TIMEOUT  Max query execution time       (default 30 s)
 *   PG_RETRY_ATTEMPTS Max connection retry attempts  (default 5)
 */
const pgPool = new Pool({
  host:     process.env.PG_HOST,
  port:     parseInt(process.env.PG_PORT, 10),
  database: process.env.PG_DB,
  user:     process.env.PG_USER,
  password: process.env.PG_PASSWORD,

  max:                     parseInt(process.env.PG_POOL_MAX     || '20',    10),
  idleTimeoutMillis:       parseInt(process.env.PG_IDLE_TIMEOUT || '10000', 10), // reduced to 10s for better connection reuse
  connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT || '3000',  10),
  statement_timeout:       parseInt(process.env.PG_QUERY_TIMEOUT || '30000', 10), // prevent hung queries
  idle_in_transaction_session_timeout: 60000, // close idle transactions after 60s
});

pgPool.on('error', (err) => {
  console.error('❌  PostgreSQL pool error:', err.message);
  // Emit metrics/alerts here if using monitoring (e.g., Prometheus, DataDog)
});

pgPool.on('connect', (client) => {
  // Log connection success at debug level (not every time, too noisy)
});

/**
 * Connect with exponential backoff retry (prevents crash on transient network issues)
 * @param {number} attempt - Current attempt number (1-based)
 * @param {number} maxAttempts - Maximum retry attempts
 */
const connectPG = async (attempt = 1, maxAttempts = parseInt(process.env.PG_RETRY_ATTEMPTS || '5', 10)) => {
  try {
    const client = await pgPool.connect();
    console.log('✅  PostgreSQL connected');
    client.release();
    return true;
  } catch (err) {
    const waitMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000); // exponential backoff, max 30s
    
    if (attempt < maxAttempts) {
      console.warn(
        `⚠️  PostgreSQL connection failed (attempt ${attempt}/${maxAttempts}): ${err.message}. Retrying in ${waitMs}ms...`
      );
      await new Promise(resolve => setTimeout(resolve, waitMs));
      return connectPG(attempt + 1, maxAttempts);
    } else {
      console.error(
        `❌  PostgreSQL connection failed after ${maxAttempts} attempts: ${err.message}`
      );
      process.exit(1);
    }
  }
};

/**
 * Health check for connection pool
 * Returns true if pool is healthy, false if degraded
 */
const poolHealth = async () => {
  try {
    const client = await pgPool.connect();
    client.release();
    return true;
  } catch (err) {
    console.error('❌  Pool health check failed:', err.message);
    return false;
  }
};

module.exports = { pgPool, connectPG, poolHealth };
