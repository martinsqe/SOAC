/* The Student Coordinators (users.role = 'coordinator') of a set of clubs, for
   Galore: each activity is run by a club, and its SCs form the teams. Faculty
   Advisors share coordinator_club_assignments but have their own role, so they
   are left out. Reads the assignments table plus the legacy managed_club_id. */
const { pgPool } = require('../config/db');

/* clubIds → Map(clubId string → [{ name, email }]) */
async function clubStudentCoordinators(clubIds) {
  const ids = [...new Set((clubIds || []).map(String).filter(x => /^\d+$/.test(x)))];
  const out = new Map(ids.map(id => [id, []]));
  if (!ids.length) return out;
  const { rows } = await pgPool.query(
    `SELECT DISTINCT club_id, name, email FROM (
       SELECT a.club_id, u.name, u.email
       FROM coordinator_club_assignments a JOIN users u ON u.id = a.user_id
       WHERE a.club_id = ANY($1::bigint[]) AND a.is_active = true AND u.role = 'coordinator' AND u.is_active = true
       UNION
       SELECT u.managed_club_id AS club_id, u.name, u.email
       FROM users u
       WHERE u.managed_club_id = ANY($1::bigint[]) AND u.role = 'coordinator' AND u.is_active = true
     ) x
     ORDER BY name`,
    [ids]
  );
  for (const r of rows) {
    const list = out.get(String(r.club_id));
    if (list && !list.some(p => p.email === r.email)) list.push({ name: r.name || '', email: r.email || '' });
  }
  return out;
}

module.exports = { clubStudentCoordinators };
