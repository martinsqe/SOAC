import React from 'react';
import styles from './ClubCard.module.css';

const ClubCard = ({ image, category, title, description }) => {
  return (
    <div className={styles.card}>
      <div className={styles.imageArea}>
        <img src={image} alt={title} className={styles.image} />
      </div>
      <div className={styles.body}>
        <div className={styles.category}>{category}</div>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.desc}>{description}</p>
        <div className={styles.bottom}>
          <button className="bto">View Details</button>
        </div>
      </div>
    </div>
  );
};

export default ClubCard;
