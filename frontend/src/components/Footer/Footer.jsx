import React from 'react';
import { Link } from 'react-router-dom';
import styles from './Footer.module.css';
const Footer = () => {
  return (
    <footer className={styles.footer}>
      <div className="wrap">
        <div className={styles.fgrid}>
          <div className={`${styles.fcol} ${styles.main}`}>
            <div className={styles.flogo}>
              <img src="/images/logo.png" alt="SOAC RKU" />
            </div>
            <p className={styles.description}>
              The central hub for all student organizations and extracurricular 
              activities at RK University.
            </p>
          </div>
          
          <div className={styles.fcol}>
            <h4>Platform</h4>
            <Link to="/clubs">Clubs Directory</Link>
            <Link to="/events">Events</Link>
            <Link to="/login">My Profile</Link>
          </div>
          
          <div className={styles.fcol}>
            <h4>University</h4>
            <a href="https://rku.ac.in" target="_blank" rel="noreferrer">RK University</a>
            <Link to="/about">About SOAC</Link>
            <Link to="/contact">Support</Link>
          </div>
          
          <div className={styles.fcol}>
            <h4>Social</h4>
            <a href="https://instagram.com" target="_blank" rel="noreferrer">Instagram</a>
            <a href="https://twitter.com" target="_blank" rel="noreferrer">Twitter</a>
            <a href="https://facebook.com" target="_blank" rel="noreferrer">Facebook</a>
          </div>
        </div>
        
        <div className={styles.fcopy}>
          &copy; 2024 SOAC | RK University. All rights reserved.
        </div>
      </div>
    </footer>
  );
};

export default Footer;
