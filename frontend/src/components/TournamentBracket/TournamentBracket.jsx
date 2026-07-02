/*
  TournamentBracket — SVG knockout bracket with live result advancement.

  Layout:
    [Left arm: R bracket rounds] → [Left finalist TBD] 🏆 VS FINALS [Right finalist TBD] ← [Right arm: R bracket rounds]

  • fixtures prop: flat array from event_fixtures (with scoreA, scoreB, winner)
  • Winners auto-advance through rounds as results are recorded
*/

const SH    = 26;
const SW    = 110;
const ST    = 16;
const GAP   = 8;
const RW    = SW + ST + GAP;
const FIN_W = 68;
const UNIT  = 42;
const LC    = '#c4c8d4';

const ROUND_NAMES = ['Semi-finals', 'Quarter-finals', 'Round of 16', 'Round of 32', 'Round of 64'];

function nextPow2(n) { return Math.pow(2, Math.ceil(Math.log2(Math.max(n, 2)))); }
function roundLabel(fromFinal) { return ROUND_NAMES[fromFinal - 1] ?? `Round ${fromFinal}`; }

/* Given seeds (some null = BYE) and a winner lookup, simulate bracket advancement.
   Returns an array of rounds: rounds[0] = seeds, rounds[1] = round-1 winners, etc. */
function computeRounds(seeds, winnerOf) {
  const rounds = [seeds];
  let current = seeds;
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      const a = current[i];
      const b = current[i + 1];
      if (!a && !b) { next.push(null); continue; }
      if (!b) { next.push(a); continue; }   // bye — a advances
      if (!a) { next.push(b); continue; }   // bye — b advances
      const w = winnerOf[`${a}|${b}`] || winnerOf[`${b}|${a}`] || null;
      next.push(w);
    }
    current = next;
    rounds.push(current);
  }
  return rounds;
}

