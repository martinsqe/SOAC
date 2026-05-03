import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useStats } from '../../context/StatsContext';
import styles from './Home.module.css';

import Hero from '../../components/Hero/Hero';
import GalleryStrip from '../../components/GalleryStrip/GalleryStrip';
import Why from '../../components/Why/Why';
import FeatureBand from '../../components/FeatureBand/FeatureBand';
import HomeClubCard from '../../components/ClubCard/HomeClubCard';
import Steps from '../../components/Steps/Steps';
import JoinModal from '../../components/JoinModal/JoinModal';

const normal = 'normal'; // used for fontStyle inline prop

/* ── Static fallback (shown while API loads) ─────────── */
const STATIC_PREVIEW = [
  { logo: 'ZERO VIOLATION BASKETBALL CLUB.png', name: 'IRONCREED',             cat: 'sports',    color: '#FF4757', members: 72, events: 3, coord: 'Coach Ramesh Iyer',   yr: '2015' },
  { logo: 'ANDROID DEVLOPMENT CLUB.png',        name: 'Android Dev Club',      cat: 'tech',      color: '#3DDC84', members: 98, events: 4, coord: 'Prof. Anita Mehta',   yr: '2019' },
  { logo: 'BUMBLEBEEZ.png',                     name: 'Bumblebeez',            cat: 'cultural',  color: '#FFD166', members: 39, events: 3, coord: 'Prof. Kavya Menon',   yr: '2018' },
  { logo: 'RKU SHUTTLE SMASHERS.png',           name: 'Shuttle Smashers',      cat: 'sports',    color: '#00AADD', members: 60, events: 3, coord: 'Prof. Ritesh Patel',  yr: '2016' },
  { logo: 'RKU RANGERS.png',                    name: 'RKU Rangers FC',        cat: 'sports',    color: '#E25600', members: 84, events: 4, coord: 'Coach Devraj Singh',  yr: '2013' },
  { logo: 'SOUL OF MUSIC.png',                  name: 'Soul of Music',         cat: 'cultural',  color: '#FF9500', members: 68, events: 4, coord: 'Dr. Arjun Pillai',   yr: '2015' },
  { logo: 'CHANGE MAKERS E-CELL.png',           name: 'Change Makers E-Cell',  cat: 'tech',      color: '#FF9500', members: 87, events: 5, coord: 'Dr. Kiran Sharma',   yr: '2017' },
  { logo: 'THE KING OF 64.png',                 name: 'The King of 64',        cat: 'community', color: '#9CA3AF', members: 48, events: 3, coord: 'Prof. Mohan Rao',    yr: '2014' },
];

const normalise = (c) => ({
  logo:     c.logo || '',
  name:     c.name,
  cat:      c.category,
  color:    c.color || '#635BFF',
  members:  c.memberCount ?? 0,
  events:   c.eventCount  ?? 0,
  coord:    c.coordinator  || '',
  yr:       c.foundedYear  || '',
  _id:      c._id,
  _apiLogo: c.logoUrl || null,
});

const Home = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { clubs: clubCount } = useStats();

  const [previewClubs, setPreviewClubs] = useState(STATIC_PREVIEW);
  const [joiningClub,  setJoiningClub]  = useState(null);

  useEffect(() => {
    fetch('/api/clubs')
      .then(r => r.json())
      .then(d => {
        if (d.clubs?.length) {
          setPreviewClubs(d.clubs.slice(0, 8).map(normalise));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('in');
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('.fade').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.home}>
      <Hero />
      <GalleryStrip />
      <Why clubCount={clubCount} />
      <FeatureBand />

      <section className={styles.cprev}>
        <div className="wrap">
          <div className={styles.cpHeader}>
            <div>
              <div className="tag">{clubCount} Active Clubs</div>
              <h2 className="h2" style={{ marginBottom: '7px' }}>Find Your Community</h2>
              <p style={{ fontSize: '15px', color: 'var(--mid)' }}>
                A club for every interest, ambition and skill level.
              </p>
            </div>
            <button className="btr" onClick={() => navigate('/clubs')} style={{ flexShrink: 0 }}>
              View All {clubCount} &rarr;
            </button>
          </div>

          <div className={styles.cpgrid}>
            {previewClubs.map((club, i) => (
              <HomeClubCard
                key={i}
                club={club}
                delay={`delay-${(i % 4) + 1}`}
                user={user}
                onJoin={setJoiningClub}
              />
            ))}
          </div>
        </div>
      </section>

      <Steps />

      <section className={styles.ctaband}>
        <div className="wrap">
          <div className={`${styles.ctainner} fade`}>
            <h2>
              Ready to make the most of your time<br />
              at <em style={{ fontStyle: normal, opacity: 0.7 }}>RK University?</em>
            </h2>
            <div className={styles.ctabtns}>
              <button className={styles.btwh} onClick={() => navigate('/login')}>
                Login to SOAC
              </button>
              <button className={styles.btwho} onClick={() => navigate('/about')}>
                Learn More
              </button>
            </div>
          </div>
        </div>
      </section>

      {joiningClub && <JoinModal club={joiningClub} onClose={() => setJoiningClub(null)} />}
    </div>
  );
};

export default Home;
