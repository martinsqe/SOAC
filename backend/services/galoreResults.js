/* Galore results — the winner (1st) and runner-up (2nd) of every activity, per
   division (Boys / Girls when the activity is split by gender), for every
   department. Each place is one entry from the activity's selected teams /
   duos / individuals (event_teams; an individual is a one-person entry).

   Where a place comes from:
     • set by hand (main Galore coordinator or admin, Results page) — always wins
     • otherwise the activity's final, once it has a winner: its winner is 1st
       and the other side 2nd — so results appear as soon as finals are played
   Clearing a hand-set place falls back to the final again. */
const { pgPool } = require('../config/db');

class ResultError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const ready = pgPool.query(`
  CREATE TABLE IF NOT EXISTS galore_results (
    id           BIGSERIAL   PRIMARY KEY,
    activity_id  BIGINT      NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    division     VARCHAR(10) NOT NULL DEFAULT 'boys',
    place        SMALLINT    NOT NULL CHECK (place IN (1, 2)),
    team_id      BIGINT      NOT NULL REFERENCES event_teams(id) ON DELETE CASCADE,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (activity_id, division, place)
  )
`).catch(err => { console.error('[galoreResults] table:', err.message); });

const isId = (v) => /^\d+$/.test(String(v ?? ''));
const isFinal = (round) => /^\s*(grand\s+)?finals?\s*$/i.test(String(round || ''));
const unitOf = (a) => {
  const size = Number(a.team_size || 0), min = Number(a.min_team_size || 0);
  return size <= 0 ? 'individual' : size === 2 && min === 2 ? 'duo' : 'team';
};

/* Everything the Results page needs for one Galore event:
     activities  in form order, each with its divisions, its entries to pick
                 from (per division) and its two places per division
     results     every filled place, flat — what the department tables show */
async function view(umbrellaId) {
  await ready;
  if (!isId(umbrellaId)) throw new ResultError('Galore event not found.', 404);
  const { rows: acts } = await pgPool.query(
    `SELECT a.id, a.title, a.team_size, a.min_team_size, a.gender_split, c.name AS category_name
     FROM events a LEFT JOIN galore_categories c ON c.id = a.galore_category_id
     WHERE a.parent_event_id = $1 AND a.is_active = true
     ORDER BY c.sort_order NULLS LAST, a.id`,
    [umbrellaId]
  );
  const ids = acts.map(a => a.id);
  if (!ids.length) return { activities: [], results: [] };
  const [{ rows: teams }, { rows: members }, { rows: saved }, { rows: finals }] = await Promise.all([
    pgPool.query(`SELECT id, event_id, name, division, dept FROM event_teams WHERE event_id = ANY($1::bigint[]) ORDER BY dept, name`, [ids]),
    pgPool.query(
      `SELECT m.team_id, m.member_name, m.enrollment_no, er.gender, er.course
       FROM event_team_members m JOIN event_teams t ON t.id = m.team_id
       LEFT JOIN event_registrations er ON er.id = m.registration_id
       WHERE t.event_id = ANY($1::bigint[]) ORDER BY m.id`, [ids]),
    pgPool.query(`SELECT activity_id, division, place, team_id FROM galore_results WHERE activity_id = ANY($1::bigint[])`, [ids]),
    pgPool.query(
      `SELECT event_id, division, round, team_a_name, team_b_name, winner_name FROM event_fixtures
       WHERE event_id = ANY($1::bigint[]) AND winner_name IS NOT NULL AND winner_name <> ''
       ORDER BY sort_order DESC, id DESC`, [ids]),
  ]);

  const membersOf = new Map();
  for (const m of members) {
    const k = String(m.team_id);
    if (!membersOf.has(k)) membersOf.set(k, []);
    membersOf.get(k).push({ name: m.member_name, enrollmentNo: m.enrollment_no || '', gender: m.gender || '', course: m.course || '' });
  }
  const entry = (t) => ({ id: String(t.id), name: t.name, dept: t.dept || '', division: t.division || 'boys', members: membersOf.get(String(t.id)) || [] });
  const teamById = new Map(teams.map(t => [String(t.id), t]));

  const activities = [];
  const results = [];
  for (const a of acts) {
    const split = !!a.gender_split;
    const divisions = split ? ['boys', 'girls'] : ['boys'];
    const own = teams.filter(t => String(t.event_id) === String(a.id));
    const out = {
      id: String(a.id), title: a.title, categoryName: a.category_name || '', unit: unitOf(a), genderSplit: split,
      divisions: divisions.map(div => {
        const pool = own.filter(t => !split || (t.division || 'boys') === div);
        const byName = new Map(pool.map(t => [t.name.trim().toLowerCase(), t]));
        /* the final (the latest fixture called "Final" with a winner) */
        const fin = finals.find(f => String(f.event_id) === String(a.id) && (!split || (f.division || 'boys') === div) && isFinal(f.round));
        const fromFinal = { 1: null, 2: null };
        if (fin) {
          const w = fin.winner_name.trim().toLowerCase();
          const other = [fin.team_a_name, fin.team_b_name].find(n => String(n || '').trim().toLowerCase() !== w);
          fromFinal[1] = byName.get(w) || null;
          fromFinal[2] = other ? byName.get(String(other).trim().toLowerCase()) || null : null;
        }
        const picked = [1, 2].map(place => {
          const s = saved.find(r => String(r.activity_id) === String(a.id) && (!split || r.division === div) && Number(r.place) === place);
          const t = s ? teamById.get(String(s.team_id)) : fromFinal[place];
          return { place, t: t || null, source: s && t ? 'set' : t ? 'final' : null };
        });
        /* one entry can't hold both places: a hand-set place beats the final's */
        if (picked[0].t && picked[1].t && String(picked[0].t.id) === String(picked[1].t.id)) {
          const drop = picked[1].source === 'final' ? picked[1] : picked[0];
          drop.t = null; drop.source = null;
        }
        const places = picked.map(({ place, t, source }) => {
          if (t) {
            results.push({
              activityId: String(a.id), activityTitle: a.title, categoryName: a.category_name || '', unit: unitOf(a),
              genderSplit: split, division: div, place, source, entry: entry(t),
            });
          }
          return { place, entry: t ? entry(t) : null, source };
        });
        return { division: div, places, entries: pool.map(entry) };
      }),
    };
    activities.push(out);
  }
  return { activities, results };
}

