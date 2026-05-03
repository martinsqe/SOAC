/**
 * One-shot setup script — run ONCE before starting the server.
 * Creates the soac_rku database, applies schema, and seeds the admin account.
 *
 * Usage:
 *   cd backend
 *   node scripts/setup.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const fs       = require('fs');
const path     = require('path');

/* ── Credentials that will be created ─────────────────────────────────────── */
const ADMIN_NAME     = 'SOAC Admin';
const ADMIN_EMAIL    = 'admin@rku.ac.in';
const ADMIN_PASSWORD = 'Admin@SOAC2025';

/* ── Connect to default "postgres" db to create soac_rku if needed ─────────── */
const rootPool = new Pool({
  host:     process.env.PG_HOST     || 'localhost',
  port:     parseInt(process.env.PG_PORT || '5432', 10),
  database: 'postgres',          // connect to system db first
  user:     process.env.PG_USER     || 'postgres',
  password: process.env.PG_PASSWORD,
  connectionTimeoutMillis: 5000,
});

const appPool = new Pool({
  host:     process.env.PG_HOST     || 'localhost',
  port:     parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DB       || 'soac_rku',
  user:     process.env.PG_USER     || 'postgres',
  password: process.env.PG_PASSWORD,
  connectionTimeoutMillis: 5000,
});

async function step(label, fn) {
  process.stdout.write(`  ${label} ... `);
  await fn();
  console.log('✓');
}

