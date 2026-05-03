import React from 'react';
import styles from './ClubLogo.module.css';
const ClubLogo = ({ logo, size = 36, className = '' }) => {
  const logoPath = `/logos/${logo}`;

  return (
    <div 
      className={`${styles.logoCage} ${className}`}
      style={{
        width: `${size + 4}px`,
        height: `${size + 4}px`
      }}
    >
      <img 
        src={logoPath} 
        alt={logo} 
        className={styles.logoImg}
        onError={(e) => {
          e.target.src = '/images/logo.png'; // Fallback to main logo if club logo missing
        }}
        style={{
          width: `${size}px`,
          height: `${size}px`
        }}
      />
    </div>
  );
};

export default ClubLogo;
