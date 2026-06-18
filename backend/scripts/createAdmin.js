/**
 * Creates the first admin user.
 *
 * Interactive (local):      npm run create-admin
 * Non-interactive (Railway): ADMIN_NAME="Your Name" ADMIN_EMAIL="you@rku.ac.in" ADMIN_PASS="secret" node scripts/createAdmin.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const readline = require('readline');

// Support DATABASE_URL (Supabase/Railway) or individual PG_* vars (local)
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : new Pool({
      host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT, 10),
      database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
    });

const ask = (q) => new Promise(res => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); res(a.trim()); });
});

(async () => {
  try {
    // Non-interactive mode: read from env vars
    let name     = process.env.ADMIN_NAME;
    let email    = process.env.ADMIN_EMAIL;
    let password = process.env.ADMIN_PASS;

    if (!name || !email || !password) {
      console.log('\n── Create SOAC Admin Account ──\n');
      name     = name     || await ask('Admin name: ');
      email    = email    || await ask('Admin email (@rku.ac.in): ');
      password = password || await ask('Password (min 8 chars): ');
    }

    email = email.toLowerCase().trim();

    if (!email.endsWith('@rku.ac.in')) {
      console.error('❌  Email must end in @rku.ac.in'); process.exit(1);
    }
    if (password.length < 8) {
      console.error('❌  Password too short (min 8 chars)'); process.exit(1);
    }

    const hash = await bcrypt.hash(password, 12);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'admin',
        is_active BOOLEAN NOT NULL DEFAULT true,
        must_change_password BOOLEAN NOT NULL DEFAULT false,
        created_by INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login TIMESTAMPTZ
      )
    `);

    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, must_change_password)
       VALUES ($1, $2, $3, 'admin', false)
       ON CONFLICT (email) DO UPDATE SET password_hash = $2, name = $3, is_active = true
       RETURNING id, email, name`,
      [email, hash, name]
    );

    console.log(`\n✅  Admin created: ${rows[0].name} <${rows[0].email}> (id: ${rows[0].id})`);
    console.log('   You can now log in at /login\n');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌  Error:', err.message);
    process.exit(1);
  }
})();
