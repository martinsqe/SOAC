const { pgPool } = require('../config/db');
const { sendJoinRequestsReopening } = require('../config/email');

/* ── When students may send club join requests ────────────────────────────────
   Admin can stop join requests (every club, both campuses) and optionally name
   the date they open again; on that date (India time) they open automatically.
   Stored in app_settings as { open, opensOn: 'YYYY-MM-DD' }.

   Students whose accounts were cleared by "Delete all students" are kept in
   renewal_contacts so they can be emailed when a reopening date is announced
   (or requests reopen) — once per announcement — until they request again. */
const JOIN_KEY = 'join_requests';

const ensureJoinWindowSchema = async () => {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key        VARCHAR(64) PRIMARY KEY,
      value      JSONB       NOT NULL,
      updated_by INTEGER     REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS renewal_contacts (
      email       VARCHAR(255) PRIMARY KEY,
      name        VARCHAR(255) NOT NULL DEFAULT '',
      campus      VARCHAR(20),
      deleted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      last_notice VARCHAR(20)             -- the opensOn date (or 'open') they were last emailed about
    )`);
};

const formatOpensOn = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});

const getJoinState = async (db = pgPool) => {
  const { rows } = await db.query(
    `SELECT (SELECT value FROM app_settings WHERE key = $1) AS value,
            to_char((NOW() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS today`,
    [JOIN_KEY]
  );
  const v = rows[0].value || {};
  const opensOn = typeof v.opensOn === 'string' ? v.opensOn : null;
  /* Closed only while no reopening date has been reached */
  const open = v.open !== false || (!!opensOn && rows[0].today >= opensOn);
  return { open, opensOn: open ? null : opensOn };
};

const joinClosedMessage = ({ opensOn }) => opensOn
  ? `You can send requests from ${formatOpensOn(opensOn)} onwards.`
  : 'Join requests are closed at the moment. Please check back later.';

/* Remember students removed by "Delete all students" — rows: [{ email, name }] */
const recordRenewalContacts = async (db, rows, campus) => {
  if (!rows.length) return;
  await db.query(
    `INSERT INTO renewal_contacts (email, name, campus, deleted_at, last_notice)
     SELECT LOWER(e), n, $3, NOW(), NULL FROM UNNEST($1::text[], $2::text[]) AS t(e, n)
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, campus = EXCLUDED.campus, deleted_at = NOW(), last_notice = NULL`,
    [rows.map(r => r.email), rows.map(r => r.name || ''), campus]
  );
};

/* They've sent a new request — nothing more to tell them */
const forgetRenewalContact = (email, db = pgPool) =>
  db.query(`DELETE FROM renewal_contacts WHERE email = LOWER($1)`, [email])
    .catch(err => console.error('[joinWindow] forget contact failed:', err.message));

/* Email every renewal contact about the current state — a reopening date, or
   "open now" — skipping anyone already told about this exact state. Emails go
   out in the background through the shared send queue. Returns how many. */
const notifyRenewalContacts = async (state) => {
  const notice = state.open ? 'open' : state.opensOn;
  if (!notice) return 0;              // closed with no date: nothing to announce yet
  const { rows } = await pgPool.query(
    `UPDATE renewal_contacts SET last_notice = $1
     WHERE last_notice IS DISTINCT FROM $1
     RETURNING email, name`,
    [notice]
  );
  const opensOnLabel = state.open ? null : formatOpensOn(state.opensOn);
  for (const c of rows) {
    sendJoinRequestsReopening({ toEmail: c.email, toName: c.name, opensOnLabel })
      .catch(err => console.error(`[joinWindow] reopening email failed for ${c.email}:`, err.message));
  }
  return rows.length;
};

module.exports = {
  JOIN_KEY, ensureJoinWindowSchema, getJoinState, joinClosedMessage, formatOpensOn,
  recordRenewalContacts, forgetRenewalContact, notifyRenewalContacts,
};
