import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api/client';
import { loadYouTubeIframeApi } from '../../utils/youtubeIframeApi';
import cf from './ClubsFeed.module.css';

/* One slide, driven by YouTube's real IFrame Player API (YT.Player) rather
   than a raw <iframe> + guessed postMessage commands — the official API
   gives real play()/pause()/mute() methods with a genuine onReady signal, so
   commands are never silently dropped the way an unready raw iframe can drop
   them.

   mode is one of:
     'active'          — the one currently in view; plays with the real
                          session sound preference, shows the mute button +
                          caption.
     'preload-near'     — the very next slide. Its player is created AND
                          started playing muted in the background the moment
                          it's ready — not just cued — so by the time the
                          student actually scrolls to it, the video is
                          already mid-buffer/mid-playback and switching to
                          active is just an unmute, never a cold start.
     'preload-far'      — up to PRELOAD_AHEAD slides ahead, beyond the
                          immediate next one. Created and cued (embed/init
                          overhead paid up front) but NOT actively playing —
                          only one video ever silently plays in the
                          background at a time, so scroll performance on a
                          real phone doesn't pay for multiple simultaneous
                          decode streams it doesn't need yet.
     'preload-behind'   — the slide just scrolled past. Kept mounted and
                          cued (so scrolling back is instant) but paused,
                          since replaying it in the background would waste
                          bandwidth on a video the student already moved on
                          from.
     'idle'             — everything else; just a thumbnail, no player
                          instance at all, so a long feed only ever holds a
                          handful of players regardless of feed length.

   Sound is a session-wide preference (see ClubsFeed below), not per-slide —
   tap unmute once and every video for the rest of the session plays with
   sound, matching how the user actually expects a Reels-style feed to work. */
