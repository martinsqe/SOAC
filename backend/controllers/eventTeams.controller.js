const { pgPool }          = require('../config/db');
const cache               = require('../services/cache');
const { ensureSoacTables } = require('../services/soacData');
const { getCoordClubIds }  = require('../services/coordAuth');
const bracketEngine        = require('../services/bracketEngine');
const { fetchGroups }      = require('./eventGroups.controller');
const { autoRefreshReportIfExists } = require('./reports.controller');
const { sendTeamAssignment } = require('../config/email');

/* Award 55 coins to every member of a cleared team — fire-and-forget */
async function awardEventParticipationCoins(eventId, teamId, teamName) {
  try {
    const { rows: evRows } = await pgPool.query(
      `SELECT title, club_id FROM events WHERE id = $1`, [eventId]
    );
    if (!evRows.length) return;
    const { title: eventTitle, club_id: clubId } = evRows[0];

    /* Members: join team_members → registrations → users via email */
    const { rows: members } = await pgPool.query(
      `SELECT DISTINCT u.id AS user_id, u.name AS user_name
       FROM event_team_members etm
       JOIN event_registrations er ON er.id = etm.registration_id
       JOIN users u ON u.email = er.email AND u.is_active = true
       WHERE etm.team_id = $1`,
      [teamId]
    );
    if (!members.length) return;

    const yr = new Date().getFullYear();
    const academicYear = `${yr}-${String(yr + 1).slice(-2)}`;
    const entityId     = String(teamId);
    const reason       = `Event participation: ${eventTitle}`;
    const notifTitle   = 'Event Participation Reward';
    const notifBody    = `You earned 55 coins for participating in "${eventTitle}" (${teamName})!`;

    for (const m of members) {
      /* Idempotent: only award once per user per team clearance */
      const ins = await pgPool.query(
        `INSERT INTO coin_transactions (user_id, amount, reason, entity_type, entity_id, academic_year)
         SELECT $1, 55, $2, 'event_clearance', $3, $4
         WHERE NOT EXISTS (
           SELECT 1 FROM coin_transactions
           WHERE user_id = $1 AND entity_type = 'event_clearance' AND entity_id = $3
         )
         RETURNING id`,
        [m.user_id, reason, entityId, academicYear]
      );
      if (ins.rowCount > 0) {
        await pgPool.query(
          `INSERT INTO member_notifications (user_id, club_id, title, body, type)
           VALUES ($1, $2, $3, $4, 'achievement')`,
          [m.user_id, clubId || null, notifTitle, notifBody]
        );
      }
    }
  } catch (e) {
    console.error('[coins] awardEventParticipationCoins error:', e.message);
  }
}

/* Emails every team member (at their registration email) their own group + team +
   teammates once a coordinator declares groups/teams/fixtures for a division — fire-and-
   forget, applies to any sports-category club. Deliberately per-recipient try/catch so one
   bad address never blocks the rest of the team from being notified. */
async function notifyTeamAssignments(eventId, division) {
  try {
    const { rows: evRows } = await pgPool.query(
      `SELECT e.title, c.category
       FROM events e LEFT JOIN clubs c ON c.id = e.club_id
       WHERE e.id = $1::bigint`,
      [eventId]
    );
    if (!evRows.length || evRows[0].category !== 'sports') return;
    const eventTitle = evRows[0].title;

    const { rows } = await pgPool.query(
      `SELECT t.id AS team_id, t.name AS team_name, g.name AS group_name,
              tm.member_name, er.email
       FROM event_teams t
       LEFT JOIN event_group_teams egt ON egt.team_id = t.id
       LEFT JOIN event_groups g ON g.id = egt.group_id
       JOIN event_team_members tm ON tm.team_id = t.id
       JOIN event_registrations er ON er.id = tm.registration_id
       WHERE t.event_id = $1::bigint AND t.division = $2`,
      [eventId, division]
    );
    if (!rows.length) return;

    const teams = {};
    for (const r of rows) {
      const key = String(r.team_id);
      if (!teams[key]) teams[key] = { teamName: r.team_name, groupName: r.group_name, members: [] };
      teams[key].members.push({ name: r.member_name, email: r.email });
    }

    const divisionLabel = division === 'girls' ? 'Girls' : 'Boys';
    const sendJobs = [];
    for (const team of Object.values(teams)) {
      const teammateNames = team.members.map(m => m.name);
      for (const m of team.members) {
        if (!m.email) continue;
        sendJobs.push(
          sendTeamAssignment({
            toEmail:  m.email,
            toName:   m.name,
            eventTitle,
            division: divisionLabel,
            groupName: team.groupName,
            teamName:  team.teamName,
            teammates: teammateNames,
          }).catch(err => console.error(`[notifyTeamAssignments] failed for ${m.email}:`, err.message))
        );
      }
    }
    await Promise.allSettled(sendJobs);
  } catch (e) {
    console.error('[notifyTeamAssignments] error:', e.message);
  }
}

