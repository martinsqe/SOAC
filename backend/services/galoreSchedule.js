/* Galore schedule — every activity's date, time and venue (set by the overall
   Galore coordinator on the Schedule page) plus the matches between teams.

   Teams are formed by each activity's club (the student coordinators) from the
   registrations; the overall Galore coordinator then picks which team plays
   which, and when and where. Those matches are ordinary event_fixtures rows of
   the activity, so the club's Match Control, results, brackets, certificates
   and reports keep working on them unchanged. */
const { pgPool } = require('../config/db');
const cache = require('./cache');
const bracketEngine = require('./bracketEngine');

class ScheduleError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const isoDay = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const text = (v, max) => String(v ?? '').trim().slice(0, max);

/* Every activity of the event with its schedule, and every match.
   forStudent: only what the main coordinator has declared — nothing until the
   schedule is declared, and no matches until the fixtures are. */
async function eventSchedule(umbrellaId, { forStudent = false } = {}) {
  const { rows: [flags] } = await pgPool.query(
    `SELECT galore_schedule_declared AS schedule, galore_fixtures_declared AS fixtures, start_date FROM events WHERE id = $1`, [umbrellaId]
  );
  const declared = { schedule: !!flags?.schedule, fixtures: !!flags?.fixtures };
  const eventStart = flags?.start_date ? isoDay(flags.start_date) : '';
  if (forStudent && !declared.schedule) return { activities: [], fixtures: [], declared, eventStart };
  const [{ rows: acts }, { rows: fx }, { rows: ss }] = await Promise.all([
    pgPool.query(
      `SELECT e.id, e.title, e.category, e.start_date, e.date, e.time, e.venue, e.galore_duration, e.galore_reporting_time, e.team_size, e.min_team_size, e.gender_split,
              c.name AS category_name, c.sort_order AS cat_order,
              (SELECT name FROM clubs WHERE clubs.id = e.club_id) AS club_name,
              (SELECT COUNT(*)::int FROM event_teams t WHERE t.event_id = e.id) AS team_count
       FROM events e
       LEFT JOIN galore_categories c ON c.id = e.galore_category_id
       WHERE e.parent_event_id = $1 AND e.is_active = true
       ORDER BY c.sort_order NULLS LAST, e.title`,
      [umbrellaId]
    ),
    pgPool.query(
      `SELECT f.id, f.event_id, f.team_a_name, f.team_b_name, TO_CHAR(f.match_date, 'YYYY-MM-DD') AS match_date,
              f.match_time, f.reporting_time, f.venue, f.round, f.duration, f.division, f.score_a, f.score_b, f.winner_name
       FROM event_fixtures f
       JOIN events e ON e.id = f.event_id AND e.is_active = true
       WHERE e.parent_event_id = $1
       ORDER BY f.match_date NULLS LAST, f.sort_order, f.created_at`,
      [umbrellaId]
    ),
    pgPool.query(
      `SELECT s.id, s.activity_id, s.label, s.division, TO_CHAR(s.session_date, 'YYYY-MM-DD') AS session_date,
              s.reporting_time, s.duration, s.venue
       FROM galore_sessions s
       JOIN events e ON e.id = s.activity_id AND e.is_active = true
       WHERE e.parent_event_id = $1
       ORDER BY s.session_date NULLS LAST, s.reporting_time, s.id`,
      [umbrellaId]
    ).catch(() => ({ rows: [] })),
  ]);
  return {
    activities: acts.map(a => ({
      id: String(a.id), title: a.title, categoryName: a.category_name || '', categoryOrder: a.cat_order ?? 999,
      date: a.start_date ? isoDay(a.start_date) : '', dateLabel: a.date || '', time: a.time || '', venue: a.venue || '',
      duration: a.galore_duration || '', reportingTime: a.galore_reporting_time || '',
      /* sports activities list matches; the rest (cultural, …) their event details */
      isSports: /sport/i.test(`${a.category || ''} ${a.category_name || ''}`),
      isTeam: Number(a.team_size || 0) > 0,
      /* duo (exactly 2) or team — how the activity was defined on the Galore form */
      teamUnit: Number(a.team_size || 0) <= 0 ? 'individual' : Number(a.team_size) === 2 && Number(a.min_team_size) === 2 ? 'duo' : 'team',
      genderSplit: !!a.gender_split, clubName: a.club_name || '', teamCount: a.team_count,
    })),
    fixtures: forStudent && !declared.fixtures ? [] : fx.map(fixtureOut),
    sessions: ss.map(sessionOut),
    declared, eventStart,
  };
}

