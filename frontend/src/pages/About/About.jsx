import { useState, useEffect, useRef, useCallback, useImperativeHandle } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './About.module.css';

/* ── static data ───────────────────────────────────── */
const objectives = [
  { icon: '', title: 'Academic & Cultural Growth', desc: 'Enhancement of academic, cultural, recreational, social and sports aspects of student life.' },
  { icon: '', title: 'Skill & Organisation', desc: 'Increase knowledge and skill in functioning within an organization.' },
  { icon: '', title: 'Personal Development', desc: 'Develop a positive attitude toward yourself, your peers, and the university community.' },
  { icon: '', title: 'Community Responsibility', desc: 'Promote awareness through conferences, activities and community service.' },
];

const studentAchievements = [
  { img: '/images/img6.png', title: 'Girls Basketball Final — Galore 2026', name: 'SOE vs SPT, SOE won back-to-back', desc: '', tag: '' },
  { img: '/images/i24.png', title: 'Witnessed one of the best Table Tennis games at RK University', name: 'Galore 2026', desc: '', tag: 'SOAC' },
  { img: '/images/i12.png', title: 'Cultural Dance — Galore 2026', name: 'Bumblebeez Dance Club', desc: 'Garba and classical fusion at Galore 2026, earning a standing ovation.', tag: 'Cultural' },
  { img: '/images/i18.png', title: 'Galore Inauguration Ceremony — 2026', name: 'Waving Flags', desc: '', tag: 'Leadership' },
  { img: '/images/img4.png', title: 'Basketball Championship — Galore 2026', name: 'Galore 2026', desc: 'SOP won.', tag: 'Sports' },
  { img: '/images/img7.png', title: 'Chess — Multiple Podiums 2025', name: 'The King of 64 Chess Club', desc: 'Three members in the top 5 simultaneously, one claiming the campus championship.', tag: 'Chess' },
  { img: '/images/img3.png', title: 'The Art Of Imagination', name: 'Putting your mind to reality', desc: '', tag: 'Art' },
  { img: '/images/i14.png', title: 'RKU Rangers — Inter-Department Football', name: 'Galore 2026', desc: 'SOP won Gold after winning in penalties.', tag: 'Football' },
];

const orgAchievements = [
  { img: '/images/i20.png', title: 'Galore 2026 — Annual Mega Fest', name: 'SOAC · RK University', desc: '7-day inter-college festival hosting 40+ clubs, 1,200+ participants and 25 competitive events.', tag: 'Annual Fest' },
  { img: '/images/i15.png', title: 'Guard of Honour — Galore Inauguration', name: 'NCC Wing · RK University', desc: 'NCC cadets led the ceremonial guard of honour at the official Galore 2026 opening ceremony.', tag: 'Ceremony' },
  { img: '/images/img2.png', title: 'Artistry Competition — Galore 2026', name: 'SOAC Creative Division', desc: 'Campus-wide art competition with 60+ participants showcasing painting, sketching and mixed media.', tag: 'Arts' },
  { img: '/images/i21.png', title: 'Rangoli Championship — Galore 2026', name: 'Cultural Committee · SOAC', desc: 'Traditional rangoli competition celebrating Indian art and heritage with intricate designs.', tag: 'Cultural' },
  { img: '/images/asset-6.png', title: 'Multi-Sport Championship — Galore 2026', name: 'Sports Division · SOAC', desc: 'Inter-club volleyball, cricket, football and basketball tournaments across 5 consecutive days.', tag: 'Sports' },
  { img: '/images/img8.png', title: 'Cricket League — Galore 2026', name: 'Rising Star Cricket Club · RKU', desc: 'Eight teams competed in a round-robin cricket league with over 300 spectators at the campus ground.', tag: 'Cricket' },
];

/*
 * TASK FORCE PHOTOS
 * To update a photo: replace the file at the path shown below.
 * Files live in:  public/images/team/
 * Supported formats: .jpg  .jpeg  .png  .webp
 * If a photo file is missing, the coloured initial circle shows instead.
 */
const taskForce = [
  { initial: 'D', name: 'Denish Patel', role: 'Co-Founder', photo: '/images/denish.png' },
  { initial: 'M', name: 'Mohit Patel', role: 'Co-Founder', photo: '/images/mohit.png' },
  { initial: 'S', name: 'Sagar Patel', role: 'Co-Founder', photo: '/images/sagar.png' },
  { initial: 'A', name: 'Ashwin Raiyani', role: 'Task Force', photo: '/images/ashwini.png' },
  { initial: 'D', name: 'Dhaval Pipaliya', role: 'Task Force', photo: '/images/dhaval.png' },
  { initial: 'P', name: 'Pravin Tirgar', role: 'Task Force', photo: '/images/pravin.png' },
  { initial: 'M', name: 'Mayur Visani', role: 'Task Force', photo: '/images/mayur.png' },
];