function Slide({ video, mode, soundOn, onToggleSound, registerRef }) {
  const active  = mode === 'active';
  const mounted = mode !== 'idle';

  const mountElRef = useRef(null);
  const playerRef  = useRef(null);
  const readyRef   = useRef(false);
  /* Refs mirroring the latest props — read inside the async onReady callback,
     which closes over whatever `mode`/`soundOn` were at the time the player
     STARTED loading, not necessarily what they are by the time it's ready. */
  const modeRef    = useRef(mode);
  const soundRef   = useRef(soundOn);
  modeRef.current  = mode;
  soundRef.current = soundOn;

  /* When this slide became active — cleared once reported, so the same
     watch window is never double-counted. */
  const watchStartRef = useRef(null);

  const reportWatch = useCallback(() => {
    const startedAt = watchStartRef.current;
    watchStartRef.current = null;
    if (!startedAt) return;
    const seconds = (Date.now() - startedAt) / 1000;
    if (seconds < 2) return; // a quick scroll-past isn't a real engagement signal
    api.post('/clubs-feed/watch', { topic: video.topic, seconds }).catch(() => {});
  }, [video.topic]);

  const [posterVisible, setPosterVisible] = useState(true);

  /* Create the player once this slide enters the preload/active window;
     destroy it once it falls back out — caps how many players ever exist
     at once regardless of how far the feed is scrolled. */
  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;

    loadYouTubeIframeApi().then((YT) => {
      if (cancelled || !mountElRef.current) return;
      playerRef.current = new YT.Player(mountElRef.current, {
        videoId: video.videoId,
        playerVars: {
          autoplay: 0, mute: 1, playsinline: 1, rel: 0, modestbranding: 1,
        },
        events: {
          onReady: (e) => {
            readyRef.current = true;
            if (modeRef.current === 'active') {
              if (soundRef.current) e.target.unMute(); else e.target.mute();
              e.target.playVideo();
            } else if (modeRef.current === 'preload-near') {
              /* Silent warm-up: actually playing (muted), not just cued, so
                 the video is genuinely progressing/buffered by the time the
                 student arrives — this is what makes the active transition
                 feel instant instead of stalling on real buffering time.
                 Only the immediate-next slide does this — see 'preload-far'. */
              e.target.mute();
              e.target.playVideo();
            }
            /* 'preload-far' deliberately does nothing here — created and
               cued (embed/init cost paid early) but left paused, so only one
               video is ever silently decoding in the background at once. */
          },
          /* The poster stays up until real frames are actually rendering —
             onReady only means the player API will accept commands, not
             that playback has visibly started, so clearing the poster there
             left a window where the iframe was blank/buffering underneath
             an already-faded poster, which read as a stall. Tying it to the
             genuine PLAYING state instead means the poster masks 100% of any
             real buffering time. */
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) setPosterVisible(false);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
      readyRef.current = false;
      setPosterVisible(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, video.videoId]);

  /* Drives play/pause/mute across every mode transition. A preload-near
     slide that's already silently playing just gets unmuted on becoming
     active (playVideo() on an already-playing video is a no-op, never a
     restart) — genuinely instant. A cold idle→active jump (fast multi-slide
     scroll skipping the preload window) still falls back to a normal start.
     Also starts/stops the watch-time clock used for engagement weighting. */
  useEffect(() => {
    if (active) {
      watchStartRef.current = Date.now();
    } else {
      reportWatch();
    }
    if (!readyRef.current || !playerRef.current) return;
    if (active) {
      if (soundOn) playerRef.current.unMute(); else playerRef.current.mute();
      playerRef.current.playVideo();
    } else if (mode === 'preload-near') {
      playerRef.current.mute();
      playerRef.current.playVideo();
    } else {
      playerRef.current.pauseVideo();
    }
  }, [active, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Covers the last-watched video when the whole page unmounts (navigating
     away) rather than just scrolling to the next slide. */
  useEffect(() => () => reportWatch(), [reportWatch]);

  /* Live sound-preference relay while remaining the active slide. */
  useEffect(() => {
    if (!readyRef.current || !playerRef.current || !active) return;
    if (soundOn) playerRef.current.unMute(); else playerRef.current.mute();
  }, [soundOn, active]);

  return (
    <div className={cf.slide} ref={registerRef} data-video-id={video.videoId}>
      {/* Poster stays visible underneath until the player has actually
         signalled ready — a fresh player is blank/white for a moment while
         YouTube's embed page and chrome load, which otherwise reads as a
         stall even once the preload window is warming it up in advance. */}
      {video.image && (
        <img
          src={video.image}
          alt=""
          className={cf.poster}
          loading="lazy"
          style={!posterVisible ? { opacity: 0 } : undefined}
        />
      )}
      {/* YT.Player replaces this inner div with its own fresh <iframe> (which
         won't inherit a className), so positioning lives on the wrapper
         instead — the replacement iframe just fills it via CSS. */}
      {mounted && (
        <div className={cf.frame}>
          <div ref={mountElRef} className={cf.playerMount} />
        </div>
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

/* How many slides ahead of the active one get created and silently
   pre-played (muted) so they're already buffering/progressing before the
   student scrolls to them. 2 gives real lead time at natural swipe speed
   without holding an unbounded number of simultaneous players. */
const PRELOAD_AHEAD = 2;

/* How close to the end of the currently-loaded feed (in slides) triggers the
   next "load more" fetch — needs enough head start that the fetch resolves
   before the student actually scrolls that far. */
const LOAD_MORE_THRESHOLD = 4;

export default function ClubsFeed() {
  const [videos,   setVideos]   = useState([]);
  const [clubs,    setClubs]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [apiKeySet, setApiKeySet] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hasMore,  setHasMore]  = useState(true);
  /* Session-wide sound preference — starts muted (autoplay-with-sound is
     blocked without a prior user gesture), tapping the button once turns it
     on for every video for the rest of this visit, current and future. */
  const [soundOn, setSoundOn] = useState(false);

  const containerRef = useRef(null);
  const slideRefs     = useRef(new Map());
  /* Every video ID ever shown this session — sent back as `exclude` so
     "load more" prefers genuinely new videos over immediate repeats. A ref
     (not state) since it's read inside the fetch call, never rendered. */
  const shownIdsRef  = useRef(new Set());
  const fetchingMoreRef = useRef(false);
  /* Two consecutive load-more calls that append nothing new means every
     topic's pool is genuinely exhausted (or the feed API is unconfigured) —
     stops further auto-fetching so a dead end doesn't retry forever. */
  const emptyStreakRef = useRef(0);

  /* Fresh fetch on every mount — leaving the page and coming back (or a hard
     reload) always re-requests, and the backend shuffles fresh on every
     call, so the feed never looks the same twice in a row. */
  useEffect(() => {
    setLoading(true);
    api.get('/clubs-feed')
      .then((d) => {
        const list = d.videos || [];
        list.forEach(v => shownIdsRef.current.add(v.videoId));
        setVideos(list);
        setClubs(d.clubs || []);
        setApiKeySet(d.apiKeySet !== false);
        setError('');
      })
      .catch((err) => setError(err.message || 'Could not load your Clubs Feed.'))
      .finally(() => setLoading(false));
  }, []);

  /* Infinite scroll: once the active slide gets within LOAD_MORE_THRESHOLD
     of the end of what's loaded, fetch the next batch and append it —
     scrolling through a Clubs Feed should never hit a hard stop the way a
     one-shot fixed list would. */
  useEffect(() => {
    if (!hasMore || fetchingMoreRef.current) return;
    if (!videos.length) return;
    if (activeIndex < videos.length - LOAD_MORE_THRESHOLD) return;

    fetchingMoreRef.current = true;
    api.post('/clubs-feed/more', { exclude: [...shownIdsRef.current] })
      .then((d) => {
        const incoming = (d.videos || []).filter(v => !shownIdsRef.current.has(v.videoId));
        incoming.forEach(v => shownIdsRef.current.add(v.videoId));
        if (incoming.length) {
          emptyStreakRef.current = 0;
          setVideos(prev => [...prev, ...incoming]);
        } else {
          emptyStreakRef.current += 1;
          if (emptyStreakRef.current >= 2) setHasMore(false);
        }
      })
      .catch(() => { emptyStreakRef.current += 1; if (emptyStreakRef.current >= 2) setHasMore(false); })
      .finally(() => { fetchingMoreRef.current = false; });
  }, [activeIndex, videos.length, hasMore]);

  /* Latest videos array, readable from the observer callback below without
     that callback needing to close over (and the observer needing to be
     recreated whenever) `videos` itself. */
  const videosRef = useRef(videos);
  videosRef.current = videos;

  const observerRef = useRef(null);

  /* Track which slide is most in view — that one becomes active. Created
     ONCE for the life of the page, not per videos-array change: infinite
     scroll appends a new array reference on every "load more" batch, and
     tearing down + recreating the observer on every append (a) is real
     main-thread work landing mid-scroll and (b) re-observing already-
     intersecting elements re-fires the callback, which could transiently
     flip activeIndex away from and back to the slide already playing —
     unmounting/remounting its player mid-watch, which resets it to muted
     and restarts it from 0. New elements are observed individually as they
     mount instead, via registerRef below. */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const idx = videosRef.current.findIndex(v => v.videoId === visible.target.dataset.videoId);
        if (idx !== -1) setActiveIndex(idx);
      },
      { root: containerRef.current, threshold: [0.6] }
    );
    observerRef.current = observer;
    return () => { observer.disconnect(); observerRef.current = null; };
  }, []);

  const registerRef = useCallback((videoId) => (el) => {
    const prev = slideRefs.current.get(videoId);
    if (prev && prev !== el) observerRef.current?.unobserve(prev);
    if (el) {
      slideRefs.current.set(videoId, el);
      observerRef.current?.observe(el);
    } else {
      slideRefs.current.delete(videoId);
    }
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
          : (i === activeIndex + 1) ? 'preload-near'
          : (i > activeIndex + 1 && i <= activeIndex + PRELOAD_AHEAD) ? 'preload-far'
          : (i === activeIndex - 1) ? 'preload-behind'
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
      {!hasMore && (
        <div className={`${cf.slide} ${cf.endSlide}`}>
          <p className={cf.stateTitle}>You're all caught up</p>
          <p className={cf.stateSub}>New videos for your clubs show up here as they're published.</p>
        </div>
      )}
    </div>
  );
}
