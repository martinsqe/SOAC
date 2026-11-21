/* Galore portal: making teams (or duos) from an activity's registrations, as the
   admin does on Manage Event → Teams. Same tables (event_teams /
   event_team_members), so the club's Match Control, fixtures and reports see
   every team made here.

   Who may change an activity's teams:
     • the main (overall) Galore coordinator — any activity of their event
     • the activity's coordinator — that activity
     • a department coordinator — only their department's teams, built from
       their department's registrations

   What gets selected follows how the activity was defined on the Galore form:
     • team        teams of up to its maximum players
     • duo         pairs (exactly 2)
     • individual  single students — each selected student is stored as a
                   one-person entry (max_size 1, named after them), so fixtures,
                   Match Control and reports treat them like any other entry */
const { pgPool } = require('../config/db');
const cache = require('./cache');

class TeamError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const norm = (v) => String(v || '').trim().toLowerCase();
const isGirl = (g) => /^f/i.test(String(g || '').trim());
const isBoy  = (g) => /^m/i.test(String(g || '').trim());

/* The activity, and what this email may do with it */
async function access(email, activityId) {
  const e = norm(email);
  if (!/^\d+$/.test(String(activityId))) throw new TeamError('Activity not found.', 404);
  const { rows: [a] } = await pgPool.query(
    `SELECT a.id, a.title, a.parent_event_id, a.team_size, a.min_team_size, a.gender_split, a.galore_teams_declared,
            (LOWER(a.galore_coord_email) = $2) AS is_coord,
            EXISTS (SELECT 1 FROM galore_heads h WHERE h.event_id = a.parent_event_id AND LOWER(h.email) = $2) AS is_head
     FROM events a WHERE a.id = $1 AND a.is_active = true AND a.parent_event_id IS NOT NULL`,
    [activityId, e]
  );
  if (!a) throw new TeamError('Activity not found.', 404);
  let scope = a.is_head ? 'head' : a.is_coord ? 'activity' : null;
  let depts = [];
  if (!scope) {
    const { rows } = await pgPool.query(
      `SELECT name FROM galore_departments WHERE event_id = $1 AND LOWER(coord_email) = $2 ORDER BY sort_order, id`,
      [a.parent_event_id, e]
    );
    if (!rows.length) throw new TeamError('You can’t manage the teams of this activity.', 403);
    scope = 'dept';
    depts = rows.map(r => r.name);
  }
  const teamSize = Number(a.team_size || 0);
  const min = Number(a.min_team_size || 0);
  const unit = teamSize <= 0 ? 'individual' : teamSize === 2 && min === 2 ? 'duo' : 'team';
  return {
    a, scope, depts, unit,
    size: unit === 'individual' ? 1 : teamSize,
    mayDept: (dept) => scope !== 'dept' || depts.some(d => norm(d) === norm(dept)),
  };
}

async function teamOf(ctx, teamId) {
  if (!/^\d+$/.test(String(teamId))) throw new TeamError('Team not found.', 404);
  const { rows: [t] } = await pgPool.query(
    `SELECT id, name, division, dept, max_size FROM event_teams WHERE id = $1 AND event_id = $2`,
    [teamId, ctx.a.id]
  );
  if (!t) throw new TeamError('Team not found — it may have been removed.', 404);
  if (!ctx.mayDept(t.dept)) throw new TeamError('That team belongs to another department.', 403);
  return t;
}

const changed = () => cache.delPattern('events:*').catch(() => {});

/* Everything the manager needs: the activity, its teams (with members) and its
   registrations (each marked with the team it's in, if any). dept: only that
   department (always the coordinator's own for a department coordinator). */