export default function TournamentBracket({ groups = [], fixtures = [] }) {
  if (!groups.length) return null;

  /* Build winner lookup from recorded fixture results */
  const winnerOf = {};
  fixtures.forEach(f => {
    if (f.winner) {
      winnerOf[`${f.teamA}|${f.teamB}`] = f.winner;
      winnerOf[`${f.teamB}|${f.teamA}`] = f.winner;
    }
  });

  /* Split groups into left / right arms.
     With 1 group: split that group's teams evenly so both arms are populated. */
  let leftGroups, rightGroups;
  if (groups.length === 1) {
    const allTeams = groups[0].teams || [];
    const mid      = Math.ceil(allTeams.length / 2);
    leftGroups  = [{ ...groups[0], teams: allTeams.slice(0, mid) }];
    rightGroups = allTeams.length > 1 ? [{ ...groups[0], name: '', teams: allTeams.slice(mid) }] : [];
  } else {
    const half  = Math.ceil(groups.length / 2);
    leftGroups  = groups.slice(0, half);
    rightGroups = groups.slice(half);
  }

  const toNames = (gs) => gs.flatMap(g => (g.teams || []).map(t => t.name || String(t)));
  const rawL    = toNames(leftGroups);
  const rawR    = toNames(rightGroups);

  const armSize = nextPow2(Math.max(rawL.length, rawR.length, 2));
  const pad     = (arr) => { const a = [...arr]; while (a.length < armSize) a.push(null); return a; };
  const lSeeds  = pad(rawL);
  const rSeeds  = pad(rawR);

  /* Pre-compute all advancement rounds for each arm */
  const lRounds = computeRounds(lSeeds, winnerOf);
  const rRounds = computeRounds(rSeeds, winnerOf);

  /* Dimensions */
  const R      = Math.log2(armSize);
  const totalH = armSize * UNIT;
  const midY   = totalH / 2;
  const armW   = R * RW;

  const lFinX  = armW;
  const rFinX  = armW + SW + FIN_W;
  const totalW = rFinX + SW + armW;
  const vsX    = armW + SW + FIN_W / 2;
  const cxL    = lFinX;
  const cxR    = rFinX + SW;

  const lFinalist = lRounds[R]?.[0] || null;
  const rFinalist = rRounds[R]?.[0] || null;

  function buildArm(rounds, mirror) {
    const lines = [], rects = [], labels = [];

    for (let r = 0; r < R; r++) {
      const matchCount = Math.max(1, armSize / Math.pow(2, r + 1));
      const spanH      = Math.pow(2, r + 1) * UNIT;
      const isLast     = r === R - 1;

      const slotX    = mirror ? totalW - r * RW - SW : r * RW;
      const barX     = mirror ? slotX - ST : slotX + SW + ST;
      const slotEdge = mirror ? slotX : slotX + SW;

      for (let m = 0; m < matchCount; m++) {
        const base = m * spanH;
        const topY = base + spanH / 4;
        const botY = base + 3 * spanH / 4;
        const mY   = base + spanH / 2;

        const seed1 = rounds[r]?.[m * 2]     ?? null;
        const seed2 = rounds[r]?.[m * 2 + 1] ?? null;
        const bye1  = r === 0 && seed1 === null;
        const bye2  = r === 0 && seed2 === null;
        const tbd1  = r > 0  && seed1 === null;
        const tbd2  = r > 0  && seed2 === null;

        lines.push(
          { x1: slotEdge, y1: topY, x2: barX, y2: topY },
          { x1: slotEdge, y1: botY, x2: barX, y2: botY },
          { x1: barX,     y1: topY, x2: barX, y2: botY },
        );
        const mt = isLast
          ? (mirror ? cxR : cxL)
          : (mirror ? barX - GAP : barX + GAP);
        lines.push({ x1: barX, y1: mY, x2: mt, y2: mY });

        const mkRect = (bye, tbd) => ({
          fill:   (bye || tbd) ? '#f8f9fc' : '#fff',
          stroke: bye ? '#edeef2' : '#d1d5db',
        });
        rects.push(
          { x: slotX, y: topY - SH / 2, w: SW, h: SH, rx: 4, ...mkRect(bye1, tbd1) },
          { x: slotX, y: botY - SH / 2, w: SW, h: SH, rx: 4, ...mkRect(bye2, tbd2) },
        );

        const lbl = (seed, bye, tbd) => bye ? 'BYE' : tbd ? 'TBD' : (seed || '');
        labels.push(
          { x: slotX + 8, y: topY, text: lbl(seed1, bye1, tbd1), bold: !!(seed1 && !bye1), faint: bye1 || tbd1 },
          { x: slotX + 8, y: botY, text: lbl(seed2, bye2, tbd2), bold: !!(seed2 && !bye2), faint: bye2 || tbd2 },
        );
      }
    }
    return { lines, rects, labels };
  }

  const left  = buildArm(lRounds, false);
  const right = buildArm(rRounds, true);

  const lLabel = leftGroups.map(g => g.name).join(' · ');
  const rLabel = rightGroups.map(g => g.name).join(' · ');

  const VS_STUB = FIN_W / 2 - 12;
  const svgH    = totalH + 36 + 18;

  return (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <svg
        width={totalW} height={svgH}
        viewBox={`0 0 ${totalW} ${svgH}`}
        style={{ display: 'block', margin: '0 auto', fontFamily: 'system-ui,sans-serif' }}>

        <text x={armW / 2} y={13} textAnchor="middle"
          fontSize={10} fontWeight="700" fill="#6b7280" letterSpacing="0.06em">
          {lLabel.toUpperCase()}
        </text>
        {rLabel && (
          <text x={totalW - armW / 2} y={13} textAnchor="middle"
            fontSize={10} fontWeight="700" fill="#6b7280" letterSpacing="0.06em">
            {rLabel.toUpperCase()}
          </text>
        )}

        <g transform="translate(0,18)">

          {[...left.lines, ...right.lines].map((l, i) => (
            <line key={`ln${i}`}
              x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
              stroke={LC} strokeWidth={1.5} />
          ))}

          <line x1={lFinX + SW}      y1={midY} x2={lFinX + SW + VS_STUB} y2={midY} stroke={LC} strokeWidth={1.5} />
          <line x1={rFinX - VS_STUB} y1={midY} x2={rFinX}                y2={midY} stroke={LC} strokeWidth={1.5} />

          {[...left.rects, ...right.rects].map((r, i) => (
            <rect key={`rc${i}`}
              x={r.x} y={r.y} width={r.w} height={r.h} rx={r.rx}
              fill={r.fill} stroke={r.stroke} strokeWidth={1.5} />
          ))}

          {/* Finalist slots */}
          <rect x={lFinX} y={midY - SH / 2} width={SW} height={SH} rx={4}
            fill={lFinalist ? '#ecfdf5' : '#f0f4ff'} stroke={lFinalist ? '#6ee7b7' : '#a5b4fc'} strokeWidth={1.5} />
          <rect x={rFinX} y={midY - SH / 2} width={SW} height={SH} rx={4}
            fill={rFinalist ? '#ecfdf5' : '#f0f4ff'} stroke={rFinalist ? '#6ee7b7' : '#a5b4fc'} strokeWidth={1.5} />

          {[...left.labels, ...right.labels].map((l, i) => (
            <text key={`tx${i}`}
              x={l.x} y={l.y}
              dominantBaseline="middle"
              fontSize={11} fontWeight={l.bold ? '600' : '400'}
              fill={l.faint ? '#9ca3af' : '#1f2937'}>
              {l.text}
            </text>
          ))}

          <text x={lFinX + 8} y={midY} dominantBaseline="middle"
            fontSize={11} fill={lFinalist ? '#059669' : '#818cf8'} fontWeight="600">
            {lFinalist || 'TBD'}
          </text>
          <text x={rFinX + 8} y={midY} dominantBaseline="middle"
            fontSize={11} fill={rFinalist ? '#059669' : '#818cf8'} fontWeight="600">
            {rFinalist || 'TBD'}
          </text>

          <text x={vsX} y={midY - 20} textAnchor="middle" dominantBaseline="middle" fontSize={22}>🏆</text>
          <text x={vsX} y={midY + 2}  textAnchor="middle" dominantBaseline="middle"
            fontSize={14} fontWeight="900" fill="#111827">VS</text>
          <text x={vsX} y={midY + 18} textAnchor="middle"
            fontSize={8} fontWeight="700" fill="#9ca3af" letterSpacing="0.12em">FINALS</text>

          {Array.from({ length: R }, (_, r) => {
            const label = roundLabel(R - r);
            const lx = r * RW + SW / 2;
            const rx = totalW - r * RW - SW / 2;
            const y  = totalH + 20;
            return (
              <g key={`rl${r}`}>
                <text x={lx} y={y} textAnchor="middle" fontSize={9} fontWeight="600" fill="#9ca3af">{label}</text>
                <text x={rx} y={y} textAnchor="middle" fontSize={9} fontWeight="600" fill="#9ca3af">{label}</text>
              </g>
            );
          })}
          <text x={vsX} y={totalH + 20} textAnchor="middle"
            fontSize={9} fontWeight="700" fill="#818cf8">Final</text>

        </g>
      </svg>
    </div>
  );
}
