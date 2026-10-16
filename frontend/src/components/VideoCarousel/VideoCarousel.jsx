import { useCallback, useEffect, useRef, useState } from 'react';
import s from './VideoCarousel.module.css';

const AUTO_ADVANCE_MS = 30000;
const SLIDE_MS = 700;

/* Start a video if it isn't playing — always muted, which is what lets browsers
   (iPhones included) play it without a tap */
const startVideo = (v) => {
  v.muted = true;
  if (!v.paused || !v.currentSrc) return;
  v.play().catch(() => { /* not ready yet — onCanPlay tries again */ });
};

/* How many videos sit side by side: 3 on big screens, 2 on tablets, 1 on phones */
const perViewFor = () => {
  if (typeof window === 'undefined') return 3;
  if (window.matchMedia('(min-width: 900px)').matches) return 3;
  if (window.matchMedia('(min-width: 600px)').matches) return 2;
  return 1;
};

/* A row of equal tiles, no gaps between them: each video fills its tile edge to
   edge. Arrows on both sides move the row by one video; it also moves on by itself
   every 30 s (an arrow press restarts that count). The row loops — after the last
   video come the first ones again, always sliding the same way.
   Only the videos in view play, and a video is downloaded only once it is in view
   or next in line.
     videos  [{ src, label }]
   It fills its positioned parent; put a heading next to it with a higher z-index. */
export default function VideoCarousel({ videos }) {
  const n = videos.length;
  const [perView, setPerView] = useState(perViewFor);
  const view = Math.min(perView, n);
  /* the row is the videos followed by copies of the first few, so it can slide past
     the last video into the first ones and then quietly jump back */
  const items = n > view ? [...videos, ...videos.slice(0, view)] : videos;
  const [index, setIndex] = useState(0);
  const [animate, setAnimate] = useState(true);
  /* tiles whose video may download: what is in view plus one either side */
  const windowAt = (at, v) => Array.from({ length: v + 2 }, (_, k) => at - 1 + k);
  const [loaded, setLoaded] = useState(() => new Set(windowAt(0, view)));
  const busy = useRef(false);
  const refs = useRef([]);

  const moveTo = useCallback((at, withSlide) => {
    setAnimate(withSlide);
    setIndex(at);
    setLoaded(prev => new Set([...prev, ...windowAt(at, view), ...windowAt(at % n, view)]));
  }, [n, view]);

  /* A different screen size shows a different number of tiles — start the row again */
  useEffect(() => {
    const onResize = () => {
      const next = perViewFor();
      setPerView(prev => {
        if (prev !== next) {
          setIndex(0);
          setAnimate(false);
          setLoaded(l => new Set([...l, ...Array.from({ length: next + 2 }, (_, k) => k - 1)]));
        }
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const go = useCallback((dir) => {
    if (n <= view || busy.current) return;
    busy.current = true;
    setTimeout(() => { busy.current = false; }, SLIDE_MS + 60);
    if (dir > 0) moveTo(index + 1, true);
    else if (index > 0) moveTo(index - 1, true);
    else {
      /* stepping back from the start: jump (unseen) to the identical copies at the
         end, then slide back one */
      moveTo(n, false);
      requestAnimationFrame(() => requestAnimationFrame(() => moveTo(n - 1, true)));
    }
  }, [index, n, view, moveTo]);

  /* After sliding onto the copies at the end, jump back to the real first videos */
  const onSlid = () => {
    if (index >= n) moveTo(index - n, false);
  };

  /* Move on by itself every 30 s; any move restarts the count */
  useEffect(() => {
    if (n <= view) return undefined;
    const t = setTimeout(() => go(1), AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [index, go, n, view]);

  /* Play what is in view, pause the rest */
  const inView = (p) => p >= index && p < index + view;
  const indexRef = useRef(0);
  useEffect(() => { indexRef.current = index; }, [index]);
  useEffect(() => {
    refs.current.forEach((v, p) => {
      if (!v) return;
      if (inView(p) && !document.hidden) startVideo(v);
      else if (!v.paused) v.pause();
    });
  });

  /* Pause while the tab is in the background; pick up again on return */
  useEffect(() => {
    const onVisibility = () => {
      refs.current.forEach((v, p) => {
        if (!v) return;
        if (document.hidden) v.pause();
        else if (p >= indexRef.current && p < indexRef.current + view) startVideo(v);
      });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [view]);

  /* A video in view that can't play yet (still downloading) or was paused by the
     browser (stalled, power saving) is started again as soon as it is able to */
  const resume = (p) => (e) => {
    if (inView(p) && !document.hidden) startVideo(e.currentTarget);
  };

  const shift = `translateX(-${(index * 100) / view}%)`;

  return (
    <div className={s.carousel}>
      <div className={s.track} onTransitionEnd={onSlid}
        style={{ transform: shift, transition: animate ? `transform ${SLIDE_MS}ms cubic-bezier(.65, 0, .35, 1)` : 'none' }}>
        {items.map((v, p) => (
          <div key={p} className={s.tile} style={{ flexBasis: `${100 / view}%` }} aria-hidden={!inView(p)}>
            <video ref={el => { refs.current[p] = el; if (el) { el.muted = true; el.defaultMuted = true; } }}
              className={s.video} src={loaded.has(p) ? v.src : undefined}
              muted loop playsInline disablePictureInPicture preload="auto" aria-label={v.label}
              onCanPlay={resume(p)} onStalled={resume(p)} onPause={resume(p)} />
          </div>
        ))}
      </div>

      <div className={s.shade} />

      {n > view && (<>
        <button type="button" className={`${s.arrow} ${s.arrowLeft}`} onClick={() => go(-1)} aria-label="Previous video">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className={`${s.arrow} ${s.arrowRight}`} onClick={() => go(1)} aria-label="Next video">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </>)}
    </div>
  );
}
