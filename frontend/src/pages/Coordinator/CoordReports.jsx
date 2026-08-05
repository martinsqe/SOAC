import { useState, useEffect, useRef } from 'react';
import { useCoordClub } from '../../context/CoordClubContext';
import api from '../../api/client';
import TournamentBracket from '../../components/TournamentBracket/TournamentBracket';
import { downloadElementAsPdf } from '../../utils/exportPdf';
import s from './CoordSubPage.module.css';
import r from './CoordReports.module.css';

const DIVISIONS = ['boys', 'girls'];
const DIVISION_LABEL = { boys: 'Boys', girls: 'Girls' };

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
          <p className={s.sub}>Saved reports for all events organised by your club.</p>
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
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const mvpCardRef = useRef(null);
  const printRef = useRef(null);

  useEffect(() => {
    api.get(`/reports/events/${eventId}`)
      .then(d => setData(d.report))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [eventId]);

  /* Center the tournament MVP card in its row after data loads */
  useEffect(() => {
    if (mvpCardRef.current) {
      mvpCardRef.current.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
    }
  }, [data]);

  const handleSubmit = async () => {
    if (!window.confirm('Submit this report to the admin? It cannot be edited after submission.')) return;
    setSubmitting(true);
    try {
      const d = await api.post(`/reports/events/${eventId}/submit`);
      if (d?.report) setData(d.report);
    } catch (err) {
      alert(err?.message || 'Already submitted or failed to submit.');
    } finally { setSubmitting(false); }
  };

  if (loading) return <div className={r.detailLoading}>Loading…</div>;
  if (!data)   return <div className={r.detailLoading}>Report data not found.</div>;

  const handleDownloadPdf = () => downloadElementAsPdf(printRef.current, data.event_title || 'Event Report');

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

  const nav = data.narrative || {};
  const isSports = data.event_category === 'sports';

  return (
    <div className={r.reportDetail}>
      <div className={r.detailToolbar}>
        <button className={r.downloadPdfBtn} onClick={handleDownloadPdf}>⬇ Download PDF</button>
      </div>

      <div ref={printRef} className={r.printable}>

      {/* ── LETTERHEAD ── */}
      <div className={r.letterhead}>
        <img src="/images/logo.png" alt="SOAC RKU" className={r.letterheadLogo} />
      </div>

      {/* ── EVENT HEADER ── */}
      <div className={r.docHeader}>
        <div className={r.docTitle}>{data.event_title}</div>
        <div className={r.docMeta}>
          <div className={r.docMetaItem}>
            <span className={r.docMetaLabel}>Date</span>
            <span className={r.docMetaValue}>{nav.event_date || '—'}</span>
          </div>
          <div className={r.docMetaItem}>
            <span className={r.docMetaLabel}>Venue</span>
            <span className={r.docMetaValue}>{data.summary_stats?.venue || '—'}</span>
          </div>
          <div className={r.docMetaItem}>
            <span className={r.docMetaLabel}>Participants</span>
            <span className={r.docMetaValue}>{nav.participants_count || data.summary_stats?.totalParticipants || data.participants?.length || 0}</span>
          </div>
          <div className={r.docMetaItem}>
            <span className={r.docMetaLabel}>Academic Year</span>
            <span className={r.docMetaValue}>{data.academic_year || '—'}</span>
          </div>
        </div>
      </div>

      {/* ── ASSOCIATION ── */}
      <div className={r.detailSection}>
        <div className={r.detailSectionTitle}>Association / Collaboration</div>
        <p className={r.narrativeText}>{nav.association || '—'}</p>
      </div>

      {/* ── OBJECTIVE ── */}
      <div className={r.detailSection}>
        <div className={r.detailSectionTitle}>Objective of the Event</div>
        <p className={r.narrativeText}>{nav.objective || '—'}</p>
      </div>

      {/* ── PARTICIPANTS ── */}
      {data.participants?.length > 0 && (
        <div className={r.detailSection}>
          <div className={r.detailSectionTitle}>Participants ({data.participants.length})</div>
          <div className={r.tableWrap}>
            <table className={r.table}>
              <thead>
                <tr><th>#</th><th>Name</th><th>Enrollment</th><th>Gender</th><th>Dept</th><th>Course</th>
                  {isSports && (<><th>PTS</th><th>AST</th><th>REB</th><th>STL</th></>)}</tr>
              </thead>
              <tbody>
                {data.participants.map((p, i) => {
                  const st = statMap[p.name?.trim().toLowerCase()] || {};
                  const gLbl = p.gender === 'M' ? 'Male' : p.gender === 'F' ? 'Female' : p.gender === 'O' ? 'Other' : '—';
                  return (
                    <tr key={i}>
                      <td>{i + 1}</td><td>{p.name}</td>
                      <td>{p.enrollment_no || '—'}</td><td>{gLbl}</td>
                      <td>{p.dept || '—'}</td><td>{p.course || '—'}</td>
                      {isSports && (<>
                        <td className={r.statCell}>{st.PTS || '—'}</td>
                        <td className={r.statCell}>{st.AST || '—'}</td>
                        <td className={r.statCell}>{st.REB || '—'}</td>
                        <td className={r.statCell}>{st.STL || '—'}</td>
                      </>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

      {/* ── MATCH RESULTS (per division) — sports only ── */}
      {isSports && DIVISIONS.map(division => {
        const divFixturesR = (data.fixtures || []).filter(f => (f.division || 'boys') === division);
        if (!divFixturesR.length) return null;
        return (
          <div key={division} className={r.detailSection}>
            <div className={r.detailSectionTitle}>{DIVISION_LABEL[division]} — Match Results</div>
            <div className={r.tableWrap}>
              <table className={r.table}>
                <thead>
                  <tr><th>Round</th><th>Team A</th><th className={r.scoreHead}>Score</th><th>Team B</th><th>Winner</th></tr>
                </thead>
                <tbody>
                  {divFixturesR.map((f, i) => (
                    <tr key={i}>
                      <td>{f.round || '—'}</td>
                      <td>{f.team_a_name}</td>
                      <td className={r.score}>
                        {f.score_a != null && (f.score_a > 0 || f.score_b > 0) ? `${f.score_a} – ${f.score_b}` : 'vs'}
                      </td>
                      <td>{f.team_b_name}</td>
                      <td>{f.winner_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

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

      {/* ── KEY HIGHLIGHTS ── */}
      <div className={r.detailSection}>
        <div className={r.detailSectionTitle}>Key Highlights</div>
        <p className={r.narrativeText}>{nav.key_highlights || '—'}</p>
      </div>

      {/* ── KEY HIGHLIGHTS PHOTOS (no heading) ── */}
      {data.highlight_photos?.length > 0 && (
        <div className={r.detailSection}>
          <div className={r.photosRow}>
            {data.highlight_photos.map((url, i) => (
              <img key={i} src={url} alt={`highlight-photo-${i}`} className={r.photoCard} />
            ))}
          </div>
        </div>
      )}

      {/* ── OUTCOME ── */}
      <div className={r.detailSection}>
        <div className={r.detailSectionTitle}>Outcome</div>
        <p className={r.narrativeText}>{nav.outcome || '—'}</p>
      </div>

      {/* ── ACKNOWLEDGMENTS ── */}
      <div className={r.detailSection}>
        <div className={r.detailSectionTitle}>Acknowledgments</div>
        <p className={r.narrativeText}>{nav.acknowledgments || '—'}</p>
      </div>

      {/* ── REMARKS ── */}
      <div className={r.detailSection}>
        <div className={r.detailSectionTitle}>Remarks</div>
        <p className={r.narrativeText}>{nav.remarks || '—'}</p>
      </div>

      {/* ── EVENT PHOTOS ── */}
      <div className={r.detailSection}>
        <div className={r.detailSectionTitle}>Event Photos ({data.photos?.length || 0} / 4)</div>
        {data.photos?.length > 0 ? (
          <div className={r.photosRow}>
            {data.photos.map((url, i) => (
              <img key={i} src={url} alt={`photo-${i}`} className={r.photoCard} />
            ))}
          </div>
        ) : (
          <p className={r.narrativePlaceholder}>No event photos uploaded yet — go to the event → Report tab to upload photos.</p>
        )}
      </div>

      {/* ── RKU FOOTER ── */}
      <div className={r.universityFooter}>
        <span className={r.universityFooterName}>RK University</span>
        <span>Kasturbadham, Rajkot - Bhavnagar Highway, Rajkot - 360020, Gujarat - India</span>
        <span>T +91 99099 52030 / 31&nbsp;&nbsp;|&nbsp;&nbsp;<strong>www.rku.ac.in</strong>&nbsp;&nbsp;|&nbsp;&nbsp;info@rku.ac.in</span>
      </div>

      </div>

      {/* ── SUBMIT TO ADMIN ── */}
      <div className={r.submitSection}>
        {data.submitted_at ? (
          <div className={r.submittedBadge}>
            ✓ Submitted to admin on {new Date(data.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        ) : (
          <button className={r.submitBtn} onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit Report to Admin'}
          </button>
        )}
      </div>
    </div>
  );
}