/* Set (or clear, teamId = null) one place of one activity's division */
async function setPlace(umbrellaId, { activityId, division, place, teamId } = {}) {
  await ready;
  if (!isId(umbrellaId) || !isId(activityId)) throw new ResultError('Activity not found.', 404);
  const p = Number(place);
  if (p !== 1 && p !== 2) throw new ResultError('Pick winner or runner-up.');
  const { rows: [a] } = await pgPool.query(
    `SELECT id, gender_split FROM events WHERE id = $1 AND parent_event_id = $2 AND is_active = true`, [activityId, umbrellaId]
  );
  if (!a) throw new ResultError('Activity not found.', 404);
  const div = a.gender_split && division === 'girls' ? 'girls' : 'boys';
  if (teamId == null || teamId === '') {
    await pgPool.query(`DELETE FROM galore_results WHERE activity_id = $1 AND division = $2 AND place = $3`, [a.id, div, p]);
    return { ok: true };
  }
  if (!isId(teamId)) throw new ResultError('That entry no longer exists.', 404);
  const { rows: [t] } = await pgPool.query(`SELECT id, division FROM event_teams WHERE id = $1 AND event_id = $2`, [teamId, a.id]);
  if (!t) throw new ResultError('That entry no longer exists — it may have been removed.', 404);
  if (a.gender_split && (t.division || 'boys') !== div) throw new ResultError(`That entry plays in ${t.division === 'girls' ? 'Girls' : 'Boys'}.`);
  const { rows: [other] } = await pgPool.query(
    `SELECT 1 FROM galore_results WHERE activity_id = $1 AND division = $2 AND place <> $3 AND team_id = $4`, [a.id, div, p, t.id]
  );
  if (other) throw new ResultError('The same entry can’t be both winner and runner-up.');
  await pgPool.query(
    `INSERT INTO galore_results (activity_id, division, place, team_id, updated_at) VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (activity_id, division, place) DO UPDATE SET team_id = EXCLUDED.team_id, updated_at = NOW()`,
    [a.id, div, p, t.id]
  );
  return { ok: true };
}

module.exports = { view, setPlace, ResultError };