(async () => {
  console.log('\n══════════════════════════════════════');
  console.log('   SOAC RKU — Database Setup');
  console.log('══════════════════════════════════════\n');

  /* ── 1. Create database ─────────────────────────────────────────────────── */
  await step('Creating database soac_rku', async () => {
    const { rows } = await rootPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [process.env.PG_DB || 'soac_rku']
    );
    if (!rows.length) {
      await rootPool.query(`CREATE DATABASE ${process.env.PG_DB || 'soac_rku'}`);
    }
    // else: already exists — skip silently
  });
  await rootPool.end();

  /* ── 2. Apply schema ────────────────────────────────────────────────────── */
  await step('Applying schema.sql', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
    await appPool.query(sql);
  });

  /* ── 3. Seed dynamic tables (clubs, events, join_requests, etc.) ─────────── */
  await step('Creating dynamic tables', async () => {
    await appPool.query(`
      CREATE TABLE IF NOT EXISTS clubs (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        category VARCHAR(32) NOT NULL,
        color VARCHAR(20) NOT NULL DEFAULT '#635BFF',
        logo VARCHAR(255) NOT NULL DEFAULT '',
        coordinator VARCHAR(255) NOT NULL DEFAULT '',
        founded_year VARCHAR(20) NOT NULL DEFAULT '',
        member_count INTEGER NOT NULL DEFAULT 0,
        event_count INTEGER NOT NULL DEFAULT 0,
        description TEXT NOT NULL DEFAULT '',
        tags TEXT[] NOT NULL DEFAULT '{}',
        vision TEXT NOT NULL DEFAULT '',
        rules TEXT[] NOT NULL DEFAULT '{}',
        schedule TEXT NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await appPool.query(`CREATE INDEX IF NOT EXISTS idx_clubs_active ON clubs(is_active)`);
    await appPool.query(`CREATE INDEX IF NOT EXISTS idx_clubs_category_active ON clubs(category, is_active)`);

    await appPool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id BIGSERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        club VARCHAR(255) NOT NULL DEFAULT '',
        category VARCHAR(32) NOT NULL DEFAULT 'general',
        status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
        date VARCHAR(100) NOT NULL DEFAULT '',
        start_date TIMESTAMPTZ,
        time VARCHAR(100) NOT NULL DEFAULT '',
        venue VARCHAR(255) NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        image VARCHAR(255) NOT NULL DEFAULT '',
        tags TEXT[] NOT NULL DEFAULT '{}',
        seats VARCHAR(100) NOT NULL DEFAULT '',
        highlight TEXT NOT NULL DEFAULT '',
        registration_url TEXT NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await appPool.query(`CREATE INDEX IF NOT EXISTS idx_events_status_active   ON events(status, is_active)`);
    await appPool.query(`CREATE INDEX IF NOT EXISTS idx_events_category_active ON events(category, is_active)`);
    await appPool.query(`CREATE INDEX IF NOT EXISTS idx_events_start_date      ON events(start_date)`);
    await appPool.query(`CREATE INDEX IF NOT EXISTS idx_events_club_active     ON events(club, is_active)`);

    await appPool.query(`
      CREATE TABLE IF NOT EXISTS event_registrations (
        id BIGSERIAL PRIMARY KEY,
        event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        event_title VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        enrollment_no VARCHAR(50) NOT NULL DEFAULT '',
        dept VARCHAR(100) NOT NULL DEFAULT '',
        course VARCHAR(100) NOT NULL DEFAULT '',
        phone VARCHAR(30) NOT NULL DEFAULT '',
        email VARCHAR(255) NOT NULL,
        registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (event_id, email)
      )
    `);
    await appPool.query(`CREATE INDEX IF NOT EXISTS idx_event_reg_event_id  ON event_registrations(event_id)`);
    await appPool.query(`CREATE INDEX IF NOT EXISTS idx_event_reg_email     ON event_registrations(email)`);
    await appPool.query(`CREATE INDEX IF NOT EXISTS idx_event_reg_email_evt ON event_registrations(email, event_id)`);

    await appPool.query(`
      CREATE TABLE IF NOT EXISTS join_requests (
        id BIGSERIAL PRIMARY KEY,
        club_id BIGINT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        club_name VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(30) NOT NULL DEFAULT '',
        enrollment_no VARCHAR(50) NOT NULL DEFAULT '',
        dept VARCHAR(100) NOT NULL DEFAULT '',
        year VARCHAR(20) NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await appPool.query(`CREATE INDEX IF NOT EXISTS idx_join_requests_club_id      ON join_requests(club_id)`);
    await appPool.query(`CREATE INDEX IF NOT EXISTS idx_join_requests_status       ON join_requests(status)`);
    await appPool.query(`CREATE INDEX IF NOT EXISTS idx_join_requests_email        ON join_requests(email)`);
    await appPool.query(`CREATE INDEX IF NOT EXISTS idx_join_requests_club_status  ON join_requests(club_id, status)`);
    await appPool.query(`CREATE INDEX IF NOT EXISTS idx_join_requests_email_status ON join_requests(email, status)`);
    await appPool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_join_requests_pending
      ON join_requests(club_id, email) WHERE status = 'pending'
    `);
  });

  /* ── 4. Create admin user ───────────────────────────────────────────────── */
  let adminCreated = false;
  await step(`Creating admin: ${ADMIN_EMAIL}`, async () => {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    const { rows } = await appPool.query(
      `INSERT INTO users (email, password_hash, name, role, must_change_password)
       VALUES ($1, $2, $3, 'admin', false)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             is_active     = true,
             role          = 'admin'
       RETURNING id, email, name`,
      [ADMIN_EMAIL, hash, ADMIN_NAME]
    );
    adminCreated = !!rows[0];
  });

  await appPool.end();

  /* ── Done ───────────────────────────────────────────────────────────────── */
  console.log('\n══════════════════════════════════════');
  console.log('   Setup complete!\n');
  console.log('   Admin Login Credentials');
  console.log('   ─────────────────────────────────');
  console.log(`   Email    : ${ADMIN_EMAIL}`);
  console.log(`   Password : ${ADMIN_PASSWORD}`);
  console.log('   ─────────────────────────────────');
  console.log('\n   Next steps:');
  console.log('   1. cd backend  &&  npm run dev');
  console.log('   2. cd frontend &&  npm run dev');
  console.log('   3. Open http://localhost:5173/login');
  console.log('══════════════════════════════════════\n');

  process.exit(0);
})().catch((err) => {
  console.error('\n❌  Setup failed:', err.message);
  console.error('\n   Common causes:');
  console.error('   • PostgreSQL is not running — start it via pgAdmin or Services');
  console.error(`   • Wrong PG_PASSWORD in .env — current value: ${process.env.PG_PASSWORD ? '(set)' : '(empty)'}`);
  console.error('   • PG_USER does not have CREATE DATABASE permission');
  process.exit(1);
});
