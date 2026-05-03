import React from 'react';
import styles from './Stats.module.css';

const Stats = () => {
  const statsList = [
    { value: '25+', label: 'Active Clubs' },
    { value: '150+', label: 'Events Yearly' },
    { value: '5000+', label: 'Student Members' },
    { value: '10+', label: 'Categories' }
  ];

  return (
    <section className={styles.stats}>
      <div className="wrap">
        <div className={styles.grid}>
          {statsList.map((stat, i) => (
            <div key={i} className={`${styles.item} fade delay-${i + 1}`}>
              <div className={styles.value}>{stat.value}</div>
              <div className={styles.label}>{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Stats;