async function overview(email, activityId, dept = '') {
  const ctx = await access(email, activityId);
  const only = ctx.scope === 'dept'
    ? (dept && ctx.mayDept(dept) ? [norm(dept)] : ctx.depts.map(norm))
    : (dept ? [norm(dept)] : null);
  const [{ rows: teams }, { rows: members }, { rows: regs }] = await Promise.all([
    pgPool.query(
      `SELECT id, name, division, dept, max_size FROM event_teams
       WHERE event_id = $1 AND ($2::text[] IS NULL OR LOWER(TRIM(dept)) = ANY($2::text[]))
       ORDER BY division, name`,
      [ctx.a.id, only]
    ),
    pgPool.query(
      `SELECT m.id, m.team_id, m.registration_id, m.member_name, m.enrollment_no
       FROM event_team_members m JOIN event_teams t ON t.id = m.team_id
       WHERE t.event_id = $1 ORDER BY m.id`,
      [ctx.a.id]
    ),
    pgPool.query(
      `SELECT id, name, enrollment_no, dept, gender FROM event_registrations
       WHERE event_id = $1 AND email NOT ILIKE '%@roster.internal'
         AND ($2::text[] IS NULL OR LOWER(TRIM(dept)) = ANY($2::text[]))
       ORDER BY name`,
      [ctx.a.id, only]
    ),
  ]);
  const teamOfReg = new Map(members.map(m => [String(m.registration_id), String(m.team_id)]));
  return {
    activity: {
      id: String(ctx.a.id), title: ctx.a.title, unit: ctx.unit, size: ctx.size,
      minSize: Number(ctx.a.min_team_size || 0), genderSplit: !!ctx.a.gender_split,
    },
    scope: ctx.scope,
    declared: !!ctx.a.galore_teams_declared,
    departments: ctx.scope === 'dept' ? ctx.depts : [],
    teams: teams.map(t => ({
      id: String(t.id), name: t.name, division: t.division, dept: t.dept || '', maxSize: t.max_size,
      members: members.filter(m => String(m.team_id) === String(t.id))
        .map(m => ({ id: String(m.id), registrationId: String(m.registration_id), name: m.member_name, enrollmentNo: m.enrollment_no })),
    })),
    registrations: regs.map(r => ({
      id: String(r.id), name: r.name, enrollmentNo: r.enrollment_no || '', dept: r.dept || '', gender: r.gender || '',
      teamId: teamOfReg.get(String(r.id)) || null,
    })),
  };
}

