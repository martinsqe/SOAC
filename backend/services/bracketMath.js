/*
  bracketMath — pure bracket-structure logic, shared by bracketEngine.js (DB
  orchestration: creating fixtures/scoreboards) and reports.controller.js (resolving
  the true tournament champion for the report). Kept dependency-free (no DB, no
  requires on other controllers) specifically so both of those can depend on it
  without creating a require cycle between them.

  Mirrors frontend/src/components/TournamentBracket/TournamentBracket.jsx 1:1 —
  keep both in sync.
*/

const SUPPORTED_SPORTS = new Set(['cricket', 'basketball', 'football', 'volleyball', 'badminton']);
const DEFAULT_TIMER_SECONDS = {
  cricket: 120 * 60,
  basketball: 40 * 60,
  football: 90 * 60,
  volleyball: 90 * 60,
  badminton: 60 * 60,
};

const ROUND_NAMES = ['Semi-finals', 'Quarter-finals', 'Round of 16', 'Round of 32', 'Round of 64'];
const roundLabel  = (fromFinal) => ROUND_NAMES[fromFinal - 1] ?? `Round ${fromFinal}`;
const nextPow2    = (n) => Math.pow(2, Math.ceil(Math.log2(Math.max(n, 2))));
const IS_BYE_STR  = (s) => typeof s === 'string' && s.trim().toUpperCase() === 'BYE';

const detectSport = (title) => {
  const t = (title || '').toLowerCase();
  if (t.includes('basketball'))  return 'basketball';
  if (t.includes('football') || t.includes('soccer')) return 'football';
  if (t.includes('cricket'))     return 'cricket';
  if (t.includes('badminton'))   return 'badminton';
  if (t.includes('volleyball'))  return 'volleyball';
  if (t.includes('kabaddi'))     return 'kabaddi';
  return 'general';
};

/* Ported 1:1 from frontend/src/components/TournamentBracket/TournamentBracket.jsx — keep in sync. */
function computeRounds(seeds, winnerOf) {
  let isByeSlot = seeds.map(s => s === null || IS_BYE_STR(s));
  let current   = seeds;
  const rounds  = [seeds];

  while (current.length > 1) {
    const next      = [];
    const nextIsBye = [];

    for (let i = 0; i < current.length; i += 2) {
      const a      = current[i];
      const b      = current[i + 1];
      const aIsBye = isByeSlot[i];
      const bIsBye = isByeSlot[i + 1];

      if (!a && !b) { next.push(null); nextIsBye.push(aIsBye && bIsBye); continue; }

      if ((!b || IS_BYE_STR(b)) && bIsBye) {
        const rec = a && b ? winnerOf[`${a}|${b}`] || winnerOf[`${b}|${a}`] : null;
        next.push(rec || a); nextIsBye.push(false); continue;
      }
      if ((!a || IS_BYE_STR(a)) && aIsBye) {
        const rec = a && b ? winnerOf[`${a}|${b}`] || winnerOf[`${b}|${a}`] : null;
        next.push(rec || b); nextIsBye.push(false); continue;
      }

      if (!a || !b) { next.push(null); nextIsBye.push(false); continue; }

      const w = winnerOf[`${a}|${b}`] || winnerOf[`${b}|${a}`] || null;
      next.push(w); nextIsBye.push(false);
    }

    current   = next;
    isByeSlot = nextIsBye;
    rounds.push(current);
  }
  return rounds;
}

/* Splits groups into two whole-group arms that only converge at the championship
   Final (arms never share a group, so a team never "moves" between them). With
   exactly one group, that group's own teams are split in half so both arms are
   populated. Mirrors TournamentBracket.jsx's identical helper 1:1. */
function armLayout(groups, fixtures) {
  let effectiveGroups = groups;
  if (!effectiveGroups.length && fixtures.length) {
    const seen = new Set();
    const teams = [];
    fixtures.forEach(f => {
      if (f.teamA && !seen.has(f.teamA)) { seen.add(f.teamA); teams.push({ id: f.teamA, name: f.teamA }); }
      if (f.teamB && !seen.has(f.teamB)) { seen.add(f.teamB); teams.push({ id: f.teamB, name: f.teamB }); }
    });
    if (teams.length) effectiveGroups = [{ id: 'auto', name: '', sortOrder: 0, teams }];
  }
  if (!effectiveGroups.length) return null;

  let leftGroups, rightGroups;
  if (effectiveGroups.length === 1) {
    const allTeams = effectiveGroups[0].teams || [];
    const mid = Math.ceil(allTeams.length / 2);
    leftGroups  = [{ ...effectiveGroups[0], teams: allTeams.slice(0, mid) }];
    rightGroups = allTeams.length > 1 ? [{ ...effectiveGroups[0], name: '', teams: allTeams.slice(mid) }] : [];
  } else {
    const half  = Math.ceil(effectiveGroups.length / 2);
    leftGroups  = effectiveGroups.slice(0, half);
    rightGroups = effectiveGroups.slice(half);
  }

  const toNames = (gs) => gs.flatMap(g => (g.teams || []).map(t => t.name || String(t)));
  const rawL = toNames(leftGroups);
  const rawR = toNames(rightGroups);
  if (rawL.length + rawR.length < 2) return null;

  const armSize = nextPow2(Math.max(rawL.length, rawR.length, 2));
  const pad     = (arr) => { const a = [...arr]; while (a.length < armSize) a.push(null); return a; };
  return { armSize, lSeeds: pad(rawL), rSeeds: pad(rawR), hasFinal: rawR.length > 0 };
}

