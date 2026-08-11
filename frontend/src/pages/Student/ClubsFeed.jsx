import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api/client';
import cf from './ClubsFeed.module.css';

/* One slide — only the currently-active (mostly-in-view) slide actually
   mounts a YouTube iframe. Others show just the thumbnail, so scrolling
   through a long feed never has a dozen players loaded/competing at once. */
function Slide({ video, active, registerRef }) {
  const [muted, setMuted] = useState(true);
  const iframeRef = useRef(null);

  const toggleMute = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const func = muted ? 'unMute' : 'mute';
    win.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');
    setMuted(m => !m);
  };

  /* Reset to muted whenever a slide becomes active again — matches how
     Reels/Shorts always start muted, tap-to-unmute each time. */
  useEffect(() => { if (active) setMuted(true); }, [active]);

  const embedSrc = `https://www.youtube.com/embed/${video.videoId}` +
    `?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1`;

  return (
    <div className={cf.slide} ref={registerRef} data-video-id={video.videoId}>
      {active ? (
        <iframe
          ref={iframeRef}
          className={cf.frame}
          src={embedSrc}
          title={video.title}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      ) : (
        video.image && <img src={video.image} alt="" className={cf.poster} loading="lazy" />
      )}

      <div className={cf.overlay} />

      {active && (
        <button className={cf.muteBtn} onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
          {muted ? '🔇' : '🔊'}
        </button>
      )}

      <div className={cf.caption}>
        <div className={cf.title}>{video.title}</div>
        <div className={cf.meta}>
          <span className={cf.channel}>{video.channel}</span>
          <span className={cf.dot}>·</span>
          <span className={cf.topic}>{video.topic}</span>
        </div>
      </div>
    </div>
  );
}

export default function ClubsFeed() {
  const [videos,   setVideos]   = useState([]);
  const [clubs,    setClubs]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [apiKeySet, setApiKeySet] = useState(true);
  const [activeId, setActiveId] = useState(null);

  const containerRef = useRef(null);
  const slideRefs     = useRef(new Map());

  /* Fresh fetch on every mount — leaving the page and coming back (or a hard
     reload) always re-requests, and the backend shuffles fresh on every
     call, so the feed never looks the same twice in a row. */
  useEffect(() => {
    setLoading(true);
    api.get('/clubs-feed')
      .then((d) => {
        setVideos(d.videos || []);
        setClubs(d.clubs || []);
        setApiKeySet(d.apiKeySet !== false);
        setError('');
      })
      .catch((err) => setError(err.message || 'Could not load your Clubs Feed.'))
      .finally(() => setLoading(false));
  }, []);

  /* Track which slide is most in view — that one gets its player mounted. */
  useEffect(() => {
    if (!videos.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveId(visible.target.dataset.videoId);
      },
      { root: containerRef.current, threshold: [0.6] }
    );
    slideRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [videos]);

  const registerRef = useCallback((videoId) => (el) => {
    if (el) slideRefs.current.set(videoId, el);
    else slideRefs.current.delete(videoId);
  }, []);

  /* Auto-activate the first slide once loaded (observer only fires on scroll). */
  useEffect(() => {
    if (videos.length && !activeId) setActiveId(videos[0].videoId);
  }, [videos, activeId]);

  if (loading) {
    return <div className={cf.state}>Loading your Clubs Feed…</div>;
  }

  if (error) {
    return <div className={cf.state}>{error}</div>;
  }

  if (!clubs.length) {
    return (
      <div className={cf.state}>
        <p className={cf.stateTitle}>Join a club to unlock your Clubs Feed</p>
        <p className={cf.stateSub}>Videos relevant to your clubs will show up here once you're a member of at least one.</p>
      </div>
    );
  }

  if (!apiKeySet) {
    return (
      <div className={cf.state}>
        <p className={cf.stateTitle}>Clubs Feed isn't configured yet</p>
        <p className={cf.stateSub}>Ask an admin to add a YouTube API key on the server.</p>
      </div>
    );
  }

  if (!videos.length) {
    return (
      <div className={cf.state}>
        <p className={cf.stateTitle}>No videos found right now</p>
        <p className={cf.stateSub}>Try again shortly — new content refreshes periodically.</p>
      </div>
    );
  }

  return (
    <div className={cf.container} ref={containerRef}>
      {videos.map((v) => (
        <Slide
          key={v.videoId}
          video={v}
          active={activeId === v.videoId}
          registerRef={registerRef(v.videoId)}
        />
      ))}
    </div>
  );
}
