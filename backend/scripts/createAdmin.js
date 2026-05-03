/**
 * Creates the first admin user in PostgreSQL.
 * Run once:  npm run create-admin
 * Then edit the .env values below before running.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const readline = require('readline');

const pool = new Pool({
  host: process.env.PG_HOST, port: parseInt(process.env.PG_PORT,10),
  database: process.env.PG_DB, user: process.env.PG_USER, password: process.env.PG_PASSWORD,
});

const ask = (q) => new Promise(res => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); res(a.trim()); });
});

(async () => {
  try {
    console.log('\n── Create SOAC Admin Account ──\n');
    const name     = await ask('Admin name: ');
    const email    = await ask('Admin email (@rku.ac.in): ');
    const password = await ask('Password (min 8 chars): ');

    if (!email.endsWith('@rku.ac.in')) {
      console.error('❌  Email must end in @rku.ac.in'); process.exit(1);
    }
    if (password.length < 8) {
      console.error('❌  Password too short'); process.exit(1);
    }

    const hash = await bcrypt.hash(password, 12);

    // Ensure schema exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL CHECK (email LIKE '%@rku.ac.in'),
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
       ON CONFLICT (email) DO UPDATE SET password_hash = $2, is_active = true
       RETURNING id, email, name`,
      [email.toLowerCase(), hash, name]
    );

    console.log(`\n✅  Admin created: ${rows[0].name} <${rows[0].email}> (id: ${rows[0].id})`);
    console.log('   You can now start the server and log in at /login\n');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
