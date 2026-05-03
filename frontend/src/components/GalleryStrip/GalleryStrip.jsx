import React from 'react';
import styles from './GalleryStrip.module.css';

const GalleryStrip = () => {
  const images = [
    { src: '/images/gallery-1.png', label: 'Annual Sports Meet' },
    { src: '/images/gallery-2.png', label: 'Tech Expo 2023' },
    { src: '/images/gallery-3.png', label: 'Cultural Fest' },
    { src: '/images/gallery-4.png', label: 'NCC Drill' },
    { src: '/images/gallery-5.png', label: 'IEEE Workshop' },
    { src: '/images/gallery-6.png', label: 'Health Awareness' },
  ];

  return (
    <div className={styles.gstrip}>
      {images.map((img, index) => (
        <div key={index} className={styles.gi}>
          <img src={img.src} alt={img.label} />
          <div className={styles.giov}>
            <span>{img.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default GalleryStrip;
