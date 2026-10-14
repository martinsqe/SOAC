import { useEffect, useState } from 'react';
import s from './HeroCarousel.module.css';

/* Photo carousel for a dark page header (Clubs, Events): the photos fill the right
   side edge to edge with sharp corners, and a black fade from the left keeps the
   heading readable — the same feel as the home page hero. No captions or dots.
   The header needs `position: relative; overflow: hidden`, and its text a z-index
   of 2 so it sits above the fade.
     slides: [{ src, caption }] — caption is used as the image's alt text */
const INTERVAL = 4500;

export default function HeroCarousel({ slides }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || slides.length < 2) return undefined;
    const t = setTimeout(() => setIndex(i => (i + 1) % slides.length), INTERVAL);
    return () => clearTimeout(t);
  }, [index, paused, slides.length]);

  /* preload so slide changes never flash */
  useEffect(() => { slides.forEach(sl => { const img = new Image(); img.src = sl.src; }); }, [slides]);

  return (
    <>
      <div className={s.carousel} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        {slides.map((sl, i) => (
          <img key={`${sl.src}-${i}`} src={sl.src} alt={sl.caption || ''}
            className={`${s.img} ${i === index ? s.on : ''}`} aria-hidden={i !== index} />
        ))}
      </div>
      <div className={s.fade} />
    </>
  );
}