/* Main coordinator: declare (or take back) the schedule and / or the fixtures */
async function setDeclared(umbrellaId, body = {}) {
  const sets = [], vals = [umbrellaId];
  if (typeof body.schedule === 'boolean') { vals.push(body.schedule); sets.push(`galore_schedule_declared = $${vals.length}`); }
  if (typeof body.fixtures === 'boolean') { vals.push(body.fixtures); sets.push(`galore_fixtures_declared = $${vals.length}`); }
  if (!sets.length) throw new ScheduleError('Nothing to change.');
  const { rows: [before] } = await pgPool.query(`SELECT galore_schedule_declared AS schedule FROM events WHERE id = $1`, [umbrellaId]);
  const { rows: [r] } = await pgPool.query(
    `UPDATE events SET ${sets.join(', ')} WHERE id = $1 AND event_format = 'galore'
     RETURNING galore_schedule_declared AS schedule, galore_fixtures_declared AS fixtures`, vals
  );
  if (!r) throw new ScheduleError('Galore event not found.', 404);
  await cache.delPattern('events:*').catch(() => {});
  /* just declared: tell every registered student to log in and check it (in the background) */
  if (r.schedule && !before?.schedule) emailScheduleDeclared(umbrellaId).catch(err => console.warn('[galore] schedule email failed:', err.message));
  return { schedule: r.schedule, fixtures: r.fixtures };
}

async function emailScheduleDeclared(umbrellaId) {
  const { sendGaloreScheduleDeclared } = require('../config/email');
  const { rows: [ev] } = await pgPool.query(`SELECT title FROM events WHERE id = $1`, [umbrellaId]);
  const { rows } = await pgPool.query(
    `SELECT DISTINCT ON (LOWER(er.email)) LOWER(er.email) AS email, er.name
     FROM event_registrations er JOIN events a ON a.id = er.event_id AND a.is_active = true
     WHERE a.parent_event_id = $1 AND er.email NOT ILIKE '%@roster.internal'`,
    [umbrellaId]
  );
  for (const p of rows) {
    await sendGaloreScheduleDeclared({ toEmail: p.email, toName: p.name, eventTitle: ev?.title })
      .catch(err => console.warn(`[galore] schedule email to ${p.email} failed:`, err.message));
  }
}

const sessionOut = (x) => ({
  id: String(x.id), activityId: String(x.activity_id), label: x.label || '', division: x.division || '',
  date: x.session_date || '', reportingTime: x.reporting_time || '', duration: x.duration || '', venue: x.venue || '',
});