/* Ensure fixtures table exists with result columns */
pgPool.query(`
  CREATE TABLE IF NOT EXISTS event_fixtures (
    id          BIGSERIAL    PRIMARY KEY,
    event_id    BIGINT       NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    team_a_name VARCHAR(255) NOT NULL DEFAULT '',
    team_b_name VARCHAR(255) NOT NULL DEFAULT '',
    match_date  DATE,
    match_time  VARCHAR(20),
    venue       VARCHAR(255),
    round       VARCHAR(100),
    sort_order  INTEGER      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )
`).then(() => pgPool.query(`
  ALTER TABLE event_fixtures
    ADD COLUMN IF NOT EXISTS score_a        INTEGER      DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS score_b        INTEGER      DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS winner_name    VARCHAR(255) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN      NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS division       VARCHAR(10)  NOT NULL DEFAULT 'boys'
`)).catch(() => {});

/* Stage schedule: coordinator-supplied estimated date/venue for each later bracket round,
   keyed by the same round labels the bracket engine / preview compute — separately per
   division, since Boys and Girls brackets can need a different number of rounds. */
pgPool.query(`
  CREATE TABLE IF NOT EXISTS event_stage_schedule (
    id          BIGSERIAL    PRIMARY KEY,
    event_id    BIGINT       NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    round_label VARCHAR(100) NOT NULL,
    match_date  DATE,
    match_time  VARCHAR(20),
    venue       VARCHAR(255),
    sort_order  INTEGER      NOT NULL DEFAULT 0,
    UNIQUE (event_id, round_label)
  )
`).then(() => pgPool.query(`
  ALTER TABLE event_stage_schedule ADD COLUMN IF NOT EXISTS division VARCHAR(10) NOT NULL DEFAULT 'boys'
`)).then(() => pgPool.query(
  `ALTER TABLE event_stage_schedule DROP CONSTRAINT IF EXISTS event_stage_schedule_event_id_round_label_key`
)).then(() => pgPool.query(`
  DO $$ BEGIN
    ALTER TABLE event_stage_schedule ADD CONSTRAINT event_stage_schedule_event_division_round_label_key UNIQUE (event_id, division, round_label);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;
`)).catch(() => {});

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

const asDivision = (v) => (v === 'girls' ? 'girls' : v === 'boys' ? 'boys' : null);

