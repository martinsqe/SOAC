import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import TournamentBracket from '../../components/TournamentBracket/TournamentBracket';
import s from '../Coordinator/CoordSubPage.module.css';
import r from './AdminReports.module.css';

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
    <div className={r.detail}>

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

      {/* Groups & Teams */}
      {(data.groups?.length > 0 || data.teams?.length > 0) && (
        <div className={r.section}>
          <div className={r.sectionTitle}>Groups &amp; Teams</div>
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
              {data.teams.map(t => (
                <div key={t.id} className={r.teamCard}>
                  <div className={r.teamName}>{t.name}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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

      {/* Match Results */}
      {data.fixtures?.length > 0 && (
        <div className={r.section}>
          <div className={r.sectionTitle}>Match Results</div>
          <div className={r.tableWrap}>
            <table className={r.table}>
              <thead><tr><th>Round</th><th>Team A</th><th>Score</th><th>Team B</th><th>Winner</th></tr></thead>
              <tbody>
                {data.fixtures.map((f, i) => (
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
      )}

      {/* Bracket */}
      {data.fixtures?.length > 0 && data.groups?.length > 0 && (() => {
        const bf = data.fixtures.map(f => ({ id: String(f.id || ''), teamA: f.team_a_name, teamB: f.team_b_name, scoreA: f.score_a, scoreB: f.score_b, winner: f.winner_name || null, round: f.round || '' }));
        const bg = data.groups.map(g => ({ id: String(g.id || ''), name: g.name, sortOrder: g.sort_order ?? 0, teams: (g.teams || []).map(t => ({ id: String(t.id || ''), name: t.name })) }));
        return (
          <div className={r.section}>
            <div className={r.sectionTitle}>Tournament Bracket</div>
            <div className={r.bracketWrap}><TournamentBracket groups={bg} fixtures={bf} /></div>
          </div>
        );
      })()}

      {/* Winner */}
      {(() => {
        const fx = data.fixtures || [];
        const completed = fx.filter(f => f.winner_name);
        if (!completed.length) return null;
        const finalFx = completed.find(f => /final/i.test(f.round || '') && !/semi|quarter/i.test(f.round || '')) || completed[completed.length - 1];
        const opponent = finalFx.team_a_name === finalFx.winner_name ? finalFx.team_b_name : finalFx.team_a_name;
        const hasScore = finalFx.score_a != null && (finalFx.score_a > 0 || finalFx.score_b > 0 || finalFx.winner_name);
        return (
          <div className={r.section}>
            <div className={r.sectionTitle}>Tournament Winner</div>
            <div className={r.winnerBanner}>
              <span className={r.winnerTrophy}>🏆</span>
              <div>
                <div className={r.winnerName}>{finalFx.winner_name}</div>
                <div className={r.winnerMeta}>{finalFx.round ? `${finalFx.round} · ` : ''}{hasScore ? `${finalFx.score_a} – ${finalFx.score_b} ` : ''}vs {opponent}</div>
              </div>
            </div>
          </div>
        );
      })()}

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
                  {[['PTS', data.tournament_mvp.stats?.PTS], ['AST', data.tournament_mvp.stats?.AST], ['REB', data.tournament_mvp.stats?.REB], ['STL', data.tournament_mvp.stats?.STL]]
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

      {/* Event Photos */}
      {data.photos?.length > 0 && (
        <div className={r.section}>
          <div className={r.sectionTitle}>Event Photos</div>
          <div className={r.photosRow}>
            {data.photos.map((url, i) => <img key={i} src={url} alt={`photo-${i}`} className={r.photoCard} />)}
          </div>
        </div>
      )}
    </div>
  );
}
