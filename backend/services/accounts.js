const bcrypt = require('bcryptjs');
const { pgPool } = require('../config/db');

/* ── One login, two profiles ─────────────────────────────────────────────────
   A person can have a STUDENT profile (club member → student dashboard) and a
   STAFF profile (Student Coordinator / Faculty Advisor → coordinator dashboard).
   Each profile is its own users row (so every dashboard, permission and club
   check keeps working per profile), but they share ONE login:

   • The profile created first holds the password and is what logs in.
   • The profile added later is a "linked profile" (users.linked_profile = true):
     it has no usable password of its own, can't be logged into directly, and is
     reached by switching from the other profile (POST /api/auth/switch-profile).
   • If the login profile is deleted, the linked one inherits its password so the
     person can still sign in. */
const isStudentRole = (role) => role === 'student';
const ACCOUNT_LABEL = {
  student:             'Student (club member) account',
  coordinator:         'Student Coordinator account',
  faculty_coordinator: 'Faculty Advisor account',
  admin:               'Admin account',
};

let schemaReady = null;
const ensureAccountsSchema = () => {
  if (!schemaReady) {
    schemaReady = (async () => {
      /* One student profile + one staff profile per email (instead of one row per email) */
      await pgPool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key`);
      await pgPool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_account_kind ON users (LOWER(email), (role = 'student'))`
      );
      await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email))`);
      await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_profile BOOLEAN NOT NULL DEFAULT false`);
      console.log('[accounts] schema ready');
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
};

/* The student profile / the staff profile for an email (or null) */
const findStudentAccount = async (email, db = pgPool) => {
  const { rows } = await db.query(
    `SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND role = 'student' LIMIT 1`, [email]
  );
  return rows[0] || null;
};
const findStaffAccount = async (email, db = pgPool) => {
  const { rows } = await db.query(
    `SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND role <> 'student' LIMIT 1`, [email]
  );
  return rows[0] || null;
};

/* The person's other active profile (the one they can switch to), or null */
const otherProfile = async (userId, db = pgPool) => {
  const { rows } = await db.query(
    `SELECT o.* FROM users me
     JOIN users o ON LOWER(o.email) = LOWER(me.email) AND o.id <> me.id AND o.is_active = true
     WHERE me.id = $1
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
};

/* The profile that holds the person's password: itself, or — for a linked
   profile — the profile it's linked to */
const loginProfileFor = async (userId, db = pgPool) => {
  const { rows } = await db.query(`SELECT * FROM users WHERE id = $1`, [userId]);
  const me = rows[0];
  if (!me || !me.linked_profile) return me || null;
  return (await otherProfile(userId, db)) || me;
};

/* Random password for a linked profile — never sent or used (it signs in by switching) */
const unusablePasswordHash = () =>
  bcrypt.hash(`linked:${Date.now()}:${Math.random()}:${Math.random()}`, 10);

/* Before deleting users: any of them that is the LOGIN profile for a linked
   profile hands its password over, so the person can still sign in. */
const handOverLogin = async (client, userIds) => {
  if (!userIds.length) return;
  await client.query(
    `UPDATE users o
     SET linked_profile = false, password_hash = me.password_hash, must_change_password = me.must_change_password
     FROM users me
     WHERE me.id = ANY($1::int[]) AND NOT me.linked_profile
       AND o.linked_profile = true AND LOWER(o.email) = LOWER(me.email) AND o.id <> me.id
       AND NOT (o.id = ANY($1::int[]))`,
    [userIds]
  );
};

/* Two separately-created login profiles on one email (legacy) must not share a
   password, or login couldn't tell them apart. Linked profiles don't log in. */
const matchesOtherAccount = async (userId, password, db = pgPool) => {
  const { rows } = await db.query(
    `SELECT o.password_hash FROM users me
     JOIN users o ON LOWER(o.email) = LOWER(me.email) AND o.id <> me.id AND NOT o.linked_profile
     WHERE me.id = $1`,
    [userId]
  );
  for (const r of rows) {
    if (r.password_hash && await bcrypt.compare(String(password), r.password_hash)) return true;
  }
  return false;
};

const SAME_PASSWORD_MESSAGE =
  'Choose a different password — this one is already used by your other SOAC account. Each account needs its own password.';

/* Where each role's dashboard lives */
const PROFILE_LABEL = {
  student:             'Student dashboard',
  coordinator:         'Student Coordinator dashboard',
  faculty_coordinator: 'Faculty Advisor dashboard',
  admin:               'Admin dashboard',
};

module.exports = {
  isStudentRole, ACCOUNT_LABEL, PROFILE_LABEL,
  ensureAccountsSchema, findStudentAccount, findStaffAccount,
  otherProfile, loginProfileFor, unusablePasswordHash, handOverLogin,
  matchesOtherAccount, SAME_PASSWORD_MESSAGE,
};
