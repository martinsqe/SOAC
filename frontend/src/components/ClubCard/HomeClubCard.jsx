import { useState } from 'react';
import s from './HomeClubCard.module.css';

/* Same categories and colours as the Clubs page */
const CAT_COLORS = {
  sports:   '#FF4757',
  cultural: '#FF6B9D',
  social:   '#06D6A0',
  academic: '#635BFF',
};

const CAT_LABELS = {
  sports:   'Sports',
  cultural: 'Cultural',
  social:   'Social',
  academic: 'Academic',
};

const HomeClubCard = ({ club, delay, onJoin, user }) => {
  const catColor = CAT_COLORS[club.cat] || club.color || '#635BFF';
  const catLabel = CAT_LABELS[club.cat] || club.cat || '';
  const [descOpen, setDescOpen] = useState(false);

  return (
    <div className={`${s.card} fade ${delay}`}>
      <div className={s.cardTop} style={{ background: club.color + '18', borderBottom: `2px solid ${club.color}30` }}>
        <span className={s.cardCat} style={{ background: catColor + '14', color: catColor }}>
          {catLabel}
        </span>
        {club.yr && <span className={s.cardEst}>Est. {club.yr}</span>}
        <div className={s.cardLogo}>
          <img
            src={club._apiLogo || `/logos/${club.logo}`}
            alt={club.name}
            loading="lazy"
            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
          />
          <div className={s.cardLogoFallback} style={{ background: club.color + '20', color: club.color }}>
            {club.name[0]}
          </div>
        </div>
      </div>

      <div className={s.cardBody}>
        <div className={s.cardName}>{club.name}</div>
        {/* Faculty Advisors — each line shown only once that campus has one assigned */}
        <div className={s.cardFAList}>
          {club.mainFA && <div className={s.cardFA}><strong>FA:</strong> {club.mainFA} (Main Campus)</div>}
          {club.cityFA && <div className={s.cardFA}><strong>FA:</strong> {club.cityFA} (City Campus)</div>}
        </div>
        {club.desc ? (
          <div className={s.cardDescWrap}>
            <span className={`${s.cardDesc} ${descOpen ? s.cardDescOpen : ''}`}>{club.desc}</span>
            <button type="button" className={s.readMoreBtn} onClick={() => setDescOpen(o => !o)}>
              {descOpen ? 'Show less' : 'Read more'}
            </button>
          </div>
        ) : club._id ? (
          <div className={s.cardDescEmpty}>No description added yet.</div>
        ) : null}
      </div>

      <div className={s.cardFoot}>
        {user ? (
          <button className={s.cardBtn} onClick={() => window.location.href = '/student/clubs'}>
            View My Clubs →
          </button>
        ) : (
          <button className={s.cardBtn} onClick={() => onJoin(club)}>
            Join Club →
          </button>
        )}
      </div>
    </div>
  );
};

export default HomeClubCard;
