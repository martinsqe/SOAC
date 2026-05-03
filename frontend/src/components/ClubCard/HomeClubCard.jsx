import s from './HomeClubCard.module.css';

const CAT_COLORS = {
  tech:      '#635BFF',
  sports:    '#FF4757',
  cultural:  '#FF6B9D',
  health:    '#00C896',
  community: '#4B6E2E',
};

const CAT_LABELS = {
  tech:      'Technology',
  sports:    'Sports',
  cultural:  'Cultural',
  health:    'Health',
  community: 'Community',
};

const HomeClubCard = ({ club, delay, onJoin, user }) => {
  const catColor = CAT_COLORS[club.cat] || club.color || '#635BFF';
  const catLabel = CAT_LABELS[club.cat] || club.cat || '';

  return (
    <div className={`${s.card} fade ${delay}`}>
      <div className={s.cardTop} style={{ background: club.color + '18', borderBottom: `2px solid ${club.color}30` }}>
        <span className={s.cardCat} style={{ background: catColor + '14', color: catColor }}>
          {catLabel}
        </span>
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
        {club.coord && (
          <div className={s.cardCoord}>👔 {club.coord} · Est. {club.yr}</div>
        )}
        <div className={s.cardStats}>
          <span style={{ color: '#635BFF' }}>👥 {club.members ?? '—'} members</span>
          <span style={{ color: '#00C896' }}>📅 {club.events ?? '—'} events</span>
        </div>
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
