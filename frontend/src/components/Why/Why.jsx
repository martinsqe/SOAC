import React from 'react';
import styles from './Why.module.css';

const Why = ({ clubCount = 40 }) => {
  const features = [
    {
      title: 'Learn Beyond Class',
      desc: 'Build skills — from coding Android apps to leading NCC drills — that employers actually value.',
      icon: '🎓'
    },
    {
      title: 'Find Your People',
      desc: `${clubCount} clubs across 6 categories. There is a community for every student.`,
      icon: '🤝'
    },
    {
      title: 'Real Rewards',
      desc: 'Earn XP, SOAC Coins and badges. Top 3 coin holders per club get free annual re-registration.',
      icon: '🏆'
    },
    {
      title: 'Structured Growth',
      desc: 'Weekly schedules, assigned tasks, event calendars — so you always know your next step.',
      icon: '🗓️'
    },
    {
      title: 'Stay Connected',
      desc: 'Group chats, DMs, club news feeds and SOAC updates — all in one place.',
      icon: '💬'
    },
    {
      title: 'Campus Legacy',
      desc: 'The Wall of Fame is permanent. Your contributions recorded forever at RKU.',
      icon: '🌎'
    }
  ];

  return (
    <section className={styles.why}>
      <div className="wrap">
        <div className={styles.header}>
          <div className="tag" style={{ justifyContent: 'center' }}>Why SOAC</div>
          <h2 className="h2" style={{ textAlign: 'center', marginBottom: '12px' }}>
            More Than a Club. A Community.
          </h2>
          <p className={styles.headerSub}>
            SOAC gives you a place to grow, compete, create, and serve &mdash; with real rewards for real effort.
          </p>
        </div>
        
        <div className={styles.wgrid}>
          {features.map((item, i) => (
            <div key={i} className={`${styles.wc} fade delay-${(i % 4) + 1}`}>
              <div className={styles.wci}>{item.icon}</div>
              <h3>{item.title}</h3>
              <p>{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Why;