/* Main coordinator: an activity's sessions (stages / rounds) */
function sessionFields(body = {}) {
  const date = text(body.date, 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ScheduleError('Pick a valid day.');
  const reportingTime = text(body.reportingTime, 20);
  if (!reportingTime) throw new ScheduleError('Add the reporting time: a session only appears on the schedule once it has one.');
  const division = body.division === 'boys' || body.division === 'girls' ? body.division : '';
  return { label: text(body.label, 100), division, date: date || null, reportingTime, duration: text(body.duration, 50), venue: text(body.venue, 255) };
}
async function addSession(umbrellaId, body = {}) {
  await activityOf(umbrellaId, body.activityId);
  const v = sessionFields(body);
  const { rows: [r] } = await pgPool.query(
    `INSERT INTO galore_sessions (activity_id, label, division, session_date, reporting_time, duration, venue)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, activity_id, label, division, TO_CHAR(session_date, 'YYYY-MM-DD') AS session_date, reporting_time, duration, venue`,
    [body.activityId, v.label, v.division, v.date, v.reportingTime, v.duration, v.venue]
  );
  await cache.delPattern('events:*').catch(() => {});
  return sessionOut(r);
}
async function sessionOf(umbrellaId, sessionId) {
  if (!/^\d+$/.test(String(sessionId))) throw new ScheduleError('Session not found.', 404);
  const { rows: [x] } = await pgPool.query(
    `SELECT s.id FROM galore_sessions s JOIN events e ON e.id = s.activity_id AND e.is_active = true
     WHERE s.id = $1 AND e.parent_event_id = $2`, [sessionId, umbrellaId]
  );
  if (!x) throw new ScheduleError('Session not found — it may have been removed.', 404);
}
async function updateSession(umbrellaId, sessionId, body = {}) {
  await sessionOf(umbrellaId, sessionId);
  const v = sessionFields(body);
  const { rows: [r] } = await pgPool.query(
    `UPDATE galore_sessions SET label = $2, division = $3, session_date = $4, reporting_time = $5, duration = $6, venue = $7
     WHERE id = $1
     RETURNING id, activity_id, label, division, TO_CHAR(session_date, 'YYYY-MM-DD') AS session_date, reporting_time, duration, venue`,
    [sessionId, v.label, v.division, v.date, v.reportingTime, v.duration, v.venue]
  );
  await cache.delPattern('events:*').catch(() => {});
  return sessionOut(r);
}
async function deleteSession(umbrellaId, sessionId) {
  await sessionOf(umbrellaId, sessionId);
  await pgPool.query(`DELETE FROM galore_sessions WHERE id = $1`, [sessionId]);
  await cache.delPattern('events:*').catch(() => {});
}

const fixtureOut = (f) => ({
  id: String(f.id), activityId: String(f.event_id), teamA: f.team_a_name, teamB: f.team_b_name,
  date: f.match_date || '', time: f.match_time || '', reportingTime: f.reporting_time || '', venue: f.venue || '', round: f.round || '', duration: f.duration || '',
  division: f.division, scoreA: f.score_a ?? null, scoreB: f.score_b ?? null, winner: f.winner_name || null,
});

/* Every team the clubs have formed, for every activity: { [activityId]: team[] } */
async function eventTeams(umbrellaId) {
  const { rows } = await pgPool.query(
    `SELECT t.id, t.event_id, t.name, t.division, t.dept,
            COALESCE(json_agg(json_build_object('name', m.member_name, 'enrollmentNo', m.enrollment_no) ORDER BY m.id)
                     FILTER (WHERE m.id IS NOT NULL), '[]') AS members
     FROM event_teams t
     JOIN events e ON e.id = t.event_id AND e.is_active = true AND e.parent_event_id = $1
     LEFT JOIN event_team_members m ON m.team_id = t.id
     GROUP BY t.id ORDER BY t.division, t.name`,
    [umbrellaId]
  );
  const out = {};
  for (const t of rows) {
    (out[String(t.event_id)] ||= []).push({ id: String(t.id), name: t.name, division: t.division, dept: t.dept || '', members: t.members });
  }
  return out;
}

/* The activity must belong to this Galore event */
async function activityOf(umbrellaId, activityId) {
  const { rows: [a] } = await pgPool.query(
    `SELECT id FROM events WHERE id = $1 AND parent_event_id = $2 AND is_active = true`,
    [activityId, umbrellaId]
  );
  if (!a) throw new ScheduleError('Activity not found in this Galore event.', 404);
  return a;
}

/* Two different teams of the activity, in the same division (Boys play Boys) */
async function pickTeams(activityId, teamAId, teamBId) {
  if (!teamAId || !teamBId) throw new ScheduleError('Choose both teams.');
  if (String(teamAId) === String(teamBId)) throw new ScheduleError('A team cannot play itself — choose two different teams.');
  const { rows } = await pgPool.query(
    `SELECT id, name, division FROM event_teams WHERE event_id = $1 AND id = ANY($2::bigint[])`,
    [activityId, [teamAId, teamBId].map(String).filter(x => /^\d+$/.test(x))]
  );
  const a = rows.find(t => String(t.id) === String(teamAId));
  const b = rows.find(t => String(t.id) === String(teamBId));
  if (!a || !b) throw new ScheduleError('Those teams are not in this activity any more — reload and try again.');
  if (a.division !== b.division) throw new ScheduleError('Both teams must be in the same division (Boys with Boys, Girls with Girls).');
  return { a, b };
}

function matchFields(body) {
  const date = text(body.date, 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ScheduleError('Pick a valid date.');
  return { date: date || null, time: text(body.time, 20) || null, reportingTime: text(body.reportingTime, 20) || null, venue: text(body.venue, 255) || null, round: text(body.round, 100) || null, duration: text(body.duration, 50) || null };
}

/* Students' and clubs' views read fixtures_declared — keep it in step */
async function afterChange(activityId) {
  await pgPool.query(
    `UPDATE events SET fixtures_declared = EXISTS (SELECT 1 FROM event_fixtures WHERE event_id = $1) WHERE id = $1`,
    [activityId]
  );
  await cache.delPattern('events:*').catch(() => {});
}

async function addFixture(umbrellaId, body = {}) {
  await activityOf(umbrellaId, body.activityId);
  const { a, b } = await pickTeams(body.activityId, body.teamAId, body.teamBId);
  const m = matchFields(body);
  const { rows: [row] } = await pgPool.query(
    `INSERT INTO event_fixtures (event_id, team_a_name, team_b_name, match_date, match_time, venue, round, division, duration, reporting_time, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM event_fixtures WHERE event_id = $1))
     RETURNING id, event_id, team_a_name, team_b_name, TO_CHAR(match_date, 'YYYY-MM-DD') AS match_date,
               match_time, reporting_time, venue, round, duration, division, score_a, score_b, winner_name`,
    [body.activityId, a.name, b.name, m.date, m.time, m.venue, m.round, a.division, m.duration, m.reportingTime]
  );
  await afterChange(body.activityId);
  return fixtureOut(row);
}

async function fixtureOf(umbrellaId, fixtureId) {
  const { rows: [f] } = await pgPool.query(
    `SELECT f.*, EXISTS (SELECT 1 FROM club_live_scores s WHERE s.fixture_id = f.id AND s.status = 'live') AS is_live
     FROM event_fixtures f JOIN events e ON e.id = f.event_id AND e.is_active = true
     WHERE f.id = $1 AND e.parent_event_id = $2`,
    [fixtureId, umbrellaId]
  );
  if (!f) throw new ScheduleError('Match not found — it may have been removed.', 404);
  return f;
}

/* Date / time / venue / round can always change; the teams only until the match
   has started or has a result (the club records those in Match Control). */
async function updateFixture(umbrellaId, fixtureId, body = {}) {
  const f = await fixtureOf(umbrellaId, fixtureId);
  const m = matchFields(body);
  let teamA = f.team_a_name, teamB = f.team_b_name, division = f.division;
  if (body.teamAId || body.teamBId) {
    const { a, b } = await pickTeams(f.event_id, body.teamAId, body.teamBId);
    const changed = a.name !== f.team_a_name || b.name !== f.team_b_name || a.division !== f.division;
    if (changed && (f.winner_name || f.score_a != null || f.is_live)) {
      throw new ScheduleError('This match has already started or has a result, so its teams can’t be changed. You can still change the date, time and venue.', 409);
    }
    teamA = a.name; teamB = b.name; division = a.division;
  }
  const { rows: [row] } = await pgPool.query(
    `UPDATE event_fixtures SET team_a_name = $1, team_b_name = $2, division = $3,
            match_date = $4, match_time = $5, venue = $6, round = $7, duration = $8, reporting_time = $9
     WHERE id = $10
     RETURNING id, event_id, team_a_name, team_b_name, TO_CHAR(match_date, 'YYYY-MM-DD') AS match_date,
               match_time, reporting_time, venue, round, duration, division, score_a, score_b, winner_name`,
    [teamA, teamB, division, m.date, m.time, m.venue, m.round, m.duration, m.reportingTime, fixtureId]
  );
  await afterChange(f.event_id);
  return fixtureOut(row);
}

async function deleteFixture(umbrellaId, fixtureId, io) {
  const f = await fixtureOf(umbrellaId, fixtureId);
  if (f.is_live) throw new ScheduleError('This match is being played right now — remove it after it ends.', 409);
  await pgPool.query(`DELETE FROM event_fixtures WHERE id = $1`, [fixtureId]);
  /* its winner may already have moved on to a later round — take that back too */
  if (f.winner_name) {
    await bracketEngine.retractDownstream({ eventId: f.event_id, teamName: f.winner_name, division: f.division, io }).catch(() => {});
  }
  await afterChange(f.event_id);
}

module.exports = { ScheduleError, eventSchedule, setDeclared, addSession, updateSession, deleteSession, eventTeams, addFixture, updateFixture, deleteFixture };
