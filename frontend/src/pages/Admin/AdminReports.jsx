import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import TournamentBracket from '../../components/TournamentBracket/TournamentBracket';
import { downloadElementAsPdf } from '../../utils/exportPdf';
import s from '../Coordinator/CoordSubPage.module.css';
import r from './AdminReports.module.css';

const DIVISIONS = ['boys', 'girls'];
const DIVISION_LABEL = { boys: 'Boys', girls: 'Girls' };

const NarrativeBlock = ({ label, text }) => !text?.trim() ? null : (
  <div className={r.narrativeSection}>
    <div className={r.narrativeLabel}>{label}</div>
    <div className={r.narrativeText}>{text}</div>
  </div>
);

export default function AdminReports() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    api.get('/reports/submitted')
      .then(d => setReports(d.reports || []))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id) => setExpanded(p => p === id ? null : id);

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Event Reports</h1>
          <p className={s.sub}>Submitted reports from club coordinators.</p>
        </div>
      </div>

      {loading ? (
        <div className={r.empty}>Loading…</div>
      ) : reports.length === 0 ? (
        <div className={r.empty}>No reports submitted yet.</div>
      ) : (
        <div className={r.list}>
          {reports.map(rep => (
            <div key={rep.id} className={r.card}>
              <div className={r.cardHeader} onClick={() => toggle(rep.id)}>
                <div className={r.cardLeft}>
                  <div className={r.cardTitle}>{rep.event_title || 'Untitled Event'}</div>
                  <div className={r.cardMeta}>
                    {rep.club_name} · {rep.academic_year} · Submitted {new Date(rep.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </div>
                <div className={r.cardPills}>
                  <span className={r.pill}>{rep.summary_stats?.totalParticipants ?? 0} players</span>
                  <span className={r.pill}>{rep.summary_stats?.completedMatches ?? 0} matches</span>
                </div>
                <span className={r.chevron}>{expanded === rep.id ? '▲' : '▼'}</span>
              </div>
              {expanded === rep.id && <ReportDetail eventId={rep.event_id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportDetail({ eventId }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const mvpCardRef = useRef(null);
  const printRef = useRef(null);

  useEffect(() => {
    api.get(`/reports/events/${eventId}`)
      .then(d => setData(d.report))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [eventId]);

  useEffect(() => {
    if (mvpCardRef.current) {
      mvpCardRef.current.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
    }
  }, [data]);

  if (loading) return <div className={r.detailLoading}>Loading…</div>;
  if (!data)   return <div className={r.detailLoading}>Report not found.</div>;

  const handleDownloadPdf = () => downloadElementAsPdf(printRef.current, data.event_title || 'Event Report');

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

  const narrative = data.narrative || {};

  return (
    <div className={r.detail}>
      <div className={r.detailToolbar}>
        <button className={r.downloadPdfBtn} onClick={handleDownloadPdf}>⬇ Download PDF</button>
      </div>

      <div ref={printRef} className={r.printable}>

      {/* Letterhead — mirrors the coordinator's report exactly */}
      <div className={r.letterhead}>
        <img src="/images/logo.png" alt="SOAC RKU" className={r.letterheadLogo} />
      </div>

      {/* Event header */}
      <div className={r.docHeader}>
        <div className={r.docTitle}>{data.event_title}</div>
        <div className={r.docMeta}>
          <div className={r.docMetaItem}>
            <span className={r.docMetaLabel}>Date</span>
            <span className={r.docMetaValue}>{narrative.event_date || '—'}</span>
          </div>
          <div className={r.docMetaItem}>
            <span className={r.docMetaLabel}>Venue</span>
            <span className={r.docMetaValue}>{data.summary_stats?.venue || '—'}</span>
          </div>
          <div className={r.docMetaItem}>
            <span className={r.docMetaLabel}>Participants</span>
            <span className={r.docMetaValue}>{data.summary_stats?.totalParticipants ?? data.participants?.length ?? 0}</span>
          </div>
          <div className={r.docMetaItem}>
            <span className={r.docMetaLabel}>Academic Year</span>
            <span className={r.docMetaValue}>{data.academic_year || '—'}</span>
          </div>
        </div>
      </div>

      <NarrativeBlock label="Association / Collaboration" text={narrative.association} />
      <NarrativeBlock label="Objective of the Event" text={narrative.objective} />

      {/* Participants */}
      {data.participants?.length > 0 && (
        <div className={r.section}>
          <div className={r.sectionTitle}>Participants ({data.participants.length})</div>
          <div className={r.tableWrap}>
            <table className={r.table}>
              <thead>
                <tr><th>#</th><th>Name</th><th>Enrollment</th><th>Gender</th><th>Dept</th>
                  <th>PTS</th><th>AST</th><th>REB</th><th>STL</th></tr>
              </thead>
              <tbody>
                {data.participants.map((p, i) => {
                  const st = statMap[p.name?.trim().toLowerCase()] || {};
                  const g = p.gender === 'M' ? 'Male' : p.gender === 'F' ? 'Female' : p.gender === 'O' ? 'Other' : '—';
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td><td>{p.name}</td><td>{p.enrollment_no || '—'}</td>
                      <td>{g}</td><td>{p.dept || '—'}</td>
                      <td className={r.stat}>{st.PTS || '—'}</td>
                      <td className={r.stat}>{st.AST || '—'}</td>
                      <td className={r.stat}>{st.REB || '—'}</td>
                      <td className={r.stat}>{st.STL || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Groups & Teams (per division) */}
      {DIVISIONS.map(division => {
        const divGroups = (data.groups || []).filter(g => (g.division || 'boys') === division);
        const divTeams  = (data.teams  || []).filter(t => (t.division || 'boys') === division);
        if (!divGroups.length && !divTeams.length) return null;
        return (
          <div key={division} className={r.section}>
            <div className={r.sectionTitle}>{DIVISION_LABEL[division]} — Groups &amp; Teams</div>
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
                            <ul className={r.members}>
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
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Game MVPs */}
      {data.match_mvps?.length > 0 && (
        <div className={r.section}>
          <div className={r.sectionTitle}>Game MVPs</div>
          <div className={r.mvpRow}>
            {data.match_mvps.map((m, i) => (
              <div key={m.score_id || i} className={r.mvpCard}>
                {m.player_photo ? <img src={m.player_photo} alt="" className={r.mvpBg} /> : <div className={r.mvpBgFallback} />}
                <div className={r.mvpOverlay} />
                <div className={r.mvpContent}>
                  <div className={r.mvpLabelSm}>MVP</div>
                  <div className={r.mvpName}>{(m.player_name || '').split(' ').map((w, wi) => <span key={wi} style={{ display: 'block' }}>{w}</span>)}</div>
                  <div className={r.mvpMeta}>{m.home_team} vs {m.opponent_name}</div>
                  <div className={r.mvpStats}>
                    {[['PTS', m.stats?.PTS], ['AST', m.stats?.AST], ['REB', m.stats?.REB], ['STL', m.stats?.STL]]
                      .filter(([, v]) => v > 0).map(([k, v]) => (
                        <div key={k} className={r.mvpChip}>
                          <span className={r.mvpVal}>{v}</span>
                          <span className={r.mvpKey}>{k}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Match Results (per division) */}
      {DIVISIONS.map(division => {
        const divFixturesR = (data.fixtures || []).filter(f => (f.division || 'boys') === division);
        if (!divFixturesR.length) return null;
        return (
          <div key={division} className={r.section}>
            <div className={r.sectionTitle}>{DIVISION_LABEL[division]} — Match Results</div>
            <div className={r.tableWrap}>
              <table className={r.table}>
                <thead><tr><th>Round</th><th>Team A</th><th className={r.scoreHead}>Score</th><th>Team B</th><th>Winner</th></tr></thead>
                <tbody>
                  {divFixturesR.map((f, i) => (
                    <tr key={i}>
                      <td>{f.round || '—'}</td><td>{f.team_a_name}</td>
                      <td className={r.score}>{f.winner_name && f.score_a != null ? `${f.score_a} – ${f.score_b}` : f.score_a != null && (f.score_a > 0 || f.score_b > 0) ? `${f.score_a} – ${f.score_b}` : 'vs'}</td>
                      <td>{f.team_b_name}</td><td>{f.winner_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* Bracket + Winner (per division) — winner resolved server-side from actual bracket
         structure (summary_stats.tournamentWinnerBoys / tournamentWinnerGirls), never
         guessed from a fixture's free-text round label. Reports generated before the
         Boys/Girls split only wrote a single summary_stats.tournamentWinner (implicitly
         boys) and are locked once submitted, so fall back to that legacy key under Boys. */}
      {DIVISIONS.map(division => {
        const divFixturesR = (data.fixtures || []).filter(f => (f.division || 'boys') === division);
        const divGroupsR   = (data.groups  || []).filter(g => (g.division || 'boys') === division);
        const w = division === 'girls'
          ? data.summary_stats?.tournamentWinnerGirls
          : (data.summary_stats?.tournamentWinnerBoys || data.summary_stats?.tournamentWinner);
        const hasScore = w?.scoreFor != null && (w.scoreFor > 0 || w.scoreAgainst > 0);
        const divTeamsR = (data.teams || []).filter(t => (t.division || 'boys') === division);
        const divisionInPlay = divFixturesR.length > 0 || divGroupsR.length > 0 || divTeamsR.length > 0;
        if (!divisionInPlay && !w) return null;
        const bf = divFixturesR.map(f => ({ id: String(f.id || ''), teamA: f.team_a_name, teamB: f.team_b_name, scoreA: f.score_a, scoreB: f.score_b, winner: f.winner_name || null, round: f.round || '' }));
        const bg = divGroupsR.map(g => ({ id: String(g.id || ''), name: g.name, sortOrder: g.sort_order ?? 0, teams: (g.teams || []).map(t => ({ id: String(t.id || ''), name: t.name })) }));
        return (
          <div key={division}>
            {divFixturesR.length > 0 && (
              <div className={r.section}>
                <div className={r.sectionTitle}>{DIVISION_LABEL[division]} — Tournament Bracket</div>
                <div className={r.bracketWrap}><TournamentBracket groups={bg} fixtures={bf} /></div>
              </div>
            )}
            {/* Always render both divisions' winner sections when that division is in play,
               even before a champion is decided, so Boys and Girls consistently show
               side by side instead of one silently disappearing. */}
            {divisionInPlay && (
              <div className={r.section}>
                <div className={r.sectionTitle}>{DIVISION_LABEL[division]} — Tournament Winner</div>
                {w ? (
                  <div className={r.winnerBanner}>
                    <div>
                      <div className={r.winnerName}>{w.name}</div>
                      <div className={r.winnerMeta}>{w.round ? `${w.round} · ` : ''}{hasScore ? `${w.scoreFor} – ${w.scoreAgainst} ` : ''}vs {w.opponent}</div>
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

      {/* Tournament MVP */}
      {data.tournament_mvp && (
        <div className={r.section}>
          <div className={r.sectionTitle}>Tournament MVP</div>
          <div className={r.tourneyMvpWrap}>
            {data.photos?.[0] && <img src={data.photos[0]} alt="" className={r.tourneyMvpSide} />}
            <div className={r.tourneyMvpCard} ref={mvpCardRef}>
              {data.tournament_mvp.photo ? <img src={data.tournament_mvp.photo} alt="" className={r.mvpBg} /> : <div className={r.mvpBgFallback} />}
              <div className={r.mvpOverlay} />
              <div className={r.tourneyMvpContent}>
                <div className={r.tourneyLabel}>MVP</div>
                <div className={r.tourneyName}>{(data.tournament_mvp.player_name || '').split(' ').map((w, i) => <span key={i} style={{ display: 'block' }}>{w}</span>)}</div>
                <div className={r.mvpStats}>
                  {[['PTS', data.tournament_mvp.stats?.PTS], ['AST', data.tournament_mvp.stats?.AST],
                    ['BLK', data.tournament_mvp.stats?.BLK], ['REB', data.tournament_mvp.stats?.REB],
                    ['STL', data.tournament_mvp.stats?.STL]]
                    .filter(([, v]) => v > 0).map(([k, v]) => (
                      <div key={k} className={r.mvpChip}>
                        <span className={r.mvpVal}>{v}</span>
                        <span className={r.mvpKey}>{k}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
            {data.photos?.[1] && <img src={data.photos[1]} alt="" className={r.tourneyMvpSide} />}
          </div>
        </div>
      )}

      <NarrativeBlock label="Key Highlights" text={narrative.key_highlights} />
      <NarrativeBlock label="Outcome" text={narrative.outcome} />
      <NarrativeBlock label="Acknowledgments" text={narrative.acknowledgments} />
      <NarrativeBlock label="Remarks" text={narrative.remarks} />

      {/* Event Photos */}
      {data.photos?.length > 0 && (
        <div className={r.section}>
          <div className={r.sectionTitle}>Event Photos</div>
          <div className={r.photosRow}>
            {data.photos.map((url, i) => <img key={i} src={url} alt={`photo-${i}`} className={r.photoCard} />)}
          </div>
        </div>
      )}

      {/* University footer — mirrors the coordinator's report exactly */}
      <div className={r.universityFooter}>
        <span className={r.universityFooterName}>RK University</span>
        <span>Kasturbadham, Rajkot - Bhavnagar Highway, Rajkot - 360020, Gujarat - India</span>
        <span>T +91 99099 52030 / 31&nbsp;&nbsp;|&nbsp;&nbsp;<strong>www.rku.ac.in</strong>&nbsp;&nbsp;|&nbsp;&nbsp;info@rku.ac.in</span>
      </div>

      </div>
    </div>
  );
}
