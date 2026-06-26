const { pgPool }          = require('../config/db');
const { ensureSoacTables } = require('../services/soacData');
const { getCoordClubIds }  = require('../services/coordAuth');

/* Verify this coordinator (or admin) has access to the event */
const checkAccess = async (req, res) => {
  if (req.user.role === 'admin') return true;
  const coordClubIds = await getCoordClubIds(req.user.id);
  if (!coordClubIds.length) {
    res.status(403).json({ message: 'No club assigned to your account.' });
    return false;
  }
  const { rows } = await pgPool.query(
    `SELECT id FROM events WHERE id = $1 AND is_active = true AND club_id = ANY($2::bigint[])`,
    [req.params.id, coordClubIds]
  );
  if (!rows.length) {
    res.status(403).json({ message: 'You do not have access to this event.' });
    return false;
  }
  return true;
};

const mapTeam = (t, members = []) => ({
  id:        String(t.id),
  name:      t.name,
  maxSize:   t.max_size,
  isCleared: t.is_cleared,
  createdAt: t.created_at,
  members,
});

const mapMember = (m) => ({
  id:             String(m.id),
  registrationId: String(m.registration_id),
  name:           m.member_name,
  enrollmentNo:   m.enrollment_no,
});

/* GET /api/events/:id/teams */
const getTeams = async (req, res, next) => {
  try {
    await ensureSoacTables();
    if (!await checkAccess(req, res)) return;

    const { rows: teams } = await pgPool.query(
      `SELECT id, name, max_size, is_cleared, created_at FROM event_teams WHERE event_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );

    let membersByTeam = {};
    if (teams.length) {
      const teamIds = teams.map(t => t.id);
      const { rows: members } = await pgPool.query(
        `SELECT id, team_id, registration_id, member_name, enrollment_no
         FROM event_team_members WHERE team_id = ANY($1::bigint[]) ORDER BY id ASC`,
        [teamIds]
      );
      for (const m of members) {
        const key = String(m.team_id);
        if (!membersByTeam[key]) membersByTeam[key] = [];
        membersByTeam[key].push(mapMember(m));
      }
    }

    res.json({ teams: teams.map(t => mapTeam(t, membersByTeam[String(t.id)] || [])) });
  } catch (err) { next(err); }
};

/* POST /api/events/:id/teams */
const createTeam = async (req, res, next) => {
  try {
    await ensureSoacTables();
    if (!await checkAccess(req, res)) return;

    const { name, maxSize = 0 } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Team name is required.' });

    const { rows } = await pgPool.query(
      `INSERT INTO event_teams (event_id, name, max_size) VALUES ($1, $2, $3)
       RETURNING id, name, max_size, is_cleared, created_at`,
      [req.params.id, name.trim(), Number(maxSize) || 0]
    );
    res.status(201).json({ team: mapTeam(rows[0], []) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'A team with this name already exists for this event.' });
    next(err);
  }
};

/* PUT /api/events/:id/teams/:teamId */
const updateTeam = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const { name, maxSize } = req.body;
    const { rows } = await pgPool.query(
      `UPDATE event_teams
       SET name     = COALESCE($1, name),
           max_size = COALESCE($2, max_size)
       WHERE id = $3 AND event_id = $4
       RETURNING id, name, max_size, is_cleared`,
      [name?.trim() || null, maxSize !== undefined ? Number(maxSize) : null, req.params.teamId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Team not found.' });
    res.json({ team: mapTeam(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'A team with this name already exists.' });
    next(err);
  }
};

/* DELETE /api/events/:id/teams/:teamId */
const deleteTeam = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    await pgPool.query(`DELETE FROM event_teams WHERE id = $1 AND event_id = $2`, [req.params.teamId, req.params.id]);
    res.json({ message: 'Team deleted.' });
  } catch (err) { next(err); }
};

/* PATCH /api/events/:id/teams/:teamId/clear  — toggle is_cleared */
const toggleClear = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const { rows } = await pgPool.query(
      `UPDATE event_teams SET is_cleared = NOT is_cleared WHERE id = $1 AND event_id = $2 RETURNING id, is_cleared`,
      [req.params.teamId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Team not found.' });
    res.json({ isCleared: rows[0].is_cleared });
  } catch (err) { next(err); }
};

/* POST /api/events/:id/teams/:teamId/members */
const addMember = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const { registrationId } = req.body;
    if (!registrationId) return res.status(400).json({ message: 'registrationId is required.' });

    // Verify registration belongs to this event
    const { rows: regRows } = await pgPool.query(
      `SELECT id, name, enrollment_no FROM event_registrations WHERE id = $1 AND event_id = $2`,
      [registrationId, req.params.id]
    );
    if (!regRows.length) return res.status(404).json({ message: 'Registration not found for this event.' });

    // Check max_size
    const { rows: teamRows } = await pgPool.query(
      `SELECT et.max_size, COUNT(etm.id) AS member_count
       FROM event_teams et
       LEFT JOIN event_team_members etm ON etm.team_id = et.id
       WHERE et.id = $1 AND et.event_id = $2
       GROUP BY et.id`,
      [req.params.teamId, req.params.id]
    );
    if (!teamRows.length) return res.status(404).json({ message: 'Team not found.' });
    const { max_size, member_count } = teamRows[0];
    if (max_size > 0 && Number(member_count) >= Number(max_size)) {
      return res.status(400).json({ message: `Team is full (max ${max_size} members).` });
    }

    const reg = regRows[0];
    const { rows } = await pgPool.query(
      `INSERT INTO event_team_members (team_id, registration_id, member_name, enrollment_no)
       VALUES ($1, $2, $3, $4)
       RETURNING id, registration_id, member_name, enrollment_no`,
      [req.params.teamId, reg.id, reg.name, reg.enrollment_no || '']
    );
    res.status(201).json({ member: mapMember(rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: 'This participant is already assigned to a team.' });
    next(err);
  }
};

/* DELETE /api/events/:id/teams/:teamId/members/:memberId */
const removeMember = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    await pgPool.query(
      `DELETE FROM event_team_members WHERE id = $1 AND team_id = $2`,
      [req.params.memberId, req.params.teamId]
    );
    res.json({ message: 'Member removed.' });
  } catch (err) { next(err); }
};

module.exports = { getTeams, createTeam, updateTeam, deleteTeam, toggleClear, addMember, removeMember };