/* Combined sequence: org first, then students — carousel loops across both */
const ALL_ACHIEVEMENTS = [...orgAchievements, ...studentAchievements];
const ORG_COUNT = orgAchievements.length; // 6

/* ── Carousel ───────────────────────────────────────── */
const INTERVAL = 4000;

const Carousel = ({ items, onSlideChange, ref }) => {
  const [current, setCurrent] = useState(0);
  const [prevIdx, setPrevIdx] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef(null);
  const progRef = useRef(null);
  const startRef = useRef(null);

  /* expose jumpTo for tab buttons */
  useImperativeHandle(ref, () => ({
    jumpTo: (idx) => {
      setBusy(true);
      setPrevIdx(current);
      setCurrent(idx);
      setTimeout(() => { setPrevIdx(null); setBusy(false); }, 700);
    }
  }), [current]);

  /* notify parent which slide is active so tabs update automatically */
  useEffect(() => { onSlideChange?.(current); }, [current, onSlideChange]);

  const goTo = useCallback((idx) => {
    if (busy || idx === current) return;
    setBusy(true);
    setPrevIdx(current);
    setCurrent(idx);
    setTimeout(() => { setPrevIdx(null); setBusy(false); }, 700);
  }, [busy, current]);

  const next = useCallback(() => goTo((current + 1) % items.length), [goTo, current, items.length]);
  const prev = useCallback(() => goTo((current - 1 + items.length) % items.length), [goTo, current, items.length]);

  /* progress bar */
  const resetProgress = useCallback(() => {
    setProgress(0);
    cancelAnimationFrame(progRef.current);
    startRef.current = null;
    const tick = (ts) => {
      if (!startRef.current) startRef.current = ts;
      const pct = Math.min(((ts - startRef.current) / INTERVAL) * 100, 100);
      setProgress(pct);
      if (pct < 100) progRef.current = requestAnimationFrame(tick);
    };
    progRef.current = requestAnimationFrame(tick);
  }, []);

  /* auto-advance */
  useEffect(() => {
    resetProgress();
    timerRef.current = setTimeout(next, INTERVAL);
    return () => { clearTimeout(timerRef.current); cancelAnimationFrame(progRef.current); };
  }, [current, next, resetProgress]);

  /* preload */
  useEffect(() => {
    items.forEach(it => { const img = new Image(); img.src = it.img; });
  }, [items]);

  const item = items[current];

  return (
    <div className={styles.carousel}>
      {/* all slides stacked */}
      {items.map((it, i) => (
        <div
          key={it.img}
          className={`${styles.slide} ${i === current ? styles.slideCurrent :
            i === prevIdx ? styles.slidePrev : styles.slideHidden
            }`}
        >
          <img src={it.img} alt={it.title} loading="lazy" className={i === current ? styles.imgActive : styles.imgIdle} />
        </div>
      ))}

      {/* overlay gradient */}
      <div className={styles.carouselOverlay} />

      {/* caption */}
      <div className={`${styles.caption} ${styles.captionIn}`} key={current}>
        <h3 className={styles.capTitle}>{item.title}</h3>
        <p className={styles.capName}>{item.name}</p>
        <p className={styles.capDesc}>{item.desc}</p>
      </div>

      {/* counter */}
      <div className={styles.counter}>{String(current + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}</div>

      {/* buttons */}
      <button className={`${styles.navBtn} ${styles.navPrev}`} onClick={prev} aria-label="Previous">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <button className={`${styles.navBtn} ${styles.navNext}`} onClick={next} aria-label="Next">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
      </button>

      {/* dots */}
      <div className={styles.dots}>
        {items.map((_, i) => (
          <button key={i} onClick={() => goTo(i)} className={`${styles.dot} ${i === current ? styles.dotOn : ''}`} aria-label={`Slide ${i + 1}`} />
        ))}
      </div>

      {/* progress bar */}
      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
};

/* ── main page ──────────────────────────────────────── */
const About = () => {
  const navigate = useNavigate();
  const carouselRef = useRef(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const activeTab = currentIdx < ORG_COUNT ? 'org' : 'student';

  const handleTabClick = (tab) => {
    carouselRef.current?.jumpTo(tab === 'org' ? 0 : ORG_COUNT);
  };

  useEffect(() => {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); });
    }, { threshold: 0.1 });
    document.querySelectorAll('.fade').forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <div className={styles.about}>

      {/* ── HERO ── */}
      <div className={styles.ahero}>
        <div className="wrap" style={{ position: 'relative', zIndex: 1 }}>
          <div className="tag" style={{ color: 'rgba(255,120,120,.8)' }}>About SOAC</div>
          <h1 className={`${styles.aheroTitle} fade`}>Student Organizations<br />Advisory Council</h1>
          <p className={`${styles.aheroSub} fade`}>The official body governing all student-run organizations at RKU.</p>
          <div className={`${styles.aheroBadges} fade`}>
            <span className={styles.badge}>🏛️ University Recognised</span>
            <span className={styles.badge}>📋 40 Active Clubs</span>
            <span className={styles.badge}>🎓 Est. 2019</span>
            <span className={styles.badge}>🏆 50+ Events / Year</span>
          </div>
        </div>
      </div>

      {/* ── WHAT IS SOAC ── */}
      <div className={styles.whatSection}>
        <div className="wrap">
          <div className={`${styles.a2col} fade`}>
            <div className={styles.istack}>
              <div className={styles.imm}>
                <img src="/images/i19.png" alt="SOAC Event" loading="lazy" />
              </div>
            </div>
            <div>
              <div className="tag">  LOOKING FORWARD TO </div>
              <h2 className="h2" style={{ marginBottom: '16px' }}>Building Leaders<br />One Club at a Time</h2>
              <p style={{ fontSize: '16px', lineHeight: 1.75, color: 'var(--mid)', marginBottom: '13px' }}>
                RKU believes that student-led organizations enhance education by providing opportunities beyond the curriculum for personal development, leadership, and growth.
              </p>
              <p style={{ fontSize: '14px', color: 'var(--muted)', lineHeight: 1.75 }}>
                SOAC assists students in developing organizations, planning events, provides financial guidance, and authorizes use of University resources.
              </p>
              <div className={styles.featList}>
                {[
                  { icon: '🎓', title: 'Beyond the Classroom', desc: 'Interpersonal, organizational and leadership skills in a real environment.' },
                  { icon: '🏛️', title: 'University Recognised', desc: 'Every SOAC club has formal recognition, resources and advisory support.' },
                  { icon: '🏆', title: 'Rewarded Participation', desc: 'XP, Coins, badges, and free re-registration for top performers each year.' },
                ].map((f, i) => (
                  <div key={i} className={styles.featRow}>
                    <div className={styles.featIcon}>{f.icon}</div>
                    <div>
                      <div className={styles.featTitle}>{f.title}</div>
                      <div className={styles.featDesc}>{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── OBJECTIVES ── */}
      <div className={styles.aobj}>
        <div className="wrap">
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <div className="tag" style={{ color: 'rgba(255,120,120,.8)', justifyContent: 'center' }}>Objectives</div>
            <h2 className="h2" style={{ color: '#fff', textAlign: 'center', marginBottom: '10px' }}>What SOAC Stands For</h2>
          </div>
          <div className={`${styles.aobjgrid} fade`}>
            {objectives.map((obj, i) => (
              <div key={i} className={styles.oc}>
                <div className={styles.oci}>{obj.icon}</div>
                <h3>{obj.title}</h3>
                <p>{obj.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── ACHIEVEMENTS ── */}
      <div className={styles.ach}>
        <div className="wrap">
          <div className={styles.achHeader}>
            <div>
              <div className="tag">Achievements</div>
              <h2 className="h2" style={{ marginBottom: '7px' }}>Our Proudest Moments</h2>
            </div>
            <div className={styles.atabs}>
              <button className={`${styles.at} ${activeTab === 'org' ? styles.atOn : ''}`} onClick={() => handleTabClick('org')}>🏛️ Organisation</button>
              <button className={`${styles.at} ${activeTab === 'student' ? styles.atOn : ''}`} onClick={() => handleTabClick('student')}>🎓 Students</button>
            </div>
          </div>
          <Carousel ref={carouselRef} items={ALL_ACHIEVEMENTS} onSlideChange={setCurrentIdx} />
        </div>
      </div>

      {/* ── TASK FORCE ── */}
      <div className={styles.tf}>
        <div className="wrap">
          <div style={{ textAlign: 'center', marginBottom: '36px' }}>
            <div className="tag" style={{ justifyContent: 'center' }}>The Founders</div>
            <h2 className="h2" style={{ textAlign: 'center', marginBottom: '8px' }}>SOAC Task Force</h2>
            <p style={{ fontSize: '14px', color: 'var(--muted)', textAlign: 'center' }}>
              Conceived and built by these dedicated individuals at RK University.
            </p>
          </div>
          <div className={`${styles.tfgrid} fade`}>
            {taskForce.map((p, i) => (
              <div key={i} className={styles.tfc}>
                <div className={styles.tfframe}>
                  <img
                    src={p.photo}
                    alt={p.name}
                    className={styles.tfphoto}
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                  />
                  <div className={styles.tfav} style={{ display: 'none' }}>{p.initial}</div>
                </div>
                <div className={styles.tfname}>{p.name}</div>
                <div className={`${styles.tfrole} ${p.role === 'Co-Founder' ? styles.tfroleRed : ''}`}>{p.role}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── HIERARCHY ── */}
      <div className={styles.hierarchy}>
        <div className="wrap">
          <div style={{ textAlign: 'center', marginBottom: '52px' }}>
            <div className="tag" style={{ justifyContent: 'center' }}>Consultation Hierarchy</div>
            <h2 className="h2" style={{ textAlign: 'center', marginBottom: '10px' }}>Who to Approach at SOAC</h2>
            <p style={{ fontSize: '15px', color: 'var(--muted)', textAlign: 'center', maxWidth: '520px', margin: '0 auto', lineHeight: 1.7 }}>
              Every student has a clear path to get support. Here's the hierarchy for one club — the same structure applies across all 40 SOAC clubs.
            </p>
          </div>
          <div className={styles.htree}>
            <div className={styles.hspine} />
            <div className={styles.hlevel}>
              <div className={`${styles.hcard} ${styles.hcardRed}`}>
                <div className={`${styles.hav} ${styles.havRed}`}>🏆</div>
                <div className={styles.hcardTitle}>Head of SOAC</div>
                <div className={`${styles.hcardRole} ${styles.hroleRed}`}>Highest Authority</div>
                <p className={styles.hcardDesc}>Final escalation point for all club-related matters. Oversees all 40 clubs and SOAC operations at RKU.</p>
                <div className={styles.hcardLoc}>📍 Admin Block, Room 101</div>
              </div>
            </div>
            <div className={styles.hconnector} />
            <div className={styles.hlevel}>
              <div className={`${styles.hcard} ${styles.hcardGreen}`}>
                <div className={`${styles.hav} ${styles.havGreen}`}>📋</div>
                <div className={styles.hcardTitle}>Club Coordinator</div>
                <div className={`${styles.hcardRole} ${styles.hroleGreen}`}>e.g. Android Development Club</div>
                <p className={styles.hcardDesc}>Your primary contact for club activities, event planning, attendance, task assignments and day-to-day club operations.</p>
                <div className={styles.hcardTags}>
                  {['Events', 'Attendance', 'Tasks', 'Join Requests'].map(t => (
                    <span key={t} className={`${styles.htag} ${styles.htagGreen}`}>{t}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className={styles.hconnector} />
            <div className={styles.hlevel3}>
              <div className={`${styles.hcard} ${styles.hcardPurple}`}>
                <div className={`${styles.hav} ${styles.havPurple}`}>💰</div>
                <div className={styles.hcardTitle}>Club Treasurer</div>
                <div className={`${styles.hcardRole} ${styles.hrolePurple}`}>Finance & Budget</div>
                <p className={styles.hcardDesc}>Manages club funds, budgets for events, handles registration fees and financial records.</p>
                <div className={styles.hcardTags}>
                  {['Fees', 'Budget', 'Records'].map(t => (
                    <span key={t} className={`${styles.htag} ${styles.htagPurple}`}>{t}</span>
                  ))}
                </div>
              </div>
              <div className={`${styles.hcard} ${styles.hcardBlue}`}>
                <div className={`${styles.hav} ${styles.havBlue}`}>🤝</div>
                <div className={styles.hcardTitle}>Co-coordinator</div>
                <div className={`${styles.hcardRole} ${styles.hroleBlue}`}>Operations Support</div>
                <p className={styles.hcardDesc}>Assists the coordinator with member management, event logistics and communication.</p>
                <div className={styles.hcardTags}>
                  {['Members', 'Logistics', 'Comms'].map(t => (
                    <span key={t} className={`${styles.htag} ${styles.htagBlue}`}>{t}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className={styles.hconnector} />
            <div className={styles.hlevel}>
              <div className={`${styles.hcard} ${styles.hcardDark}`}>
                <div className={`${styles.hav} ${styles.havDark}`}>🎓</div>
                <div className={styles.hcardTitle}>Club Members</div>
                <div className={`${styles.hcardRole} ${styles.hroleDark}`}>You</div>
                <p className={styles.hcardDesc}>Attend sessions, earn XP & coins, participate in events, and grow through the club experience.</p>
                <div className={styles.hcardTags}>
                  {['Attend', 'Earn XP', 'Compete', 'Grow'].map(t => (
                    <span key={t} className={`${styles.htag} ${styles.htagDark}`}>{t}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── CTA ── */}
      <div className={styles.aboutCta}>
        <div className="wrap">
          <div className={`${styles.ctaInner} fade`}>
            <h2>Ready to be part of something bigger?</h2>
            <p>Join 1,200+ students already building their legacy at RK University.</p>
            <div className={styles.ctaBtns}>
              <button className={styles.ctaBtnWh} onClick={() => navigate('/login')}>Login to SOAC</button>
              <button className={styles.ctaBtnGhost} onClick={() => navigate('/clubs')}>Explore Clubs</button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default About;
