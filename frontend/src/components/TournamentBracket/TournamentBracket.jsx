/*
  TournamentBracket — SVG knockout bracket matching the sketch design.

  Layout:
    [Left arm: R bracket rounds] → [Left finalist TBD] 🏆 VS FINALS [Right finalist TBD] ← [Right arm: R bracket rounds]

  • No coloured centre box — trophy + VS + FINALS float in white space
  • Lines rendered first, rects on top, text last for clean z-order
  • Left arm groups occupy left side, right arm groups occupy right side
  • Short stub lines extend from the finalist slots toward the VS area
*/

const SH    = 26;     // slot height
const SW    = 110;    // slot width
const ST    = 16;     // horizontal stub (slot edge → vertical bar)
const GAP   = 8;      // gap between vertical bar and next slot
const RW    = SW + ST + GAP;  // per-round column width = 134
const FIN_W = 68;     // finals centre gap (trophy + VS + FINALS)
const UNIT  = 42;     // vertical px per seed slot
const LC    = '#c4c8d4';  // connector line colour

const ROUND_NAMES = ['Semi-finals', 'Quarter-finals', 'Round of 16', 'Round of 32', 'Round of 64'];

function nextPow2(n) { return Math.pow(2, Math.ceil(Math.log2(Math.max(n, 2)))); }
function roundLabel(fromFinal) { return ROUND_NAMES[fromFinal - 1] ?? `Round ${fromFinal}`; }

