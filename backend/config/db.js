const { Pool } = require('pg');

const usingPooler = (process.env.DATABASE_URL || '').includes('pgbouncer=true');

// PgBouncer (Supabase pooler) runs in transaction mode and rejects session-level
// settings like statement_timeout — only apply them for direct connections.
const sessionSettings = usingPooler ? {} : {
  statement_timeout:                    parseInt(process.env.PG_QUERY_TIMEOUT || '30000', 10),
  idle_in_transaction_session_timeout:  60000,
};

/* TLS to Postgres. With PG_SSL_CA (the provider's CA certificate, PEM) the
   server certificate is fully verified; PG_SSL_STRICT=true verifies against the
   system CAs. Without either, the connection is encrypted but unverified —
   acceptable only over a private network (e.g. *.railway.internal). */
const dbSsl = () => {
  if (process.env.PG_SSL_CA) return { ca: process.env.PG_SSL_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  if (process.env.PG_SSL_STRICT === 'true') return { rejectUnauthorized: true };
  if (process.env.NODE_ENV === 'production' && !/\.railway\.internal[:/]/.test(process.env.DATABASE_URL || '')) {
    console.warn('⚠️  Postgres TLS certificate is not verified — set PG_SSL_CA, or connect over the private network (*.railway.internal)');
  }
  return { rejectUnauthorized: false };
};

const baseConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: dbSsl() }
  : {
      host:     process.env.PG_HOST,
      port:     parseInt(process.env.PG_PORT, 10),
      database: process.env.PG_DB,
      user:     process.env.PG_USER,
      password: process.env.PG_PASSWORD,
    };

const pgPool = new Pool({
  ...baseConfig,
  ...sessionSettings,
  max:                     parseInt(process.env.PG_POOL_MAX     || '20',    10),
  idleTimeoutMillis:       parseInt(process.env.PG_IDLE_TIMEOUT || '10000', 10),
  connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT || '3000',  10),
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
