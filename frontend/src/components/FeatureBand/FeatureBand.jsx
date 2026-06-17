import React from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './FeatureBand.module.css';
const FeatureBand = () => {
  const navigate = useNavigate();

  return (
    <section className={styles.fband}>
      <div className={styles.fbi}>
        <img src="/images/img6.png" alt="SOAC Platform" loading="lazy" />
      </div>
      
      <div className={styles.fbc}>
        <div className="tag" style={{ color: 'rgba(255,120,120,.8)' }}>
          The SOAC Platform
        </div>
        <h2 className="h2" style={{ color: '#fff', marginBottom: '16px' }}>
          One Portal.<br />Every Club Feature.
        </h2>
        <p className={styles.description}>
          Your complete student life hub &mdash; from joining clubs and tracking tasks 
          to earning XP, coins, and chatting with your team.
        </p>

        <div className={styles.fblist}>
          <div className={styles.fbrow}>
            <div className={styles.fbic}>⚡</div>
            <div className={styles.fbtx}>
              <h4>XP &amp; Leveling System</h4>
              <p>Complete Tasks, Compete, witness real Growth.</p>
            </div>
          </div>
          <div className={styles.fbrow}>
            <div className={styles.fbic}>🪙</div>
            <div className={styles.fbtx}>
              <h4>SOAC Coins &amp; Free Registration</h4>
              <p>Top 3 per club earn free annual re-registration.</p>
            </div>
          </div>
          <div className={styles.fbrow}>
            <div className={styles.fbic}>💬</div>
            <div className={styles.fbtx}>
              <h4>Club Chat &amp; DMs</h4>
              <p>Group chats and direct messages with coordinators.</p>
            </div>
          </div>
          <div className={styles.fbrow}>
            <div className={styles.fbic}>🏆</div>
            <div className={styles.fbtx}>
              <h4>Wall of Fame</h4>
              <p>A permanent record of your achievements.</p>
            </div>
          </div>
        </div>

        <div style={{ marginTop: '26px' }}>
          <button className="btr" onClick={() => navigate('/login')}>
            Access the Platform &rarr;
          </button>
        </div>
      </div>
    </section>
  );
};

export default FeatureBand;
