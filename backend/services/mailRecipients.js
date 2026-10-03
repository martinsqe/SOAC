const { pgPool } = require('../config/db');

/* Recipient lookups for notification emails, and a fan-out helper that emails
   each address once and logs (never throws) failures — emails are always sent
   after the response, so a mail problem can't break the request itself. */

const activeAdmins = async () => (await pgPool.query(
  `SELECT id, email, name, role FROM users
   WHERE role = 'admin' AND is_active = true AND COALESCE(email, '') <> ''`
)).rows;

/* Staff currently assigned to a club. roles: any of 'coordinator', 'faculty_coordinator' */
const clubStaff = async (clubId, roles = ['coordinator', 'faculty_coordinator']) => {
  if (!clubId) return [];
  return (await pgPool.query(
    `SELECT u.id, u.email, u.name, u.role
     FROM coordinator_club_assignments cca
     JOIN users u ON u.id = cca.user_id AND u.is_active = true AND u.role = ANY($2::text[])
     WHERE cca.club_id = $1::bigint AND cca.is_active = true AND COALESCE(u.email, '') <> ''`,
    [clubId, roles]
  )).rows;
};

const userById = async (id) => {
  if (!id) return null;
  const { rows } = await pgPool.query(
    `SELECT id, email, name, role FROM users WHERE id = $1 AND is_active = true AND COALESCE(email, '') <> ''`,
    [id]
  );
  return rows[0] || null;
};

/* Email every person once (by address); `exclude` = addresses to skip */
const emailEach = (people, sendFn, label, exclude = []) => {
  const seen = new Set(exclude.filter(Boolean).map(e => e.toLowerCase()));
  for (const p of people) {
    const key = (p?.email || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    Promise.resolve()
      .then(() => sendFn(p))
      .catch(err => console.error(`[email] ${label} failed for ${p.email}:`, err.message));
  }
};

module.exports = { activeAdmins, clubStaff, userById, emailEach };
