import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './GuestGallery.module.css';

const GALLERY = [
  { url: '/images/gallery-1.png', label: 'Tech Fest 2024' },
  { url: '/images/gallery-2.png', label: 'Sports Meet' },
  { url: '/images/gallery-3.png', label: 'Cultural Night' },
  { url: '/images/gallery-4.png', label: 'Hackathon Wins' },
  { url: '/images/gallery-5.png', label: 'Club Meetup' },
  { url: '/images/gallery-6.png', label: 'Graduation Ceremony' },
  { url: '/images/i9.png', label: 'Workshop Session' },
  { url: '/images/i10.png', label: 'Community Service' },
  { url: '/images/i11.png', label: 'Design Sprint' },
  { url: '/images/i12.png', label: 'RoboWars Event' },
];

export default function GuestGallery() {
  const [openIndex, setOpenIndex] = useState(null);
  const touchX = useRef(null);

  /* Opening the lightbox pushes a history entry so the browser/mobile back
     button closes the lightbox instead of leaving the gallery page. */
  const openLightbox = (i) => {
    setOpenIndex(i);
    window.history.pushState({ lightbox: true }, '');
  };

  const close = useCallback(() => {
    if (window.history.state?.lightbox) window.history.back();
    else setOpenIndex(null);
  }, []);

  const goPrev = useCallback(() => {
    setOpenIndex(i => i === null ? null : (i - 1 + GALLERY.length) % GALLERY.length);
  }, []);

  const goNext = useCallback(() => {
    setOpenIndex(i => i === null ? null : (i + 1) % GALLERY.length);
  }, []);

  /* Browser/mobile back closes the lightbox and returns to the plain grid. */
  useEffect(() => {
    const onPopState = () => setOpenIndex(null);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  /* Keyboard navigation while the lightbox is open */
  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openIndex, close, goPrev, goNext]);

  /* Lock page scroll while the lightbox is open */
  useEffect(() => {
    if (openIndex === null) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [openIndex]);

  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) { dx < 0 ? goNext() : goPrev(); }
    touchX.current = null;
  };

  return (
    <>
    <div className="wrap" style={{ padding: '120px 0 80px' }}>
      <div style={{ textAlign: 'center', marginBottom: 60 }}>
        <h1 style={{ fontWeight: 900, fontSize: '2.5rem', marginBottom: 12 }}>Campus Life</h1>
        <p style={{ color: '#6b7280', maxWidth: 600, margin: '0 auto' }}>
          Explore the vibrant activities, events and achievements of our clubs at RK University.
          Capturing moments that define student life.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 24
      }}>
        {GALLERY.map((img, i) => (
          <div
            key={i}
            className={styles.tile}
            style={{
              borderRadius: 24, overflow: 'hidden',
              boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
              position: 'relative', height: 260
            }}
            onClick={() => openLightbox(i)}
            role="button"
            tabIndex={0}
            aria-label={`View ${img.label}`}
            onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && openLightbox(i)}
          >
            <img
              src={img.url}
              alt={img.label}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              padding: '24px 20px',
              background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
              color: '#fff', fontWeight: 700
            }}>
              {img.label}
            </div>
          </div>
        ))}
      </div>
    </div>

    {/* Portaled to document.body — the page wrapper has a page-transition CSS
       animation that leaves a `transform` set, which would otherwise trap this
       position:fixed overlay inside the page content instead of the viewport. */}
    {openIndex !== null && createPortal(
      <div className={styles.lightbox} onClick={close}>
        <button className={styles.closeBtn} onClick={(e) => { e.stopPropagation(); close(); }} aria-label="Close">
          ✕
        </button>
        <button
          className={`${styles.navBtn} ${styles.navBtnLeft}`}
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          aria-label="Previous image">
          ‹
        </button>
        <div
          className={styles.lightboxContent}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}>
          <img src={GALLERY[openIndex].url} alt={GALLERY[openIndex].label} className={styles.lightboxImg} />
          <div className={styles.lightboxCaption}>{GALLERY[openIndex].label}</div>
          <div className={styles.lightboxCounter}>{openIndex + 1} / {GALLERY.length}</div>
        </div>
        <button
          className={`${styles.navBtn} ${styles.navBtnRight}`}
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          aria-label="Next image">
          ›
        </button>
      </div>,
      document.body
    )}
    </>
  );
}
