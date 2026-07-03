import { useState, useEffect } from 'react';
import { useCoordClub } from '../../context/CoordClubContext';
import api from '../../api/client';
import TournamentBracket from '../../components/TournamentBracket/TournamentBracket';
import s from './CoordSubPage.module.css';
import r from './CoordReports.module.css';

export default function CoordReports() {
  const { selectedClub } = useCoordClub();
  const clubId = selectedClub?.id;

  const [reports,       setReports]       = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [years,         setYears]         = useState([]);
  const [activeYear,    setActiveYear]    = useState(null);
  const [annualData,    setAnnualData]    = useState(null);
  const [annualLoading, setAnnualLoading] = useState(false);
  const [expanded,      setExpanded]      = useState(null);

  useEffect(() => {
    if (!clubId) return;
    setLoading(true);
    Promise.all([
      api.get(`/reports?clubId=${clubId}`),
      api.get(`/reports/years?clubId=${clubId}`),
    ]).then(([rd, yd]) => {
      setReports(rd.reports || []);
      const yrs = yd.years || [];
      setYears(yrs);
      if (yrs.length) setActiveYear(yrs[0]);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [clubId]);

  useEffect(() => {
    if (!clubId || !activeYear) return;
    setAnnualLoading(true);
    api.get(`/reports/annual?clubId=${clubId}&year=${activeYear}`)
      .then(d => setAnnualData(d))
      .catch(() => setAnnualData(null))
      .finally(() => setAnnualLoading(false));
  }, [clubId, activeYear]);

  const toggle = (id) => setExpanded(p => p === id ? null : id);

  const visibleReports = reports.filter(rep => !activeYear || rep.academic_year === activeYear);

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Event Reports</h1>
          <p className={s.sub}>Saved reports for all sports events organised by your club.</p>
        </div>
      </div>

      {/* Year tabs */}
      {years.length > 0 && (
        <div className={r.yearTabBar}>
          {years.map(y => (
            <button
              key={y}
              className={`${r.yearTab} ${activeYear === y ? r.yearTabOn : ''}`}
              onClick={() => setActiveYear(y)}>
              {y}
            </button>
          ))}
        </div>
      )}

      {/* Annual summary */}
      {activeYear && (
        <div className={r.annualCard}>
          <div className={r.annualTitle}>Academic Year {activeYear} — Annual Summary</div>
          {annualLoading ? (
            <div className={r.loadingText} style={{ color: 'rgba(255,255,255,.7)' }}>Loading…</div>
          ) : annualData ? (
            <div className={r.annualStats}>
              {[
                ['Events',       annualData.totals?.totalEvents],
                ['Participants', annualData.totals?.totalParticipants],
                ['Matches',      annualData.totals?.totalMatches],
                ['Completed',    annualData.totals?.completedMatches],
                ['MVP Games',    annualData.totals?.totalMvpGames],
              ].map(([lbl, val]) => (
                <div key={lbl} className={r.annualStat}>
                  <span className={r.annualStatNum}>{val ?? 0}</span>
                  <span className={r.annualStatLbl}>{lbl}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Report list */}
      {loading ? (
        <div className={r.loadingText}>Loading reports…</div>
      ) : visibleReports.length === 0 ? (
        <div className={r.empty}>
          No reports for this year yet. Open an event → Report tab → Generate Report.
        </div>
      ) : (
        <div className={r.reportList}>
          {visibleReports.map(rep => (
            <div key={rep.id} className={r.reportCard}>
              <div className={r.reportCardHeader} onClick={() => toggle(rep.id)}>
                <div className={r.reportCardLeft}>
                  <div className={r.reportCardTitle}>{rep.event_title || 'Untitled Event'}</div>
                  <div className={r.reportCardMeta}>
                    {rep.academic_year} · Generated {new Date(rep.generated_at).toLocaleDateString()}
                  </div>
                </div>
                <div className={r.reportCardStats}>
                  <span className={r.statPill}>{rep.summary_stats?.totalParticipants ?? 0} players</span>
                  <span className={r.statPill}>{rep.summary_stats?.completedMatches ?? 0} matches</span>
                </div>
                <span className={r.chevron}>{expanded === rep.id ? '▲' : '▼'}</span>
              </div>

              {expanded === rep.id && (
                <ReportDetail eventId={rep.event_id} />
              )}
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

  useEffect(() => {
    api.get(`/reports/events/${eventId}`)
      .then(d => setData(d.report))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [eventId]);

  if (loading) return <div className={r.detailLoading}>Loading…</div>;
  if (!data)   return <div className={r.detailLoading}>Report data not found.</div>;

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

  return (
    <div className={r.reportDetail}>

      {/* Participants */}
      {data.participants?.length > 0 && (
        <div className={r.detailSection}>
          <div className={r.detailSectionTitle}>Participants ({data.participants.length})</div>
          <div className={r.tableWrap}>
            <table className={r.table}>
              <thead>
                <tr><th>#</th><th>Name</th><th>Enrollment</th><th>Gender</th><th>Dept</th><th>Course</th>
                  <th>PTS</th><th>AST</th><th>REB</th><th>STL</th></tr>
              </thead>
              <tbody>
                {data.participants.map((p, i) => {
                  const st = statMap[p.name?.trim().toLowerCase()] || {};
                  const gLbl = p.gender === 'M' ? 'Male' : p.gender === 'F' ? 'Female' : p.gender === 'O' ? 'Other' : '—';
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{p.name}</td>
                      <td>{p.enrollment_no || '—'}</td>
                      <td>{gLbl}</td>
                      <td>{p.dept || '—'}</td>
                      <td>{p.course || '—'}</td>
                      <td className={r.statCell}>{st.PTS || '—'}</td>
                      <td className={r.statCell}>{st.AST || '—'}</td>
                      <td className={r.statCell}>{st.REB || '—'}</td>
                      <td className={r.statCell}>{st.STL || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Groups & Teams */}
      {(data.groups?.length > 0 || data.teams?.length > 0) && (
        <div className={r.detailSection}>
          <div className={r.detailSectionTitle}>Groups &amp; Teams</div>
          {data.groups?.length > 0 ? (
            <div className={r.groupsWrap}>
              {data.groups.map(g => (
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
              {data.teams.map(t => (
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
      )}

      {/* Fixtures */}
      {data.fixtures?.length > 0 && (
        <div className={r.detailSection}>
          <div className={r.detailSectionTitle}>Match Results</div>
          <div className={r.tableWrap}>
            <table className={r.table}>
              <thead>
                <tr><th>Round</th><th>Team A</th><th>Score</th><th>Team B</th><th>Winner</th></tr>
              </thead>
              <tbody>
                {data.fixtures.map((f, i) => (
                  <tr key={i}>
                    <td>{f.round || '—'}</td>
                    <td>{f.team_a_name}</td>
                    <td className={r.score}>{f.winner_name && f.score_a != null ? `${f.score_a} – ${f.score_b}` : f.score_a != null && (f.score_a > 0 || f.score_b > 0) ? `${f.score_a} – ${f.score_b}` : 'vs'}</td>
                    <td>{f.team_b_name}</td>
                    <td>{f.winner_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bracket preview */}
      {data.fixtures?.length > 0 && data.groups?.length > 0 && (() => {
        const bracketFixtures = data.fixtures.map(f => ({
          id:     String(f.id || ''),
          teamA:  f.team_a_name,
          teamB:  f.team_b_name,
          scoreA: f.score_a,
          scoreB: f.score_b,
          winner: f.winner_name || null,
          round:  f.round || '',
        }));
        const bracketGroups = data.groups.map(g => ({
          id:        String(g.id || ''),
          name:      g.name,
          sortOrder: g.sort_order ?? g.sortOrder ?? 0,
          teams:     (g.teams || []).map(t => ({ id: String(t.id || ''), name: t.name })),
        }));
        return (
          <div className={r.detailSection}>
            <div className={r.detailSectionTitle}>Tournament Bracket</div>
            <div className={r.bracketWrap}>
              <TournamentBracket groups={bracketGroups} fixtures={bracketFixtures} />
            </div>
          </div>
        );
      })()}

      {/* Tournament Winner */}
      {(() => {
        const fx = data.fixtures || [];
        const completed = fx.filter(f => f.winner_name);
        if (!completed.length) return null;
        const finalFx =
          completed.find(f => /final/i.test(f.round || '') && !/semi|quarter/i.test(f.round || '')) ||
          completed[completed.length - 1];
        const opponent = finalFx.team_a_name === finalFx.winner_name ? finalFx.team_b_name : finalFx.team_a_name;
        const hasScore = finalFx.score_a != null && (finalFx.score_a > 0 || finalFx.score_b > 0 || finalFx.winner_name);
        return (
          <div className={r.detailSection}>
            <div className={r.detailSectionTitle}>Tournament Winner</div>
            <div className={r.winnerBanner}>
              <span className={r.winnerTrophy}>🏆</span>
              <div className={r.winnerInfo}>
                <div className={r.winnerName}>{finalFx.winner_name}</div>
                <div className={r.winnerMeta}>
                  {finalFx.round ? `${finalFx.round} · ` : ''}
                  {hasScore ? `${finalFx.score_a} – ${finalFx.score_b} ` : ''}
                  vs {opponent}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Tournament MVP — 8cm × 9cm portrait card */}
      {data.tournament_mvp && (
        <div className={r.detailSection}>
          <div className={r.detailSectionTitle}>Tournament MVP</div>
          <div className={r.mvpCardWrap}>
            {data.photos?.[0] && (
              <img src={data.photos[0]} alt="" className={r.mvpSidePhoto} />
            )}
            <div className={r.mvpCard8}>
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
                  {[['PTS', data.tournament_mvp.stats?.PTS],
                    ['AST', data.tournament_mvp.stats?.AST],
                    ['REB', data.tournament_mvp.stats?.REB],
                    ['STL', data.tournament_mvp.stats?.STL],
                  ].filter(([, v]) => v > 0).map(([k, v]) => (
                    <div key={k} className={r.mvpCardChip}>
                      <span className={r.mvpCardVal}>{v}</span>
                      <span className={r.mvpCardKey}>{k}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {data.photos?.[1] && (
              <img src={data.photos[1]} alt="" className={r.mvpSidePhoto} />
            )}
          </div>
        </div>
      )}

      {/* Photos */}
      {data.photos?.length > 0 && (
        <div className={r.detailSection}>
          <div className={r.detailSectionTitle}>Event Photos</div>
          <div className={r.photosRow}>
            {data.photos.map((url, i) => (
              <img key={i} src={url} alt={`photo-${i}`} className={r.photoCard} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