const mapTeam = (t, members = []) => ({
  id:        String(t.id),
  name:      t.name,
  maxSize:   t.max_size,
  isCleared: t.is_cleared,
  division:  t.division,
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
      `SELECT id, name, max_size, is_cleared, division, created_at FROM event_teams WHERE event_id = $1 ORDER BY created_at ASC`,
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
    const division = asDivision(req.body.division) || 'boys';
    if (!name?.trim()) return res.status(400).json({ message: 'Team name is required.' });

    const { rows } = await pgPool.query(
      `INSERT INTO event_teams (event_id, name, max_size, division) VALUES ($1, $2, $3, $4)
       RETURNING id, name, max_size, is_cleared, division, created_at`,
      [req.params.id, name.trim(), Number(maxSize) || 0, division]
    );
    res.status(201).json({ team: mapTeam(rows[0], []) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ message: `A ${asDivision(req.body?.division) || 'boys'} team with this name already exists for this event.` });
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
      `UPDATE event_teams SET is_cleared = NOT is_cleared WHERE id = $1 AND event_id = $2 RETURNING id, name, is_cleared`,
      [req.params.teamId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Team not found.' });
    const io = req.app.get('io');
    if (io) io.emit('team:cleared:updated', {
      eventId: String(req.params.id), teamId: String(rows[0].id),
      isCleared: rows[0].is_cleared, teamName: rows[0].name,
    });
    if (rows[0].is_cleared) {
      awardEventParticipationCoins(req.params.id, rows[0].id, rows[0].name).catch(() => {});
    }
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
    const io = req.app.get('io');
    if (io) io.emit('team:member:added', { eventId: String(req.params.id), teamId: String(req.params.teamId) });
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
    const io = req.app.get('io');
    if (io) io.emit('team:member:removed', { eventId: String(req.params.id), teamId: String(req.params.teamId) });
    res.json({ message: 'Member removed.' });
  } catch (err) { next(err); }
};

/* Shared query used by the coordinator fixtures endpoint and the bracket engine.
   Pass `division` to scope to one division's fixtures only; omit it to get every
   fixture across both divisions. */
const fetchFixtures = async (eventId, division) => {
  const div = asDivision(division);
  const sql = div
    ? `SELECT id, team_a_name, team_b_name,
              TO_CHAR(match_date, 'YYYY-MM-DD') AS match_date,
              match_time, venue, round, sort_order,
              score_a, score_b, winner_name, auto_generated, division
       FROM event_fixtures WHERE event_id = $1 AND division = $2 ORDER BY sort_order ASC, created_at ASC`
    : `SELECT id, team_a_name, team_b_name,
              TO_CHAR(match_date, 'YYYY-MM-DD') AS match_date,
              match_time, venue, round, sort_order,
              score_a, score_b, winner_name, auto_generated, division
       FROM event_fixtures WHERE event_id = $1 ORDER BY sort_order ASC, created_at ASC`;
  const { rows } = await pgPool.query(sql, div ? [eventId, div] : [eventId]);
  return rows.map(f => ({
    id: String(f.id), teamA: f.team_a_name, teamB: f.team_b_name,
    date: f.match_date || '',
    time: f.match_time || '', venue: f.venue || '', round: f.round || '',
    scoreA: f.score_a ?? null, scoreB: f.score_b ?? null, winner: f.winner_name || null,
    autoGenerated: !!f.auto_generated, division: f.division,
  }));
};

/* GET /api/events/:id/fixtures?division=  (coordinator — load existing fixtures for editing) */
const getFixtures = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    res.json({ fixtures: await fetchFixtures(req.params.id, req.query.division) });
  } catch (err) { next(err); }
};

/* GET /api/events/:id/public-fixtures  (public — student/landing page view) */
const getPublicFixtures = async (req, res, next) => {
  try {
    const eventId = req.params.id;

    const [teamsRes, membersRes, fixturesRes] = await Promise.all([
      pgPool.query(
        `SELECT id, name, division FROM event_teams WHERE event_id = $1 ORDER BY created_at ASC`,
        [eventId]
      ),
      pgPool.query(
        `SELECT etm.team_id, etm.member_name, etm.enrollment_no
         FROM event_team_members etm
         JOIN event_teams et ON et.id = etm.team_id
         WHERE et.event_id = $1 ORDER BY etm.id ASC`,
        [eventId]
      ),
      pgPool.query(
        `SELECT team_a_name, team_b_name, match_date, match_time, venue, round, sort_order,
                score_a, score_b, winner_name, division
         FROM event_fixtures WHERE event_id = $1 ORDER BY sort_order ASC, created_at ASC`,
        [eventId]
      ),
    ]);

    const membersByTeam = {};
    for (const m of membersRes.rows) {
      const k = String(m.team_id);
      if (!membersByTeam[k]) membersByTeam[k] = [];
      membersByTeam[k].push({ name: m.member_name, enrollmentNo: m.enrollment_no || '' });
    }

    const teams = teamsRes.rows.map(t => ({
      id: String(t.id), name: t.name, division: t.division,
      members: membersByTeam[String(t.id)] || [],
    }));

    const fixtures = fixturesRes.rows.map(f => ({
      teamA: f.team_a_name, teamB: f.team_b_name,
      date: f.match_date ? new Date(f.match_date).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '',
      time: f.match_time || '', venue: f.venue || '', round: f.round || '',
      scoreA: f.score_a ?? null, scoreB: f.score_b ?? null, winner: f.winner_name || null,
      division: f.division,
    }));

    res.json({ teams, fixtures });
  } catch (err) { next(err); }
};

