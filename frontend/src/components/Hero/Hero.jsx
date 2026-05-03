import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStats } from '../../context/StatsContext';
import styles from './Hero.module.css';

const Hero = () => {
  const navigate = useNavigate();
  const stats = useStats();

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('in');
      });
    }, { threshold: 0.1 });

    const fades = document.querySelectorAll('.fade');
    fades.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <section className={styles.hero}>
      <div
        className={styles.hbg}
        style={{ backgroundImage: `url('/images/i9.png')` }}
      />
      <div className={styles.hgrad} />
      <div className={styles.hbot} />

      <div className={styles.hcontent}>
        <div className={`${styles.htag} fade`}>
          <div className={styles.hdot} />
          SOAC &middot; RK University &middot; Est. 2019
        </div>

        <h1 className={`${styles.hh1} fade delay-1`}>
          Your Campus.<br />Your Clubs. <span>Your Stage.</span>
        </h1>

        <p className={`${styles.hsub} fade delay-2`}>
          Join {stats.members?.toLocaleString()}+ students across {stats.clubs} clubs at RK University, Rajkot.
          From robotics to dance, sports to entrepreneurship &mdash; find your stage today.
        </p>

        <div className={`${styles.hctas} fade delay-3`}>
          <button className="btr" onClick={() => navigate('/clubs')}>
            Explore All Clubs &rarr;
          </button>
          <button className="btg" onClick={() => navigate('/login')}>
            Student Login
          </button>
        </div>

        <div className={`${styles.hstats} fade delay-4`}>
          <div className={styles.hs}>
            <div className={styles.hsn}>{stats.clubs}</div>
            <div className={styles.hsl}>Clubs</div>
          </div>
          <div className={styles.hs}>
            <div className={styles.hsn}>{stats.members?.toLocaleString()}+</div>
            <div className={styles.hsl}>Members</div>
          </div>
          <div className={styles.hs}>
            <div className={styles.hsn}>{stats.events}+</div>
            <div className={styles.hsl}>Events</div>
          </div>
          <div className={styles.hs}>
            <div className={styles.hsn}>{new Date().getFullYear() - 2019}+</div>
            <div className={styles.hsl}>Years</div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
