import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getSocket } from '../../realtime/socket';
import { fetchPublicJson } from '../../lib/sportsScores';
import LiveScoreCard from '../../components/LiveScoreCard/LiveScoreCard';
import s from './LiveGames.module.css';

export default function LiveGames() {
  const [liveScores, setLiveScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [conn, setConn] = useState('connecting');
  const [lastUpdated, setLastUpdated] = useState(null);

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
    const poll = setInterval(loadScores, 15000);
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
    setConn(socket.connected ? 'connected' : 'connecting');
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('basketball:live:update', onLive);
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
                      <LiveScoreCard key={ls.id} ls={ls} />
                    ))}
                </div>
              </section>
            )}

            {recentEnded.length > 0 && (
              <section className={s.block}>
                <h2 className={s.blockTitleMuted}>Recently finished (24h)</h2>
                <div className={s.cardList}>
                  {recentEnded.map((ls) => (
                    <LiveScoreCard key={ls.id} ls={ls} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}