export default function TournamentBracket({ groups = [] }) {
  if (!groups.length) return null;

  /* ── Split groups into left / right arms ── */
  const half        = Math.ceil(groups.length / 2);
  const leftGroups  = groups.slice(0, half);
  const rightGroups = groups.slice(half);

  const toNames = (gs) => gs.flatMap(g => (g.teams || []).map(t => t.name || String(t)));
  const rawL    = toNames(leftGroups);
  const rawR    = toNames(rightGroups);

  const armSize = nextPow2(Math.max(rawL.length, rawR.length, 2));
  const pad     = (arr) => { const a = [...arr]; while (a.length < armSize) a.push(null); return a; };
  const lSeeds  = pad(rawL);
  const rSeeds  = pad(rawR);

  /* ── Dimensions ── */
  const R      = Math.log2(armSize);    // bracket rounds per arm
  const totalH = armSize * UNIT;
  const midY   = totalH / 2;
  const armW   = R * RW;                // bracket arm width (excl. finalist slot)

  // Finalist slot positions
  const lFinX  = armW;                  // left finalist: right edge of left arm
  const rFinX  = armW + SW + FIN_W;    // right finalist: left of right arm
  const totalW = rFinX + SW + armW;    // = armW*2 + SW*2 + FIN_W  (right arm occupies rightmost armW)

  // VS centre x
  const vsX = armW + SW + FIN_W / 2;

  // Where each arm's last midpoint line targets (the outer edge of its finalist slot)
  const cxL = lFinX;          // left arm → left edge of left finalist
  const cxR = rFinX + SW;     // right arm → right edge of right finalist

  /* ─────────────────────────────────────────────────
     Build lines / rects / labels for one bracket arm.
     mirror=true → right arm (slots grow from right inward)
  ──────────────────────────────────────────────────── */
  function buildArm(seeds, mirror) {
    const lines = [], rects = [], labels = [];

    for (let r = 0; r < R; r++) {
      const matchCount = Math.max(1, armSize / Math.pow(2, r + 1));
      const spanH      = Math.pow(2, r + 1) * UNIT;
      const isLast     = r === R - 1;

      const slotX   = mirror ? totalW - r * RW - SW : r * RW;
      const barX    = mirror ? slotX - ST : slotX + SW + ST;
      const slotEdge = mirror ? slotX : slotX + SW;   // side that connects outward

      for (let m = 0; m < matchCount; m++) {
        const base = m * spanH;
        const topY = base + spanH / 4;
        const botY = base + 3 * spanH / 4;
        const mY   = base + spanH / 2;

        const seed1 = r === 0 ? seeds[m * 2]     : null;
        const seed2 = r === 0 ? seeds[m * 2 + 1] : null;
        const bye1  = seed1 === null && r === 0;
        const bye2  = seed2 === null && r === 0;
        const tbd   = r > 0;

        /* Lines */
        lines.push(
          { x1: slotEdge, y1: topY, x2: barX, y2: topY },
          { x1: slotEdge, y1: botY, x2: barX, y2: botY },
          { x1: barX,     y1: topY, x2: barX, y2: botY },
        );
        // Midpoint line to next round or finalist slot
        const mt = isLast
          ? (mirror ? cxR : cxL)
          : (mirror ? barX - GAP : barX + GAP);
        lines.push({ x1: barX, y1: mY, x2: mt, y2: mY });

        /* Rects */
        const mkRect = (cy, bye) => ({
          x: slotX, y: cy - SH / 2, w: SW, h: SH, rx: 4,
          fill:   (bye || tbd) ? '#f8f9fc' : '#fff',
          stroke: bye ? '#edeef2' : '#d1d5db',
        });
        rects.push(mkRect(topY, bye1), mkRect(botY, bye2));

        /* Labels */
        const lbl = (seed, bye) => bye ? 'BYE' : (seed ?? (r === 0 ? '' : 'TBD'));
        labels.push(
          { x: slotX + 8, y: topY, text: lbl(seed1, bye1), bold: !!seed1, faint: bye1 || tbd },
          { x: slotX + 8, y: botY, text: lbl(seed2, bye2), bold: !!seed2, faint: bye2 || tbd },
        );
      }
    }
    return { lines, rects, labels };
  }

  const left  = buildArm(lSeeds, false);
  const right = buildArm(rSeeds, true);

  const lLabel = leftGroups.map(g => g.name).join(' · ');
  const rLabel = rightGroups.map(g => g.name).join(' · ');

  // Stub length from finalist slot toward VS (does not reach VS text)
  const VS_STUB = FIN_W / 2 - 12;

  const svgH = totalH + 36 + 18;

  return (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <svg
        width={totalW} height={svgH}
        viewBox={`0 0 ${totalW} ${svgH}`}
        style={{ display: 'block', margin: '0 auto', fontFamily: 'system-ui,sans-serif' }}>

        {/* Group arm labels */}
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

          {/* ── Phase 1: All connector lines (behind everything) ── */}
          {[...left.lines, ...right.lines].map((l, i) => (
            <line key={`ln${i}`}
              x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
              stroke={LC} strokeWidth={1.5} />
          ))}

          {/* Short stubs from finalist slots toward VS (connecting feel) */}
          <line x1={lFinX + SW}       y1={midY} x2={lFinX + SW + VS_STUB} y2={midY}
            stroke={LC} strokeWidth={1.5} />
          <line x1={rFinX - VS_STUB}  y1={midY} x2={rFinX}               y2={midY}
            stroke={LC} strokeWidth={1.5} />

          {/* ── Phase 2: Bracket slot rects (cover overlapping lines) ── */}
          {[...left.rects, ...right.rects].map((r, i) => (
            <rect key={`rc${i}`}
              x={r.x} y={r.y} width={r.w} height={r.h} rx={r.rx}
              fill={r.fill} stroke={r.stroke} strokeWidth={1.5} />
          ))}

          {/* Finalist slots (TBD, centered vertically) */}
          <rect x={lFinX} y={midY - SH / 2} width={SW} height={SH} rx={4}
            fill="#f0f4ff" stroke="#a5b4fc" strokeWidth={1.5} />
          <rect x={rFinX} y={midY - SH / 2} width={SW} height={SH} rx={4}
            fill="#f0f4ff" stroke="#a5b4fc" strokeWidth={1.5} />

          {/* ── Phase 3: Text (topmost layer) ── */}
          {[...left.labels, ...right.labels].map((l, i) => (
            <text key={`tx${i}`}
              x={l.x} y={l.y}
              dominantBaseline="middle"
              fontSize={11} fontWeight={l.bold ? '600' : '400'}
              fill={l.faint ? '#9ca3af' : '#1f2937'}>
              {l.text}
            </text>
          ))}

          {/* Finalist TBD labels */}
          <text x={lFinX + 8} y={midY} dominantBaseline="middle"
            fontSize={11} fill="#818cf8" fontWeight="500">TBD</text>
          <text x={rFinX + 8} y={midY} dominantBaseline="middle"
            fontSize={11} fill="#818cf8" fontWeight="500">TBD</text>

          {/* ── Finals centre: trophy + VS + FINALS ── */}
          {/* Trophy above */}
          <text x={vsX} y={midY - 20}
            textAnchor="middle" dominantBaseline="middle" fontSize={22}>🏆</text>
          {/* VS */}
          <text x={vsX} y={midY + 2}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={14} fontWeight="900" fill="#111827">
            VS
          </text>
          {/* FINALS */}
          <text x={vsX} y={midY + 18}
            textAnchor="middle"
            fontSize={8} fontWeight="700" fill="#9ca3af" letterSpacing="0.12em">
            FINALS
          </text>

          {/* ── Round labels at bottom ── */}
          {Array.from({ length: R }, (_, r) => {
            const label = roundLabel(R - r);
            const lx = r * RW + SW / 2;
            const rx = totalW - r * RW - SW / 2;
            const y  = totalH + 20;
            return (
              <g key={`rl${r}`}>
                <text x={lx} y={y} textAnchor="middle"
                  fontSize={9} fontWeight="600" fill="#9ca3af">{label}</text>
                <text x={rx} y={y} textAnchor="middle"
                  fontSize={9} fontWeight="600" fill="#9ca3af">{label}</text>
              </g>
            );
          })}
          {/* "Final" label in centre */}
          <text x={vsX} y={totalH + 20} textAnchor="middle"
            fontSize={9} fontWeight="700" fill="#818cf8">Final</text>

        </g>
      </svg>
    </div>
  );
}