async function createTeam(email, activityId, body = {}) {
  const ctx = await access(email, activityId);
  if (ctx.unit === 'individual') throw new TeamError('This is an individual activity: select students instead of making teams.');
  const name = String(body.name || '').trim().slice(0, 255);
  if (!name) throw new TeamError(`Give the ${ctx.unit} a name.`);
  const division = ctx.a.gender_split && body.division === 'girls' ? 'girls' : 'boys';
  let dept = String(body.dept || '').trim().slice(0, 100);
  if (ctx.scope === 'dept') {
    if (!dept) dept = ctx.depts[0];
    if (!ctx.mayDept(dept)) throw new TeamError('You can only make teams for your own department.', 403);
  }
  try {
    const { rows: [t] } = await pgPool.query(
      `INSERT INTO event_teams (event_id, name, max_size, division, dept) VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [ctx.a.id, name, ctx.size, division, dept]
    );
    await changed();
    return { id: String(t.id) };
  } catch (err) {
    if (err.code === '23505') throw new TeamError(`There's already a ${division === 'girls' && ctx.a.gender_split ? 'girls ' : ctx.a.gender_split ? 'boys ' : ''}${ctx.unit} called "${name}".`, 409);
    throw err;
  }
}

async function renameTeam(email, activityId, teamId, body = {}) {
  const ctx = await access(email, activityId);
  await teamOf(ctx, teamId);
  const name = String(body.name || '').trim().slice(0, 255);
  if (!name) throw new TeamError(`Give the ${ctx.unit} a name.`);
  try {
    await pgPool.query(`UPDATE event_teams SET name = $1 WHERE id = $2`, [name, teamId]);
  } catch (err) {
    if (err.code === '23505') throw new TeamError(`There's already a ${ctx.unit} called "${name}".`, 409);
    throw err;
  }
  await changed();
}

async function deleteTeam(email, activityId, teamId) {
  const ctx = await access(email, activityId);
  const t = await teamOf(ctx, teamId);
  /* a team already playing (in a match) keeps its place: remove the match first */
  const { rows: [busy] } = await pgPool.query(
    `SELECT 1 FROM event_fixtures WHERE event_id = $1 AND division = $2 AND (team_a_name = $3 OR team_b_name = $3) LIMIT 1`,
    [ctx.a.id, t.division, t.name]
  ).catch(() => ({ rows: [] }));
  if (busy) throw new TeamError(`${t.name} already has a match on the schedule. Ask the main coordinator to remove the match first.`, 409);
  await pgPool.query(`DELETE FROM event_teams WHERE id = $1`, [teamId]);
  await changed();
}

async function addMember(email, activityId, teamId, body = {}) {
  const ctx = await access(email, activityId);
  const t = await teamOf(ctx, teamId);
  const regId = String(body.registrationId || '');
  if (!/^\d+$/.test(regId)) throw new TeamError('Pick a student to add.');
  const { rows: [r] } = await pgPool.query(
    `SELECT id, name, enrollment_no, dept, gender FROM event_registrations WHERE id = $1 AND event_id = $2`,
    [regId, ctx.a.id]
  );
  if (!r) throw new TeamError('That student isn’t registered for this activity.', 404);
  if (!ctx.mayDept(r.dept)) throw new TeamError('You can only add students from your own department.', 403);
  if (t.dept && norm(r.dept) !== norm(t.dept)) throw new TeamError(`${r.name} is from ${r.dept || 'another department'}, but ${t.name} is a ${t.dept} ${ctx.unit}.`);
  if (ctx.a.gender_split && ((t.division === 'girls' && isBoy(r.gender)) || (t.division !== 'girls' && isGirl(r.gender)))) {
    throw new TeamError(`${r.name} can’t join a ${t.division === 'girls' ? 'girls' : 'boys'} ${ctx.unit}.`);
  }
  const { rows: [{ n }] } = await pgPool.query(`SELECT COUNT(*)::int AS n FROM event_team_members WHERE team_id = $1`, [teamId]);
  const cap = Number(t.max_size || ctx.size || 0);
  if (cap > 0 && n >= cap) throw new TeamError(`${t.name} is full (${cap} player${cap === 1 ? '' : 's'}).`);
  try {
    await pgPool.query(
      `INSERT INTO event_team_members (team_id, registration_id, member_name, enrollment_no) VALUES ($1, $2, $3, $4)`,
      [teamId, r.id, r.name, r.enrollment_no || '']
    );
  } catch (err) {
    if (err.code === '23505') throw new TeamError(`${r.name} is already in a ${ctx.unit}.`, 409);
    throw err;
  }
  await changed();
}

async function removeMember(email, activityId, teamId, memberId) {
  const ctx = await access(email, activityId);
  await teamOf(ctx, teamId);
  if (!/^\d+$/.test(String(memberId))) throw new TeamError('Player not found.', 404);
  await pgPool.query(`DELETE FROM event_team_members WHERE id = $1 AND team_id = $2`, [memberId, teamId]);
  await changed();
}

/* Individual activities: select a registered student to represent their
   department (a one-person entry), or take them off the selection */
async function selectIndividual(email, activityId, body = {}) {
  const ctx = await access(email, activityId);
  if (ctx.unit !== 'individual') throw new TeamError(`This activity takes ${ctx.unit}s, not individuals.`);
  const regId = String(body.registrationId || '');
  if (!/^\d+$/.test(regId)) throw new TeamError('Pick a student to select.');
  const { rows: [r] } = await pgPool.query(
    `SELECT id, name, enrollment_no, dept, gender FROM event_registrations WHERE id = $1 AND event_id = $2`,
    [regId, ctx.a.id]
  );
  if (!r) throw new TeamError('That student isn’t registered for this activity.', 404);
  if (!ctx.mayDept(r.dept)) throw new TeamError('You can only select students from your own department.', 403);
  const { rows: [already] } = await pgPool.query(`SELECT 1 FROM event_team_members WHERE registration_id = $1`, [r.id]);
  if (already) throw new TeamError(`${r.name} is already selected.`, 409);
  const division = ctx.a.gender_split && isGirl(r.gender) ? 'girls' : 'boys';
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    /* named after the student; their enrollment number tells two of the same name apart */
    let name = String(r.name || 'Student').trim().slice(0, 200);
    const { rows: [clash] } = await client.query(
      `SELECT 1 FROM event_teams WHERE event_id = $1 AND division = $2 AND name = $3`, [ctx.a.id, division, name]
    );
    if (clash) name = `${name} (${r.enrollment_no || r.id})`.slice(0, 255);
    const { rows: [t] } = await client.query(
      `INSERT INTO event_teams (event_id, name, max_size, division, dept) VALUES ($1, $2, 1, $3, $4) RETURNING id`,
      [ctx.a.id, name, division, r.dept || '']
    );
    await client.query(
      `INSERT INTO event_team_members (team_id, registration_id, member_name, enrollment_no) VALUES ($1, $2, $3, $4)`,
      [t.id, r.id, r.name, r.enrollment_no || '']
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') throw new TeamError(`${r.name} is already selected.`, 409);
    throw err;
  } finally { client.release(); }
  await changed();
}

module.exports = { TeamError, overview, createTeam, renameTeam, deleteTeam, addMember, removeMember, selectIndividual };

/* Student → "My activities": for only the activities this student registered
   for, everyone registered from every department and the selected teams / duos
   / individuals. Read-only, and without other students' mobile or email. */
async function studentRosters(email, umbrellaId) {
  const e = norm(email);
  const { rows: acts } = await pgPool.query(
    `SELECT DISTINCT e.id, e.title, e.team_size, e.min_team_size, e.gender_split, e.galore_teams_declared, c.name AS category_name, c.sort_order, e.club_id,
            (SELECT name FROM clubs WHERE clubs.id = e.club_id) AS club_name
     FROM events e
     JOIN event_registrations er ON er.event_id = e.id AND LOWER(er.email) = $2
     LEFT JOIN galore_categories c ON c.id = e.galore_category_id
     WHERE e.parent_event_id = $1 AND e.is_active = true
     ORDER BY c.sort_order NULLS LAST, e.title`,
    [umbrellaId, e]
  );
  if (!acts.length) return { activities: [], registrations: [], teams: [] };
  const ids = acts.map(a => a.id);
  const [{ rows: regs }, { rows: teams }] = await Promise.all([
    pgPool.query(
      `SELECT id, event_id, name, enrollment_no, dept, gender, course FROM event_registrations
       WHERE event_id = ANY($1::bigint[]) AND email NOT ILIKE '%@roster.internal'
       ORDER BY dept, name`,
      [ids]
    ),
    pgPool.query(
      `SELECT t.id, t.event_id, t.name, t.division, t.dept,
              COALESCE(json_agg(json_build_object('name', m.member_name, 'enrollmentNo', m.enrollment_no) ORDER BY m.id)
                       FILTER (WHERE m.id IS NOT NULL), '[]') AS members
       FROM event_teams t LEFT JOIN event_team_members m ON m.team_id = t.id
       WHERE t.event_id = ANY($1::bigint[])
       GROUP BY t.id ORDER BY t.division, t.dept, t.name`,
      [acts.filter(a => a.galore_teams_declared).map(a => a.id)]
    ),
  ]);
  const unitOf = (a) => (Number(a.team_size || 0) <= 0 ? 'individual'
    : Number(a.team_size) === 2 && Number(a.min_team_size) === 2 ? 'duo' : 'team');
  return {
    activities: acts.map(a => ({
      id: String(a.id), title: a.title, categoryName: a.category_name || '', unit: unitOf(a),
      genderSplit: !!a.gender_split, clubName: a.club_name || '', declared: !!a.galore_teams_declared,
    })),
    registrations: regs.map(r => ({
      registrationId: String(r.id), eventId: String(r.event_id), eventTitle: acts.find(a => String(a.id) === String(r.event_id))?.title || '',
      name: r.name, enrollmentNo: r.enrollment_no || '', dept: r.dept || '', gender: r.gender || '', course: r.course || '',
    })),
    teams: teams.map(t => ({
      id: String(t.id), activityId: String(t.event_id), name: t.name, division: t.division, dept: t.dept || '', members: t.members,
    })),
  };
}

module.exports.studentRosters = studentRosters;

/* Main coordinator only: declare an activity's selected teams / duos /
   individuals (students then see them), or take the declaration back */
async function setTeamsDeclared(email, activityId, declared) {
  const ctx = await access(email, activityId);
  if (ctx.scope !== 'head') throw new TeamError('Only the main Galore coordinator declares the selection.', 403);
  await pgPool.query(`UPDATE events SET galore_teams_declared = $1 WHERE id = $2`, [!!declared, ctx.a.id]);
  await changed();
  return { declared: !!declared };
}
module.exports.setTeamsDeclared = setTeamsDeclared;
