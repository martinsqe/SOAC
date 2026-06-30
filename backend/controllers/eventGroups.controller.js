const { pgPool }         = require('../config/db');
const { getCoordClubIds } = require('../services/coordAuth');

/* ── Migrations ── */
pgPool.query(`
  CREATE TABLE IF NOT EXISTS event_groups (
    id         BIGSERIAL    PRIMARY KEY,
    event_id   BIGINT       NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name       VARCHAR(100) NOT NULL,
    sort_order INTEGER      NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )
`).catch(() => {});

pgPool.query(`
  CREATE TABLE IF NOT EXISTS event_group_teams (
    id       BIGSERIAL PRIMARY KEY,
    group_id BIGINT    NOT NULL REFERENCES event_groups(id) ON DELETE CASCADE,
    team_id  BIGINT    NOT NULL REFERENCES event_teams(id)  ON DELETE CASCADE,
    event_id BIGINT    NOT NULL,
    UNIQUE (team_id, event_id)
  )
`).catch(() => {});

const checkAccess = async (req, res) => {
  if (req.user.role === 'admin') return true;
  const coordClubIds = await getCoordClubIds(req.user.id);
  if (!coordClubIds.length) { res.status(403).json({ message: 'No club assigned.' }); return false; }
  const { rows } = await pgPool.query(
    `SELECT id FROM events WHERE id = $1 AND is_active = true AND club_id = ANY($2::bigint[])`,
    [req.params.id, coordClubIds]
  );
  if (!rows.length) { res.status(403).json({ message: 'No access to this event.' }); return false; }
  return true;
};

/* Shared query used by both coordinator (auth) and public endpoints */
const fetchGroups = async (eventId) => {
  const [groupsRes, assignRes] = await Promise.all([
    pgPool.query(
      `SELECT id, name, sort_order FROM event_groups WHERE event_id = $1 ORDER BY sort_order ASC, created_at ASC`,
      [eventId]
    ),
    pgPool.query(
      `SELECT egt.group_id, egt.team_id, et.name AS team_name
       FROM event_group_teams egt
       JOIN event_teams et ON et.id = egt.team_id
       WHERE egt.event_id = $1`,
      [eventId]
    ),
  ]);
  const byGroup = {};
  for (const r of assignRes.rows) {
    const k = String(r.group_id);
    if (!byGroup[k]) byGroup[k] = [];
    byGroup[k].push({ id: String(r.team_id), name: r.team_name });
  }
  return groupsRes.rows.map(g => ({
    id: String(g.id), name: g.name, sortOrder: g.sort_order,
    teams: byGroup[String(g.id)] || [],
  }));
};

/* GET /events/:id/groups  (coord) */
const getGroups = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    res.json({ groups: await fetchGroups(req.params.id) });
  } catch (err) { next(err); }
};

/* GET /events/:id/public-groups  (no auth) */
const getPublicGroups = async (req, res, next) => {
  try {
    res.json({ groups: await fetchGroups(req.params.id) });
  } catch (err) { next(err); }
};

/* POST /events/:id/groups  — auto-name Group A, B, C… */
const createGroup = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const { rows: existing } = await pgPool.query(
      `SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM event_groups WHERE event_id = $1`,
      [req.params.id]
    );
    const sortOrder = Number(existing[0].max_order) + 1;
    const name = req.body.name?.trim() || `Group ${String.fromCharCode(65 + sortOrder)}`;
    const { rows } = await pgPool.query(
      `INSERT INTO event_groups (event_id, name, sort_order) VALUES ($1, $2, $3)
       RETURNING id, name, sort_order`,
      [req.params.id, name, sortOrder]
    );
    res.status(201).json({ group: { id: String(rows[0].id), name: rows[0].name, sortOrder: rows[0].sort_order, teams: [] } });
  } catch (err) { next(err); }
};

/* PATCH /events/:id/groups/:groupId  — rename */
const renameGroup = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Name required.' });
    const { rows } = await pgPool.query(
      `UPDATE event_groups SET name = $1 WHERE id = $2 AND event_id = $3 RETURNING id, name`,
      [name.trim(), req.params.groupId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Group not found.' });
    res.json({ group: { id: String(rows[0].id), name: rows[0].name } });
  } catch (err) { next(err); }
};

/* DELETE /events/:id/groups/:groupId */
const deleteGroup = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    await pgPool.query(`DELETE FROM event_groups WHERE id = $1 AND event_id = $2`, [req.params.groupId, req.params.id]);
    res.json({ message: 'Group deleted.' });
  } catch (err) { next(err); }
};

/* POST /events/:id/groups/:groupId/assign  — move team into this group */
const assignTeam = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const { teamId } = req.body;
    if (!teamId) return res.status(400).json({ message: 'teamId required.' });
    /* Remove from any previous group first (team can only be in one group per event) */
    await pgPool.query(`DELETE FROM event_group_teams WHERE team_id = $1 AND event_id = $2`, [teamId, req.params.id]);
    await pgPool.query(
      `INSERT INTO event_group_teams (group_id, team_id, event_id) VALUES ($1, $2, $3)`,
      [req.params.groupId, teamId, req.params.id]
    );
    res.json({ message: 'Team assigned.' });
  } catch (err) { next(err); }
};

/* DELETE /events/:id/groups/:groupId/teams/:teamId */
const unassignTeam = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    await pgPool.query(
      `DELETE FROM event_group_teams WHERE group_id = $1 AND team_id = $2`,
      [req.params.groupId, req.params.teamId]
    );
    res.json({ message: 'Team removed from group.' });
  } catch (err) { next(err); }
};

module.exports = { getGroups, getPublicGroups, createGroup, renameGroup, deleteGroup, assignTeam, unassignTeam };
