/*
  bracketEngine — DB orchestration around bracketMath's pure advancement logic.

  Whenever a fixture result is recorded (static entry or Match Control "End Game"),
  advanceBracket() figures out which next-round matchups are now fully resolved
  (both sides are real teams, per the exact same seeding/arm-split logic the bracket
  preview already uses) and materializes them as real event_fixtures rows — plus a
  draft Match Control scoreboard when the sport supports it — so a coordinator never
  has to re-type a winning team into a later round.

  retractDownstream() is the inverse: if a scoreboard/result is deleted, any
  auto-generated next-round fixture that only existed because of that winner (and
  hasn't itself been played yet) is removed again.
*/
const { pgPool }          = require('../config/db');
const { fetchGroups }     = require('../controllers/eventGroups.controller');
const { autoRefreshReportIfExists } = require('../controllers/reports.controller');
const bracketMath = require('./bracketMath');
const { SUPPORTED_SPORTS, DEFAULT_TIMER_SECONDS, detectSport, getPendingAdvancements } = bracketMath;

async function getTeamRoster(client, eventId, teamName) {
  if (!teamName) return [];
  const { rows } = await client.query(
    `SELECT tm.member_name, tm.enrollment_no
     FROM event_teams t
     JOIN event_team_members tm ON tm.team_id = t.id
     WHERE t.event_id = $1 AND t.name = $2
     ORDER BY tm.id ASC`,
    [eventId, teamName]
  );
  return rows.map(r => ({ name: r.member_name, enrollmentNo: r.enrollment_no || '' }));
}

/* Compute + persist any newly-resolved next-round matchups for an event. Safe to call
   after every result recorded — it's a no-op once nothing new is pending. */
async function advanceBracket({ eventId, io }) {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bracket:${eventId}`]);

    const { rows: evRows } = await client.query(
      `SELECT e.id, e.title, e.venue, e.club_id, c.category AS club_category
       FROM events e LEFT JOIN clubs c ON c.id = e.club_id
       WHERE e.id = $1::bigint`,
      [eventId]
    );
    if (!evRows.length) { await client.query('ROLLBACK'); return; }
    const ev = evRows[0];

    const groups = await fetchGroups(eventId);
    const { rows: fixtures } = await client.query(
      `SELECT id, team_a_name AS "teamA", team_b_name AS "teamB", winner_name AS winner
       FROM event_fixtures WHERE event_id = $1::bigint`,
      [eventId]
    );

    const pending = getPendingAdvancements(groups, fixtures);
    if (!pending.length) {
      await client.query('COMMIT');
      autoRefreshReportIfExists(eventId).catch(() => {});
      return;
    }

    const { rows: stageRows } = await client.query(
      `SELECT round_label, TO_CHAR(match_date, 'YYYY-MM-DD') AS match_date, match_time, venue
       FROM event_stage_schedule WHERE event_id = $1::bigint`,
      [eventId]
    );
    const stageByLabel = {};
    stageRows.forEach(s => { stageByLabel[s.round_label] = s; });

    const { rows: maxRows } = await client.query(
      `SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM event_fixtures WHERE event_id = $1::bigint`,
      [eventId]
    );
    let nextSortOrder = Number(maxRows[0].max_order) + 1;

    const sport         = detectSport(ev.title);
    const canScoreboard = ev.club_category === 'sports' && SUPPORTED_SPORTS.has(sport);

    for (const p of pending) {
      const stage = stageByLabel[p.label] || {};
      const venue = stage.venue || ev.venue || '';
      const { rows: fxRows } = await client.query(
        `INSERT INTO event_fixtures
           (event_id, team_a_name, team_b_name, match_date, match_time, venue, round, sort_order, auto_generated)
         VALUES ($1::bigint,$2,$3,$4,$5,$6,$7,$8,true)
         RETURNING id`,
        [eventId, p.teamA, p.teamB, stage.match_date || null, stage.match_time || null, venue, p.label, nextSortOrder++]
      );
      const fixtureId = fxRows[0].id;

      if (canScoreboard) {
        const [homePlayers, awayPlayers] = await Promise.all([
          getTeamRoster(client, eventId, p.teamA),
          getTeamRoster(client, eventId, p.teamB),
        ]);
        const title = [ev.title, p.label].filter(Boolean).join(' – ') + `: ${p.teamA} vs ${p.teamB}`;
        await client.query(
          `INSERT INTO club_live_scores
             (club_id, sport, match_title, home_team, opponent_name, venue,
              home_players, away_players, time_remaining_seconds, status, fixture_id, event_id)
           VALUES ($1::bigint,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,'draft',$10,$11::bigint)`,
          [
            ev.club_id, sport, title, p.teamA, p.teamB, venue,
            JSON.stringify(homePlayers), JSON.stringify(awayPlayers),
            DEFAULT_TIMER_SECONDS[sport] || 0,
            fixtureId, eventId,
          ]
        );
      }
    }

    await client.query('COMMIT');
    if (io) io.emit('bracket:advanced', { eventId: String(eventId) });
    autoRefreshReportIfExists(eventId).catch(() => {});
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[bracketEngine] advanceBracket error:', err.message);
  } finally {
    client.release();
  }
}

/* Undo advancement: remove any not-yet-played auto-generated fixture (+ its draft
   scoreboard) that depended on `teamName` having won its match. */
async function retractDownstream({ eventId, teamName, io }) {
  if (!teamName) return;
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`bracket:${eventId}`]);

    const { rows: fxRows } = await client.query(
      `SELECT id FROM event_fixtures
       WHERE event_id = $1::bigint AND auto_generated = true AND winner_name IS NULL
         AND (team_a_name = $2 OR team_b_name = $2)`,
      [eventId, teamName]
    );
    if (!fxRows.length) { await client.query('ROLLBACK'); return; }
    const fixtureIds = fxRows.map(r => r.id);

    const { rows: scoreRows } = await client.query(
      `SELECT id FROM club_live_scores WHERE fixture_id = ANY($1::bigint[]) AND status = 'draft'`,
      [fixtureIds]
    );
    const scoreIds = scoreRows.map(r => r.id);
    if (scoreIds.length) {
      await client.query(`DELETE FROM match_mvp WHERE score_id = ANY($1::bigint[])`, [scoreIds]);
      await client.query(`DELETE FROM club_live_scores WHERE id = ANY($1::bigint[])`, [scoreIds]);
    }
    await client.query(`DELETE FROM event_fixtures WHERE id = ANY($1::bigint[])`, [fixtureIds]);

    await client.query('COMMIT');
    if (io) io.emit('bracket:advanced', { eventId: String(eventId) });
    autoRefreshReportIfExists(eventId).catch(() => {});
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[bracketEngine] retractDownstream error:', err.message);
  } finally {
    client.release();
  }
}

module.exports = { advanceBracket, retractDownstream, ...bracketMath };
