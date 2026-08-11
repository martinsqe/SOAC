import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import api from '../../api/client';
import cf from './ClubsFeed.module.css';

/* One slide.
   mode is one of:
     'active'  — the one currently in view; plays with the real session
                 sound preference, shows the mute button + caption.
     'preload' — one slide away (previous or next); mounted and playing
                 muted in the background, off-screen, purely so it's already
                 buffered by the time the user actually scrolls to it —
                 without this, every scroll paid YouTube's full embed +
                 buffer time before playback could start.
     'idle'    — everything else; just a thumbnail, no player mounted, so a
                 long feed never has more than 3 players loaded at once.

   Sound is a session-wide preference (see ClubsFeed below), not per-slide —
   tap unmute once and every video for the rest of the session plays with
   sound, matching how the user actually expects a Reels-style feed to work. */
function Slide({ video, mode, soundOn, onToggleSound, registerRef }) {
  const active  = mode === 'active';
  const mounted = mode === 'active' || mode === 'preload';
  const iframeRef = useRef(null);

  /* Captured synchronously during render (via useMemo, not a post-commit
     useEffect) the moment this slide becomes active, then frozen until it
     becomes active again — otherwise toggling sound would change the
     iframe's src and restart the video from 0:00 instead of just relaying
     the change live. A useEffect-based capture ran one render too late here:
     it fires after the DOM (and the iframe's src) already committed, so a
     newly-active slide always built its src from the stale pre-toggle value.
     Preloading slides are always forced muted regardless of soundOn — they're
     playing off-screen purely to warm up, never meant to be heard. */
  const initiallyMuted = useMemo(() => !(active && soundOn), [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const embedSrc = `https://www.youtube.com/embed/${video.videoId}` +
    `?autoplay=1&mute=${initiallyMuted ? 1 : 0}&playsinline=1&rel=0&modestbranding=1&enablejsapi=1`;

  /* Relays a live sound-preference change to the currently-playing video
     without touching its src (which would restart it). Best-effort — the
     initial src above already carries the correct starting state, so this
     only matters for a toggle that happens while this exact slide is active. */
  useEffect(() => {
    if (!active) return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(JSON.stringify({ event: 'command', func: soundOn ? 'unMute' : 'mute', args: [] }), '*');
  }, [soundOn, active]);

  return (
    <div className={cf.slide} ref={registerRef} data-video-id={video.videoId}>
      {mounted ? (
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
        <button className={cf.muteBtn} onClick={onToggleSound} aria-label={soundOn ? 'Mute' : 'Unmute'}>
          {soundOn ? '🔊' : '🔇'}
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
  const [activeIndex, setActiveIndex] = useState(0);
  /* Session-wide sound preference — starts muted (autoplay-with-sound is
     blocked without a prior user gesture), tapping the button once turns it
     on for every video for the rest of this visit, current and future. */
  const [soundOn, setSoundOn] = useState(false);

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

  /* Track which slide is most in view — that one becomes active. */
  useEffect(() => {
    if (!videos.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const idx = videos.findIndex(v => v.videoId === visible.target.dataset.videoId);
        if (idx !== -1) setActiveIndex(idx);
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

  const toggleSound = () => setSoundOn(s => !s);

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
      {videos.map((v, i) => {
        const mode = i === activeIndex ? 'active'
          : (i === activeIndex - 1 || i === activeIndex + 1) ? 'preload'
          : 'idle';
        return (
          <Slide
            key={v.videoId}
            video={v}
            mode={mode}
            soundOn={soundOn}
            onToggleSound={toggleSound}
            registerRef={registerRef(v.videoId)}
          />
        );
      })}
    </div>
  );
}