/* POST /api/events/:id/fixtures/save-declare  (coordinator)
   Scoped to a single `division` — declaring Boys fixtures never touches Girls
   fixtures/scoreboards, and vice versa. */
const saveAndDeclare = async (req, res, next) => {
  const pgClient = await pgPool.connect();
  try {
    if (!await checkAccess(req, res)) return;
    const division = asDivision(req.body.division) || 'boys';
    const { fixtures = [] } = req.body; // [{teamA, teamB, date, time, venue, round}]

    await pgClient.query('BEGIN');

    /* Remove draft/ended scoreboards for this division's manually-declared fixtures so
       re-declaring starts clean. Live scoreboards, the other division's scoreboards, and
       anything tied to a system auto-generated later-round fixture are left untouched. */
    await pgClient.query(
      `DELETE FROM club_live_scores
       WHERE event_id = $1 AND status IN ('draft','ended') AND division = $2`,
      [req.params.id, division]
    );

    /* Replace only this division's manually-declared fixtures — the other division, and
       auto-generated later-round fixtures (created as winners advance), are left in place. */
    await pgClient.query(
      `DELETE FROM event_fixtures WHERE event_id = $1 AND auto_generated = false AND division = $2`,
      [req.params.id, division]
    );

    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i];
      await pgClient.query(
        `INSERT INTO event_fixtures (event_id, team_a_name, team_b_name, match_date, match_time, venue, round, sort_order, division)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          req.params.id,
          f.teamA?.trim() || '',
          f.teamB?.trim() || '',
          f.date || null,
          f.time?.trim() || null,
          f.venue?.trim() || null,
          f.round?.trim() || null,
          i,
          division,
        ]
      );
    }

    /* Mark event as fixtures declared */
    await pgClient.query(
      `UPDATE events SET fixtures_declared = true WHERE id = $1`,
      [req.params.id]
    );

    await pgClient.query('COMMIT');

    /* Bust events cache so students see fixtures_declared: true immediately */
    await Promise.all([
      cache.del(`events:${req.params.id}`),
      cache.delPattern('events:*'),
    ]).catch(() => {});

    autoRefreshReportIfExists(req.params.id).catch(() => {});
    notifyTeamAssignments(req.params.id, division).catch(() => {});
    res.json({ message: 'Fixtures saved and declared.' });
  } catch (err) {
    await pgClient.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    pgClient.release();
  }
};

/* PATCH /api/events/:id/fixtures/:fixtureId/result  (coordinator) */
const recordResult = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const { scoreA, scoreB, winner } = req.body;
    const { rows } = await pgPool.query(
      `UPDATE event_fixtures
       SET score_a = $1, score_b = $2, winner_name = $3
       WHERE id = $4 AND event_id = $5
       RETURNING id, team_a_name, team_b_name, score_a, score_b, winner_name, division`,
      [
        scoreA !== undefined && scoreA !== '' ? Number(scoreA) : null,
        scoreB !== undefined && scoreB !== '' ? Number(scoreB) : null,
        winner?.trim() || null,
        req.params.fixtureId,
        req.params.id,
      ]
    );
    if (!rows.length) return res.status(404).json({ message: 'Fixture not found.' });
    const r = rows[0];
    /* Broadcast so open bracket previews auto-refresh */
    const io = req.app.get('io');
    if (io && r.winner_name) {
      io.emit('bracket:result:updated', {
        eventId:   String(req.params.id),
        fixtureId: String(r.id),
        winner:    r.winner_name,
        teamA:     r.team_a_name || '',
        teamB:     r.team_b_name || '',
        division:  r.division,
      });
    }
    if (r.winner_name) {
      /* Processes both divisions internally — a no-op for whichever one didn't change. */
      bracketEngine.advanceBracket({ eventId: req.params.id, io }).catch(() => {});
    }
    res.json({ fixtureId: String(r.id), scoreA: r.score_a, scoreB: r.score_b, winner: r.winner_name });
  } catch (err) { next(err); }
};

/* DELETE /api/events/:id/fixtures/:fixtureId  (coordinator — remove single fixture) */
const deleteFixture = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const { rows } = await pgPool.query(
      `DELETE FROM event_fixtures WHERE id = $1 AND event_id = $2 RETURNING id, winner_name, division`,
      [req.params.fixtureId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Fixture not found.' });
    /* If this fixture's winner had already advanced to a later round, retract that
       downstream matchup too — it no longer has a valid source. Scoped to this fixture's
       own division so an identically-named team in the other division is never touched. */
    if (rows[0].winner_name) {
      bracketEngine.retractDownstream({
        eventId: req.params.id, teamName: rows[0].winner_name, division: rows[0].division, io: req.app.get('io'),
      }).catch(() => {});
    }
    autoRefreshReportIfExists(req.params.id).catch(() => {});
    res.json({ message: 'Fixture deleted.' });
  } catch (err) { next(err); }
};

/* GET /api/events/:id/stage-schedule?division=  (coordinator)
   Returns one row per later round THIS division's bracket needs (Round 1 is manual
   and excluded — and Boys/Girls can need a different number of rounds), merged with
   any dates the coordinator already saved for that division. */
const getStageSchedule = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const division = asDivision(req.query.division) || 'boys';
    const groups = await fetchGroups(req.params.id, division);
    const labels = bracketEngine.getStageLabels(groups);

    const { rows } = await pgPool.query(
      `SELECT round_label, TO_CHAR(match_date, 'YYYY-MM-DD') AS match_date, match_time, venue
       FROM event_stage_schedule WHERE event_id = $1 AND division = $2`,
      [req.params.id, division]
    );
    const saved = {};
    rows.forEach(r => { saved[r.round_label] = r; });

    res.json({
      stages: labels.map(label => ({
        label,
        date:  saved[label]?.match_date || '',
        time:  saved[label]?.match_time || '',
        venue: saved[label]?.venue || '',
      })),
    });
  } catch (err) { next(err); }
};

/* PUT /api/events/:id/stage-schedule  (coordinator) */
const saveStageSchedule = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const division = asDivision(req.body.division) || 'boys';
    const { stages = [] } = req.body; // [{label, date, time, venue}]
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i];
      if (!s.label?.trim()) continue;
      await pgPool.query(
        `INSERT INTO event_stage_schedule (event_id, round_label, match_date, match_time, venue, sort_order, division)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (event_id, division, round_label) DO UPDATE SET
           match_date = EXCLUDED.match_date,
           match_time = EXCLUDED.match_time,
           venue      = EXCLUDED.venue,
           sort_order = EXCLUDED.sort_order`,
        [req.params.id, s.label.trim(), s.date || null, s.time?.trim() || null, s.venue?.trim() || null, i, division]
      );
    }
    res.json({ message: 'Stage schedule saved.' });
  } catch (err) { next(err); }
};

/* GET /api/events/:id/my-status  (student — check own registration status) */
const getMyStatus = async (req, res, next) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ message: 'Not authenticated.' });
    const { rows: regRows } = await pgPool.query(
      `SELECT id FROM event_registrations WHERE event_id = $1 AND email = $2`,
      [req.params.id, email]
    );
    if (!regRows.length) return res.json({ registered: false });
    const { rows: memberRows } = await pgPool.query(
      `SELECT et.name AS team_name, et.is_cleared
       FROM event_team_members etm
       JOIN event_teams et ON et.id = etm.team_id
       WHERE etm.registration_id = $1`,
      [regRows[0].id]
    );
    if (!memberRows.length) return res.json({ registered: true, status: 'registered' });
    const team = memberRows[0];
    return res.json({
      registered: true,
      status: team.is_cleared ? 'cleared' : 'team_assigned',
      teamName: team.team_name,
    });
  } catch (err) { next(err); }
};

module.exports = { getTeams, createTeam, updateTeam, deleteTeam, toggleClear, addMember, removeMember, getFixtures, getPublicFixtures, saveAndDeclare, recordResult, deleteFixture, getStageSchedule, saveStageSchedule, getMyStatus };
