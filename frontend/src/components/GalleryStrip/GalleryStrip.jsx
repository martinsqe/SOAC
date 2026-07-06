import React from 'react';
import styles from './GalleryStrip.module.css';

const GalleryStrip = () => {
  const images = [
    { src: '/images/gallery-1.png' },
    { src: '/images/gallery-2.png' },
    { src: '/images/gallery-3.png' },
    { src: '/images/gallery-4.png' },
    { src: '/images/gallery-5.png' },
    { src: '/images/gallery-6.png' },
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