/* How many later-round "Stage Schedule" entries a coordinator should fill in for
   this bracket — Round 1 itself is manually declared and excluded, and the very
   last one (only reached once both arms have a finalist) is always "Final". */
function getStageLabels(groups) {
  const layout = armLayout(groups, []);
  if (!layout) return [];
  const { armSize, hasFinal } = layout;
  const R = Math.log2(armSize);
  const labels = [];
  for (let r = 1; r < R; r++) labels.push(roundLabel(R - r));
  if (hasFinal) labels.push('Final');
  return labels;
}

/* Which next-round matchups are now fully resolved but have no fixture row yet. */
function getPendingAdvancements(groups, fixtures) {
  const layout = armLayout(groups, fixtures);
  if (!layout) return [];
  const { armSize, lSeeds, rSeeds, hasFinal } = layout;

  const winnerOf = {};
  fixtures.forEach(f => {
    if (f.winner) {
      winnerOf[`${f.teamA}|${f.teamB}`] = f.winner;
      winnerOf[`${f.teamB}|${f.teamA}`] = f.winner;
    }
  });

  const lRounds = computeRounds(lSeeds, winnerOf);
  const rRounds = computeRounds(rSeeds, winnerOf);
  const R = Math.log2(armSize);

  const existingPairs = new Set();
  fixtures.forEach(f => {
    if (f.teamA && f.teamB) {
      existingPairs.add(`${f.teamA}|${f.teamB}`);
      existingPairs.add(`${f.teamB}|${f.teamA}`);
    }
  });

  const pending = [];
  const consider = (a, b, label) => {
    if (!a || !b || a === b) return;
    if (IS_BYE_STR(a) || IS_BYE_STR(b)) return;
    if (existingPairs.has(`${a}|${b}`)) return;
    pending.push({ label, teamA: a, teamB: b });
    existingPairs.add(`${a}|${b}`);
    existingPairs.add(`${b}|${a}`);
  };

  const collectArm = (rounds) => {
    for (let r = 1; r < R; r++) {
      const cur = rounds[r] || [];
      for (let i = 0; i < cur.length; i += 2) consider(cur[i], cur[i + 1], roundLabel(R - r));
    }
  };
  collectArm(lRounds);
  collectArm(rRounds);

  if (hasFinal) {
    const lFinalist = lRounds[R]?.[0] || null;
    const rFinalist = rRounds[R]?.[0] || null;
    consider(lFinalist, rFinalist, 'Final');
  }

  return pending;
}

/* Resolves the actual tournament champion from bracket structure alone — never
   guesses from a fixture's free-text `round` label (coordinators can type anything
   for Round 1, e.g. "qtr-finals", which a naive "contains final" text match would
   wrongly mistake for the championship). Returns { name, opponent } for the two
   arm-finalists' head-to-head result, or null if the final hasn't been played yet. */
function getChampion(groups, fixtures) {
  const layout = armLayout(groups, fixtures);
  if (!layout || !layout.hasFinal) return null;
  const { armSize, lSeeds, rSeeds } = layout;

  const winnerOf = {};
  fixtures.forEach(f => {
    if (f.winner) {
      winnerOf[`${f.teamA}|${f.teamB}`] = f.winner;
      winnerOf[`${f.teamB}|${f.teamA}`] = f.winner;
    }
  });

  const R = Math.log2(armSize);
  const lFinalist = computeRounds(lSeeds, winnerOf)[R]?.[0] || null;
  const rFinalist = computeRounds(rSeeds, winnerOf)[R]?.[0] || null;
  if (!lFinalist || !rFinalist) return null;

  const champion = winnerOf[`${lFinalist}|${rFinalist}`] || winnerOf[`${rFinalist}|${lFinalist}`] || null;
  if (!champion) return null;
  return { name: champion, opponent: champion === lFinalist ? rFinalist : lFinalist };
}

module.exports = {
  SUPPORTED_SPORTS, DEFAULT_TIMER_SECONDS,
  detectSport, computeRounds, armLayout,
  getStageLabels, getPendingAdvancements, getChampion,
};
