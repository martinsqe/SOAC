import TournamentBracket from '../TournamentBracket/TournamentBracket';
import { SUPPORTING_DOCS } from './reportConstants';
import { Linkified, Row } from './ReportChrome';
import r from '../../pages/Coordinator/CoordReports.module.css';
import d from './EventReportDocument.module.css';

/* The finished report as a list of A4 page blocks (see PagedA4) — shared by the
   Reports pages and the editor's preview. Tables are one block per row so they
   flow across pages; sports sections are kept exactly as before. */

const DIVISIONS = ['boys', 'girls'];
const DIVISION_LABEL = { boys: 'Boys', girls: 'Girls' };

const orNA = (v) => (v === undefined || v === null || String(v).trim() === '' ? 'N.A.' : v);

/* The report as a list of page blocks (also used by the editor's preview) */
export function reportBlocks(data, { isSports: isSportsProp } = {}) {
  const mvpCardRef = undefined; // the lifted MVP card markup expects this name
  const nav = data.narrative || {};
  const isSports = isSportsProp ?? data.is_sports ?? data.event_category === 'sports';
  const volunteers = Array.isArray(nav.volunteers) ? nav.volunteers.filter(v => v?.name) : [];
  const docs = nav.supporting_docs || {};
  const signatories = (Array.isArray(nav.signatories) ? nav.signatories : []).filter(sg => sg?.name);
  const photos = [...(data.photos || []), ...(data.highlight_photos || [])].filter(Boolean).slice(0, 6); // up to 6, 2 per row
  const participantsCount = nav.participants_count || data.summary_stats?.totalParticipants || data.participants?.length || '';
  const volunteersCount = nav.volunteers_count || (volunteers.length ? String(volunteers.length) : '');

  /* per-player stat totals from match_mvps */
  const statMap = {};
  (data.match_mvps || []).forEach(m => {
    if (!m.player_name) return;
    const k = m.player_name.trim().toLowerCase();
    if (!statMap[k]) statMap[k] = { PTS: 0, AST: 0, REB: 0, STL: 0 };
    statMap[k].PTS += Number(m.stats?.PTS ?? 0);
    statMap[k].AST += Number(m.stats?.AST ?? 0);
    statMap[k].REB += Number(m.stats?.REB ?? 0);
    statMap[k].STL += Number(m.stats?.STL ?? 0);
  });
  /* One column per extra registration question the admin added to this event */
  const qCols = [];
  (data.participants || []).forEach(p => (p.extra_answers || []).forEach(a => {
    if (!qCols.some(c => c.id === a.id)) qCols.push({ id: a.id, label: a.label });
  }));
  const answerOf = (p, id) => (p.extra_answers || []).find(a => a.id === id)?.value || '—';

  const blocks = [];
  const add = (key, node, opts = {}) => blocks.push({ key, node, ...opts });
  const TWO = ['42%', '58%'];
  const FOCUS = ['26%', '74%'];

  add('title', <div className={d.title}>Post-Event Summary Report</div>);

  /* ── Event details ── */
  add('ed-head', <Row cols={['100%']} first><tr><th className={d.tableHead}>Event Details</th></tr></Row>);
  [
    ['Event Name', nav.event_name || data.event_title, true],
    ['Association or collaboration agencies', nav.association, true],
    ['Event Date', nav.event_date, true],
    ['Event Place', nav.event_place || data.summary_stats?.venue, true],
    ['Number of Participants', participantsCount, true],
    ['Number of Volunteers', volunteersCount, true],
    ['Objective of the Event', nav.objective, false],
    ['Academic Year', nav.academic_year || data.academic_year, true],
  ].forEach(([label, value, centered], i) => add(`ed-${i}`, (
    <Row cols={TWO}><tr><td className={d.label}>{label}</td><td className={centered ? d.valueCenter : d.value}>{orNA(value)}</td></tr></Row>
  )));
  add('ed-gap', <div className={d.spacer} />);

  /* ── Focus areas ── */
  add('fa-head', <Row cols={FOCUS} first><tr><th className={d.tableHead}>Focus areas</th><th className={d.tableHead}>Description</th></tr></Row>);
  [
    ['Key Highlights', nav.key_highlights],
    ['Outcomes:', nav.outcome],
    ['Acknowledgments:', nav.acknowledgments],
    ...(nav.remarks?.trim() ? [['Remarks:', nav.remarks]] : []),
  ].forEach(([label, value], i) => add(`fa-${i}`, (
    <Row cols={FOCUS}><tr><td className={d.focusLabel}>{label}</td><td className={d.value}>{orNA(value)}</td></tr></Row>
  )));
  add('fa-gap', <div className={d.spacer} />);

  /* ── Volunteers (names, when added) ── */
  if (volunteers.length) {
    const VC = ['9%', '30%', '19%', '18%', '24%'];
    add('vol-head', <Row cols={['100%']} first><tr><th className={d.tableHead}>List of Volunteers</th></tr></Row>);
    add('vol-cols', <Row cols={VC}><tr><th className={d.srCol}>Sr. No.</th><th>Name</th><th>Enrollment No.</th><th>Department</th><th>Role</th></tr></Row>);
    volunteers.forEach((v, i) => add(`vol-${i}`, (
      <Row cols={VC}><tr><td className={d.srCol}>{i + 1}</td><td>{v.name}</td><td>{v.enrollment || '—'}</td><td>{v.dept || '—'}</td><td>{v.role || '—'}</td></tr></Row>
    )));
    add('vol-gap', <div className={d.spacer} />);
  }

  /* ── Participants (SOAC registrations) ── */
  if (data.participants?.length) {
    const statCols = isSports ? ['PTS', 'AST', 'REB', 'STL'] : [];
    const n = 6 + qCols.length + statCols.length;
    const PC = ['6%', ...Array(n - 1).fill(`${(94 / (n - 1)).toFixed(2)}%`)];
    add('p-head', <Row cols={['100%']} first><tr><th className={d.tableHead}>List of Participants ({data.participants.length})</th></tr></Row>);
    add('p-cols', (
      <Row cols={PC}><tr>
        <th className={d.srCol}>#</th><th>Name</th><th>Enrollment</th><th>Gender</th><th>Dept</th><th>Course</th>
        {qCols.map(c => <th key={c.id} style={{ overflowWrap: 'anywhere' }}>{c.label}</th>)}
        {statCols.map(k => <th key={k}>{k}</th>)}
      </tr></Row>
    ));
    data.participants.forEach((pt, i) => {
      const st = statMap[pt.name?.trim().toLowerCase()] || {};
      const gLbl = pt.gender === 'M' ? 'Male' : pt.gender === 'F' ? 'Female' : pt.gender === 'O' ? 'Other' : '—';
      add(`p-${i}`, (
        <Row cols={PC}><tr>
          <td className={d.srCol}>{i + 1}</td><td>{pt.name}</td><td>{pt.enrollment_no || '—'}</td><td>{gLbl}</td>
          <td>{pt.dept || '—'}</td><td>{pt.course || '—'}</td>
          {qCols.map(c => <td key={c.id} style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{answerOf(pt, c.id)}</td>)}
          {statCols.map(k => <td key={k}>{st[k] || '—'}</td>)}
        </tr></Row>
      ));
    });
    add('p-gap', <div className={d.spacer} />);
  }

  if (isSports) {
    /* ── Groups & teams ── */
    add('sp-groups', <div className={d.sportsBlock}>
      {/* ── GROUPS & TEAMS (per division) — sports only ── */}
      {isSports && DIVISIONS.map(division => {
        const divGroups = (data.groups || []).filter(g => (g.division || 'boys') === division);
        const divTeams  = (data.teams  || []).filter(t => (t.division || 'boys') === division);
        if (!divGroups.length && !divTeams.length) return null;
        return (
          <div key={division} className={r.detailSection}>
            <div className={r.detailSectionTitle}>{DIVISION_LABEL[division]} — Groups &amp; Teams</div>
            {divGroups.length > 0 ? (
              <div className={r.groupsWrap}>
                {divGroups.map(g => (
                  <div key={g.id} className={r.groupBlock}>
                    <div className={r.groupName}>{g.name}</div>
                    <div className={r.teamsGrid}>
                      {(g.teams || []).map(t => (
                        <div key={t.id} className={r.teamCard}>
                          <div className={r.teamName}>{t.name}</div>
                          {t.members?.length > 0 && (
                            <ul className={r.teamMembers}>
                              {t.members.map((m, i) => <li key={i}>{m.name}</li>)}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={r.teamsGrid}>
                {divTeams.map(t => (
                  <div key={t.id} className={r.teamCard}>
                    <div className={r.teamName}>{t.name}</div>
                    {t.members?.length > 0 && (
                      <ul className={r.teamMembers}>
                        {t.members.map((m, i) => <li key={i}>{m.name}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

    </div>);

    /* ── Match results (per division), one block per row ── */
    DIVISIONS.forEach(division => {
      const rows = (data.fixtures || []).filter(f => (f.division || 'boys') === division);
      if (!rows.length) return;
      const RC = ['18%', '24%', '14%', '24%', '20%'];
      add(`res-${division}-head`, <Row cols={['100%']} first><tr><th className={d.tableHead}>{DIVISION_LABEL[division]} — Match Results</th></tr></Row>);
      add(`res-${division}-cols`, <Row cols={RC}><tr><th>Round</th><th>Team A</th><th style={{ textAlign: 'center' }}>Score</th><th>Team B</th><th>Winner</th></tr></Row>);
      rows.forEach((f, i) => add(`res-${division}-${i}`, (
        <Row cols={RC}><tr>
          <td>{f.round || '—'}</td><td>{f.team_a_name}</td>
          <td style={{ textAlign: 'center' }}>{f.score_a != null && (f.score_a > 0 || f.score_b > 0) ? `${f.score_a} – ${f.score_b}` : 'vs'}</td>
          <td>{f.team_b_name}</td><td>{f.winner_name || '—'}</td>
        </tr></Row>
      )));
      add(`res-${division}-gap`, <div className={d.spacer} />);
    });

    /* ── Game MVPs ── */
    add('sp-mvps', <div className={d.sportsBlock}>
      {/* ── GAME MVPs — sports only ── */}
      {isSports && data.match_mvps?.length > 0 && (
        <div className={r.detailSection}>
          <div className={r.detailSectionTitle}>Game MVPs</div>
          <div className={r.gameMvpRow}>
            {data.match_mvps.map((m, i) => (
              <div key={m.score_id || i} className={r.gameMvpCard}>
                {m.player_photo
                  ? <img src={m.player_photo} alt="" className={r.gameMvpBg} />
                  : <div className={r.gameMvpBgFallback} />
                }
                <div className={r.gameMvpOverlay} />
                <div className={r.gameMvpContent}>
                  <div className={r.gameMvpLabel}>MVP</div>
                  <div className={r.gameMvpName}>
                    {(m.player_name || '').split(' ').map((w, wi) => (
                      <span key={wi} style={{ display: 'block' }}>{w}</span>
                    ))}
                  </div>
                  <div className={r.gameMvpMeta}>{m.home_team} vs {m.opponent_name}</div>
                  <div className={r.gameMvpStats}>
                    {[['PTS', m.stats?.PTS], ['AST', m.stats?.AST],
                      ['REB', m.stats?.REB], ['STL', m.stats?.STL]]
                      .filter(([, v]) => v > 0).map(([k, v]) => (
                        <div key={k} className={r.gameMvpChip}>
                          <span className={r.gameMvpVal}>{v}</span>
                          <span className={r.gameMvpKey}>{k}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>);

    /* ── Bracket + Boys/Girls tournament winners ── */
    add('sp-bracket', <div className={d.sportsBlock}>
      {/* ── TOURNAMENT BRACKET + WINNER (per division) ──
         Winner resolved server-side from actual bracket structure
         (summary_stats.tournamentWinnerBoys / tournamentWinnerGirls) —
         never guessed from a fixture's free-text round label. Reports generated before
         the Boys/Girls split only wrote a single summary_stats.tournamentWinner
         (implicitly boys) and are locked once submitted, so fall back to that legacy
         key under Boys so old reports keep showing a winner.
         Sports only — non-sports events have no bracket to show a winner from. */}
      {isSports && DIVISIONS.map(division => {
        const divFixturesR = (data.fixtures || []).filter(f => (f.division || 'boys') === division);
        const divGroupsR   = (data.groups  || []).filter(g => (g.division || 'boys') === division);
        const w = division === 'girls'
          ? data.summary_stats?.tournamentWinnerGirls
          : (data.summary_stats?.tournamentWinnerBoys || data.summary_stats?.tournamentWinner);
        const hasScore = w?.scoreFor != null && (w.scoreFor > 0 || w.scoreAgainst > 0);
        const divTeamsR = (data.teams || []).filter(t => (t.division || 'boys') === division);
        const divisionInPlay = divFixturesR.length > 0 || divGroupsR.length > 0 || divTeamsR.length > 0;
        if (!divisionInPlay && !w) return null;
        const bracketFixtures = divFixturesR.map(f => ({
          id: String(f.id || ''), teamA: f.team_a_name, teamB: f.team_b_name,
          scoreA: f.score_a, scoreB: f.score_b, winner: f.winner_name || null, round: f.round || '',
        }));
        const bracketGroups = divGroupsR.map(g => ({
          id: String(g.id || ''), name: g.name,
          sortOrder: g.sort_order ?? g.sortOrder ?? 0,
          teams: (g.teams || []).map(t => ({ id: String(t.id || ''), name: t.name })),
        }));
        return (
          <div key={division}>
            {divFixturesR.length > 0 && (
              <div className={r.detailSection}>
                <div className={r.detailSectionTitle}>{DIVISION_LABEL[division]} — Tournament Bracket</div>
                <div className={r.bracketWrap}>
                  <TournamentBracket groups={bracketGroups} fixtures={bracketFixtures} />
                </div>
              </div>
            )}
            {/* Always render both divisions' winner sections when that division is in play,
               even before a champion is decided, so Boys and Girls consistently show
               side by side instead of one silently disappearing. */}
            {divisionInPlay && (
              <div className={r.detailSection}>
                <div className={r.detailSectionTitle}>{DIVISION_LABEL[division]} — Tournament Winner</div>
                {w ? (
                  <div className={r.winnerBanner}>
                    <div className={r.winnerInfo}>
                      <div className={r.winnerName}>{w.name}</div>
                      <div className={r.winnerMeta}>
                        {w.round ? `${w.round} · ` : ''}
                        {hasScore ? `${w.scoreFor} – ${w.scoreAgainst} ` : ''}vs {w.opponent}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className={r.winnerPending}>Winner not yet decided.</div>
                )}
              </div>
            )}
          </div>
        );
      })}

    </div>);

    /* ── Tournament MVP ── */
    add('sp-tmvp', <div className={d.sportsBlock}>
      {/* ── TOURNAMENT MVP — sports only ── */}
      {isSports && data.tournament_mvp && (
        <div className={r.detailSection}>
          <div className={r.detailSectionTitle}>Tournament MVP</div>
          <div className={r.mvpCardWrap}>
            <div className={r.mvpCard8} ref={mvpCardRef}>
              {data.tournament_mvp.photo
                ? <img src={data.tournament_mvp.photo} alt="mvp bg" className={r.mvpBg} />
                : <div className={r.mvpBgFallback} />
              }
              <div className={r.mvpOverlay} />
              <div className={r.mvpContent}>
                <div className={r.mvpLabel}>MVP</div>
                <div className={r.mvpCardName}>
                  {(data.tournament_mvp.player_name || '').split(' ').map((w, i) => (
                    <span key={i} style={{ display: 'block' }}>{w}</span>
                  ))}
                </div>
                <div className={r.mvpCardStats}>
                  {[['PTS', data.tournament_mvp.stats?.PTS], ['AST', data.tournament_mvp.stats?.AST],
                    ['BLK', data.tournament_mvp.stats?.BLK], ['REB', data.tournament_mvp.stats?.REB],
                    ['STL', data.tournament_mvp.stats?.STL]]
                    .filter(([, v]) => v > 0).map(([k, v]) => (
                      <div key={k} className={r.mvpCardChip}>
                        <span className={r.mvpCardVal}>{v}</span>
                        <span className={r.mvpCardKey}>{k}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>);
  }

  /* ── Event brochure / banner (own page) ── */
  if (data.banner) {
    add('brochure', (
      <div className={d.brochure}>
        <div className={d.sectionTitle}>Event Brochure</div>
        <img src={data.banner} alt="Event brochure" className={d.brochureImg} />
      </div>
    ), { breakBefore: true });
  }

  /* ── Event photos — 2-column grid, two photos per block ── */
  if (photos.length) {
    add('ph-head', <div className={d.photoBoxTitle}>{nav.photos_title?.trim() || 'Event Photos'}</div>, { breakBefore: true });
    for (let i = 0; i < photos.length; i += 2) {
      const pair = photos.slice(i, i + 2);
      add(`ph-${i}`, (
        <div className={`${d.photoRow} ${pair.length === 1 ? d.photoRowSingle : ''}`}>
          {pair.map((url, j) => <img key={j} src={url} alt={`Event photo ${i + j + 1}`} className={d.photo} />)}
        </div>
      ));
    }
    add('ph-gap', <div className={d.spacer} />);
  }

  /* ── Supporting documents (own page) ── */
  const DC = ['10%', '58%', '32%'];
  add('docs-head', <div className={d.docsHead}>SUPPORTING DOCUMENTS</div>, { breakBefore: true });
  add('docs-cols', <Row cols={DC} first><tr><th className={d.srCol}>Sr. No.</th><th style={{ textAlign: 'center' }}>Description</th><th className={d.linkCol}>Document (Link)</th></tr></Row>);
  SUPPORTING_DOCS.forEach((row, i) => add(`docs-${row.key}`, (
    <Row cols={DC}><tr>
      <td className={d.srCol}>{i + 1}.</td>
      <td>{row.label}</td>
      <td className={d.linkCol} style={{ overflowWrap: 'anywhere' }}>{docs[row.key]?.trim() ? <Linkified text={docs[row.key]} /> : 'N.A.'}</td>
    </tr></Row>
  )));

  /* ── Signatures ── */
  if (signatories.length) {
    add('signatures', (
      <div className={d.signatures}>
        {signatories.map((sg, i) => (
          <div key={i} className={d.signatory}>
            <div className={d.signLine} />
            <div className={d.signName}>{sg.name}</div>
            <div className={d.signDesignation}>{sg.designation}</div>
          </div>
        ))}
      </div>
    ));
  }
  return blocks;
}

