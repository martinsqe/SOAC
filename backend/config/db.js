const { Pool } = require('pg');

// Railway provides DATABASE_URL; local dev uses individual PG_* vars.
const baseConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Railway DB uses self-signed TLS cert
    }
  : {
      host:     process.env.PG_HOST,
      port:     parseInt(process.env.PG_PORT, 10),
      database: process.env.PG_DB,
      user:     process.env.PG_USER,
      password: process.env.PG_PASSWORD,
    };

const pgPool = new Pool({
  ...baseConfig,
  max:                     parseInt(process.env.PG_POOL_MAX     || '20',    10),
  idleTimeoutMillis:       parseInt(process.env.PG_IDLE_TIMEOUT || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT || '3000',  10),
  statement_timeout:       parseInt(process.env.PG_QUERY_TIMEOUT || '30000', 10),
  idle_in_transaction_session_timeout: 60000,
});

pgPool.on('error', (err) => {
  console.error('❌  PostgreSQL pool error:', err.message);
});

const connectPG = async (attempt = 1, maxAttempts = parseInt(process.env.PG_RETRY_ATTEMPTS || '5', 10)) => {
  try {
    const client = await pgPool.connect();
    console.log('✅  PostgreSQL connected');
    client.release();
    return true;
  } catch (err) {
    const waitMs = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
    if (attempt < maxAttempts) {
      console.warn(`⚠️  PostgreSQL connection failed (attempt ${attempt}/${maxAttempts}): ${err.message}. Retrying in ${waitMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
      return connectPG(attempt + 1, maxAttempts);
    } else {
      console.error(`❌  PostgreSQL connection failed after ${maxAttempts} attempts: ${err.message}`);
      process.exit(1);
    }
  }
};

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
