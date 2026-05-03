import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import s from './WallOfFame.module.css';

const WallOfFame = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/fame')
      .then(d => setItems(d.items || []))
      .catch(() => setError('Failed to load the Hall of Heroes.'))
      .finally(() => setLoading(false));
  }, []);

  if (error) return <div className={s.empty}>{error}</div>;

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={s.tag}>Hall of Excellence</div>
        <h1 className={s.title}>Wall of Fame</h1>
        <p className={s.sub}>
          Celebrating the extraordinary achievements of our students and clubs. 
          These legends have left an indelible mark on RK University.
        </p>
      </header>

      {loading ? (
        <div className={s.loading}>
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className={s.skeleton} />)}
        </div>
      ) : items.length === 0 ? (
        <div className={s.empty}>
          <h3>The wall is waiting for its first legend.</h3>
          <p>Check back soon for upcoming achievements!</p>
        </div>
      ) : (
        <div className={s.grid}>
          {items.map((item, idx) => (
            <div key={item.id} className={s.card} style={{ animationDelay: `${idx * 0.1}s` }}>
              <div className={s.imgBox}>
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} className={s.img} />
                ) : (
                  <div className={s.img} style={{ background: 'linear-gradient(45deg, #f1f5f9, #e2e8f0)', display:'flex', alignItems:'center', justifyContent:'center', fontSize: 40 }}>
                    {item.name.charAt(0)}
                  </div>
                )}
              </div>
              
              <div className={s.body}>
                <h3 className={s.name}>{item.name}</h3>
                <p className={s.achievement}>{item.achievement}</p>
                {item.description && <p className={s.desc}>{item.description}</p>}
                
                <div className={s.meta}>
                  {item.club_name && <span className={s.club}>{item.club_name}</span>}
                  <span className={s.year}>{item.term ? `${item.term} · ` : ''}{item.year}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WallOfFame;
