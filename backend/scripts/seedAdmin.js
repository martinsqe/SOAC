/**
 * Non-interactive admin seeder — run once to create the default admin account.
 * Delete this file after first use if desired.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');

const ADMIN = {
  name:     'SOAC Admin',
  email:    'admin@rku.ac.in',
  password: 'Admin@SOAC2024',
};

const pool = new Pool({
  host:     process.env.PG_HOST,
  port:     parseInt(process.env.PG_PORT, 10),
  database: process.env.PG_DB,
  user:     process.env.PG_USER,
  password: process.env.PG_PASSWORD,
});

(async () => {
  try {
    const hash = await bcrypt.hash(ADMIN.password, 12);

    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, name, role, must_change_password)
       VALUES ($1, $2, $3, 'admin', false)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = $2, is_active = true, must_change_password = false
       RETURNING id, email, name, role`,
      [ADMIN.email, hash, ADMIN.name]
    );

    console.log('\n✅  Admin account ready:');
    console.log(`   Name  : ${rows[0].name}`);
    console.log(`   Email : ${rows[0].email}`);
    console.log(`   Pass  : ${ADMIN.password}`);
    console.log(`   Role  : ${rows[0].role}`);
    console.log('\n   Login at http://localhost:5173/login\n');

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌  Error:', err.message);
    process.exit(1);
  }
})();
