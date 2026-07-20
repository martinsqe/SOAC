import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getSocket } from '../../realtime/socket';
import { fetchPublicJson, SPORT_CFG, winner, fmtDate } from '../../lib/sportsScores';
import LiveScoreCard from '../../components/LiveScoreCard/LiveScoreCard';
import s from './LiveGames.module.css';
import evStyles from '../Events/Events.module.css';

export default function LiveGames() {
  const [liveScores, setLiveScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [conn, setConn] = useState('connecting');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [statsModal, setStatsModal] = useState(null);

  const loadScores = async () => {
    try {
      const data = await fetchPublicJson('/events/live-scores');
      setLiveScores(data.liveScores || []);
    } catch {
      setLiveScores([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadScores();
    const poll = setInterval(loadScores, 5000);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const onConnect = () => setConn('connected');
    const onDisconnect = () => setConn('disconnected');
    const onLive = () => {
      setConn(socket.connected ? 'connected' : 'connecting');
      setLastUpdated(new Date().toISOString());
      fetchPublicJson('/events/live-scores')
        .then((d) => setLiveScores(d.liveScores || []))
        .catch(() => {});
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('basketball:live:update', onLive);
    socket.on('match:live:update', onLive);
    setConn(socket.connected ? 'connected' : 'connecting');
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('basketball:live:update', onLive);
      socket.off('match:live:update', onLive);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setLiveScores((prev) =>
        prev.map((sc) =>
          sc.timerRunning && Number(sc.timeRemainingSeconds || 0) > 0
            ? { ...sc, timeRemainingSeconds: Math.max(0, Number(sc.timeRemainingSeconds || 0) - 1) }
            : sc
        )
      );
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const liveGames = liveScores.filter((x) => x.status === 'live');
  const recentEnded = liveScores.filter((x) => x.status !== 'live');

  return (
    <div className={s.page}>
      <div className={s.hero}>
        <div className="wrap">
          <Link to="/events" className={s.backLink}>← Back to Events</Link>
          <div className={s.heroPill}>
            <span className={s.liveDot} /> Live Scores
          </div>
          <h1 className={s.heroTitle}>Live Game Scores</h1>
          <p className={s.heroSub}>
            Real-time updates from sports coordinators across campus. Games are started from each club&apos;s Live Scoreboard.
          </p>
          <p className={s.connLine} style={{ color: conn === 'connected' ? '#34d399' : '#fbbf24' }}>
            {conn === 'connected' ? '● Connected' : '○ Connecting…'}
            {lastUpdated && ` · Updated ${new Date(lastUpdated).toLocaleTimeString('en-IN')}`}
          </p>
        </div>
      </div>

      <div className={`wrap ${s.content}`}>
        {loading ? (
          <div className={s.empty}>
            <div className={s.emptyIcon}>⏳</div>
            <p>Loading live games…</p>
          </div>
        ) : liveGames.length === 0 && recentEnded.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyIcon}>📡</div>
            <h2>No live games right now</h2>
            <p>Check back during sports events. Coordinators start games from their club dashboard.</p>
            <Link to="/events" className={s.backBtn}>Return to Events</Link>
          </div>
        ) : (
          <>
            {liveGames.length > 0 && (
              <section className={s.block}>
                <h2 className={s.blockTitle}>
                  <span className={s.liveDot} />
                  In progress ({liveGames.length})
                </h2>
                <div className={s.cardList}>
                  {[...liveGames]
                    .sort((a, b) => new Date(a.startedAt || a.createdAt) - new Date(b.startedAt || b.createdAt))
                    .map((ls) => (
                      <LiveScoreCard key={ls.id} ls={ls} onViewStats={setStatsModal} />
                    ))}
                </div>
              </section>
            )}

            {recentEnded.length > 0 && (
              <section className={s.block}>
                <h2 className={s.blockTitleMuted}>Recently finished (24h)</h2>
                <div className={s.cardList}>
                  {recentEnded.map((ls) => (
                    <LiveScoreCard key={ls.id} ls={ls} onViewStats={setStatsModal} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════
          GAME STATS MODAL
      ══════════════════════════════════════════ */}
      {statsModal && (
        <div className={evStyles.modalOv} onClick={() => setStatsModal(null)}>
          <div className={evStyles.statsModalBox} onClick={e => e.stopPropagation()}>
            <button className={evStyles.modalClose} onClick={() => setStatsModal(null)}>✕</button>

            {/* Header */}
            <div className={evStyles.smHead}>
              <div className={evStyles.smSportPill} style={{ background: (SPORT_CFG[statsModal.sport] || {}).bg || '#f3f4f6', color: (SPORT_CFG[statsModal.sport] || {}).color || '#6b7280' }}>
                {(SPORT_CFG[statsModal.sport] || { label: statsModal.sport }).label}
              </div>
              <h2 className={evStyles.smTitle}>{statsModal.matchTitle || `${statsModal.homeTeam || statsModal.clubName || 'Home'} vs ${statsModal.opponentName || 'Away'}`}</h2>
              <p className={evStyles.smMeta}>{statsModal.venue && `📍 ${statsModal.venue}  ·  `}{fmtDate(statsModal.endedAt)}</p>
            </div>

            {/* Final score */}
            {(() => {
              const w = winner(statsModal);
              const cfg = SPORT_CFG[statsModal.sport] || { color: '#6b7280' };
              const homeName = statsModal.homeTeam || statsModal.clubName || 'Home';
              return (
                <div className={evStyles.smScoreBlock}>
                  <div className={`${evStyles.smTeamScore} ${w === 'home' ? evStyles.smWinner : w !== 'draw' ? evStyles.smLoser : ''}`}>
                    <div className={evStyles.smTeamName}>{homeName}</div>
                    <div className={evStyles.smBigScore} style={{ color: w === 'home' ? cfg.color : undefined }}>{statsModal.teamScore}</div>
                    {w === 'home' && <div className={evStyles.smTrophy}>🏆 Winner</div>}
                  </div>
                  <div className={evStyles.smVsDivider}>
                    <span>{w === 'draw' ? 'DRAW' : 'VS'}</span>
                    <span className={evStyles.smFinalLabel}>FINAL</span>
                  </div>
                  <div className={`${evStyles.smTeamScore} ${w === 'away' ? evStyles.smWinner : w !== 'draw' ? evStyles.smLoser : ''}`}>
                    <div className={evStyles.smTeamName}>{statsModal.opponentName || 'Away'}</div>
                    <div className={evStyles.smBigScore} style={{ color: w === 'away' ? cfg.color : undefined }}>{statsModal.opponentScore}</div>
                    {w === 'away' && <div className={evStyles.smTrophy}>🏆 Winner</div>}
                  </div>
                </div>
              );
            })()}

            {/* Player stats tables */}
            {[(
              { side: 'home', label: statsModal.homeTeam || statsModal.clubName || 'Home', players: statsModal.homePlayers || [] }
            ), (
              { side: 'away', label: statsModal.opponentName || 'Away', players: statsModal.awayPlayers || [] }
            )].map(({ side, label, players }) => players.length > 0 && (
              <div key={side} className={evStyles.smRoster}>
                <div className={evStyles.smRosterHead}>
                  <span className={evStyles.smRosterTeam}>{label}</span>
                  <div className={evStyles.smRosterCols}><span>PTS</span><span>STL</span><span>BLK</span></div>
                </div>
                {players.map((p, i) => (
                  <div key={i} className={evStyles.smRosterRow}>
                    <div className={evStyles.smPlayerName}>
                      {p.number && <span className={evStyles.smJersey}>#{p.number}</span>}
                      {p.name || '—'}
                    </div>
                    <div className={evStyles.smRosterCols}>
                      <span className={evStyles.smStat}>{p.stats?.points ?? 0}</span>
                      <span className={evStyles.smStat}>{p.stats?.steals ?? 0}</span>
                      <span className={evStyles.smStat}>{p.stats?.blocks ?? 0}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}

          </div>
        </div>
      )}
    </div>
  );
}



