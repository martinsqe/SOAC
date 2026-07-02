import React, { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import s from './WallOfFame.module.css';

const CAT_COLORS = {
  Tech:     { bg: 'rgba(219,234,254,.92)', text: '#1d4ed8' },
  Sports:   { bg: 'rgba(220,252,231,.92)', text: '#15803d' },
  Cultural: { bg: 'rgba(255,237,213,.92)', text: '#c2410c' },
  Social:   { bg: 'rgba(253,232,247,.92)', text: '#be185d' },
  Academic: { bg: 'rgba(204,251,241,.92)', text: '#0f766e' },
  General:  { bg: 'rgba(237,233,254,.92)', text: '#5b21b6' },
};

const RANK_MEDAL = ['🥇', '🥈', '🥉'];

const FameCard = ({ item, idx }) => {
  const photos  = [item.imageUrl, ...(item.gallery || [])].filter(Boolean);
  const [cur, setCur] = useState(0);
  const touchX  = useRef(null);
  const cat     = CAT_COLORS[item.category] || CAT_COLORS.General;
  const medal   = RANK_MEDAL[idx];

  const atStart = cur === 0;
  const atEnd   = cur === photos.length - 1;

  const prev = (e) => { e.stopPropagation(); setCur(i => Math.max(0, i - 1)); };
  const next = (e) => { e.stopPropagation(); setCur(i => Math.min(photos.length - 1, i + 1)); };

  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd   = (e) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) {
      if (dx < 0) setCur(i => Math.min(photos.length - 1, i + 1));
      else        setCur(i => Math.max(0, i - 1));
    }
    touchX.current = null;
  };

  const rankClass = idx === 0 ? s.rank1 : idx === 1 ? s.rank2 : idx === 2 ? s.rank3 : '';

  return (
    <article
      className={`${s.card} ${rankClass}`}
      style={{ animationDelay: `${Math.min(idx, 9) * 0.07}s` }}
    >
      {/* ── Photo carousel ── */}
      <div className={s.photoBox} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {photos.length > 0 ? (
          <img
            src={photos[cur]}
            alt={`${item.name} — ${item.achievement}`}
            className={s.photo}
          />
        ) : (
          <div className={s.photoInit}>{item.name.charAt(0)}</div>
        )}

        {/* Photo counter */}
        {photos.length > 1 && (
          <span className={s.photoCounter}>{cur + 1} / {photos.length}</span>
        )}

        {/* Nav arrows */}
        {photos.length > 1 && (
          <>
            {!atStart && (
              <button className={`${s.navBtn} ${s.navL}`} onClick={prev} aria-label="Previous">
                &#8249;
              </button>
            )}
            {!atEnd && (
              <button className={`${s.navBtn} ${s.navR}`} onClick={next} aria-label="Next">
                &#8250;
              </button>
            )}
            <div className={s.dots} aria-hidden="true">
              {photos.map((_, i) => (
                <span
                  key={i}
                  className={`${s.dot}${i === cur ? ` ${s.dotOn}` : ''}`}
                  onClick={e => { e.stopPropagation(); setCur(i); }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Card body ── */}
      <div className={s.body}>
        {/* Achievement label first for visual impact */}
        <p className={s.ach}>{item.achievement}</p>
        <h3 className={s.name}>{item.name}</h3>
        {item.description && <p className={s.desc}>{item.description}</p>}
        {(item.club_name || item.term || item.year) && (
          <div className={s.footer}>
            {item.club_name && <span className={s.club}>{item.club_name}</span>}
            {(item.term || item.year) && (
              <span className={s.year}>
                {[item.term, item.year].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
};

export default function WallOfFame() {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    api.get('/fame')
      .then(d => setItems(d.items || []))
      .catch(() => setError('Failed to load the Wall of Fame.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={s.page}>

      <header className={s.header}>
        <span className={s.trophyIcon} aria-hidden="true">🏆</span>
        <div className={s.eyebrow}>Hall of Excellence</div>
        <h1 className={s.title}>Wall of Fame</h1>
        <p className={s.sub}>
          Celebrating the extraordinary achievements of our students and clubs.
          These legends have left an indelible mark on RK University.
        </p>
        {!loading && items.length > 0 && (
          <div className={s.headerCount}>
            <span className={s.headerCountDot} />
            {items.length} {items.length === 1 ? 'honoree' : 'honorees'} recognized
          </div>
        )}
      </header>

      {loading ? (
        <div className={s.skeletonGrid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={s.skeleton} style={{ animationDelay: `${i * 0.1}s` }} />
          ))}
        </div>
      ) : error ? (
        <div className={s.empty}>
          <span className={s.emptyIcon} aria-hidden="true">🏆</span>
          <div className={s.emptyTitle}>Something went wrong</div>
          <p className={s.emptySub}>{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className={s.empty}>
          <span className={s.emptyIcon} aria-hidden="true">🏆</span>
          <div className={s.emptyTitle}>The wall awaits its first legend.</div>
          <p className={s.emptySub}>
            Extraordinary achievements are on their way — check back soon.
          </p>
        </div>
      ) : (
        <div className={s.grid}>
          {items.map((item, idx) => (
            <FameCard key={item.id} item={item} idx={idx} />
          ))}
        </div>
      )}

    </div>
  );
}
