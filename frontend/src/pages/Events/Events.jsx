import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styles from './Events.module.css';
import { useAuth } from '../../context/AuthContext';
import {
  SPORT_CFG, SPORTS_LIST, winner, fmtDate, fetchPublicJson,
} from '../../lib/sportsScores';

/* ── Event data ──────────────────────────────────────── */
const EVENTS = [
  // UPCOMING
  {
    id: 1,
    status: 'upcoming',
    cat: 'annual-fest',
    title: 'Galore 2027 — Annual Mega Fest',
    club: 'SOAC · RK University',
    date: 'Feb 2–8, 2027',
    time: '9:00 AM onwards',
    venue: 'RKU Main Campus',
    desc: '7-day inter-college festival with 40+ clubs, 1,400+ participants, sports championships, cultural competitions and the grand Galore Concert.',
    img: '/images/i20.png',
    tags: ['Mega Fest', '7 Days', 'All Clubs'],
    seats: 'Open Registration',
  },
  {
    id: 2,
    status: 'upcoming',
    cat: 'sports',
    title: 'RKU Sports Fiesta 2026',
    club: 'Sports Division · SOAC',
    date: 'Nov 14–17, 2026',
    time: '8:00 AM',
    venue: 'RKU Sports Ground',
    desc: 'Four-day multi-sport championship covering basketball, football, volleyball, cricket, badminton and table tennis.',
    img: '/images/asset-6.png',
    tags: ['Sports', '4 Days', 'Inter-College'],
    seats: '240 seats left',
  },
  {
    id: 3,
    status: 'upcoming',
    cat: 'cultural',
    title: 'Rhythm & Soul — Music Night',
    club: 'Soul of Music · SOAC',
    date: 'Oct 4, 2026',
    time: '6:30 PM',
    venue: 'Amphitheatre, RKU',
    desc: "An acoustic evening featuring live performances by RKU's top vocalists and instrumentalists.",
    img: '/images/asset-8.png',
    tags: ['Music', 'Live', 'Cultural'],
    seats: '180 seats left',
  },
  {
    id: 4,
    status: 'upcoming',
    cat: 'tech',
    title: 'Code Sprint — 24-Hour Hackathon',
    club: 'Change Makers E-Cell · Android Club',
    date: 'Sep 20–21, 2026',
    time: '10:00 AM (24hr)',
    venue: 'CS Lab Block, RKU',
    desc: 'Build real solutions in 24 hours. Prizes, mentors, and fast-track internship offers for top 3 teams.',
    img: '/images/i23.png',
    tags: ['Tech', '24hr', 'Prizes'],
    seats: '90 seats left',
  },
  {
    id: 5,
    status: 'upcoming',
    cat: 'cultural',
    title: 'Rangoli & Artistry Championship',
    club: 'Cultural Committee · SOAC',
    date: 'Oct 19, 2026',
    time: '10:00 AM',
    venue: 'Open Courtyard, RKU',
    desc: 'Campus-wide art and rangoli competition celebrating Indian heritage with individual and group categories.',
    img: '/images/i22.png',
    tags: ['Art', 'Cultural', 'Heritage'],
    seats: '120 seats left',
  },
  {
    id: 6,
    status: 'upcoming',
    cat: 'leadership',
    title: 'MUN Summit — SETU 2026',
    club: 'SETU — MUN · SOAC',
    date: 'Nov 1–2, 2026',
    time: '9:00 AM',
    venue: 'Conference Hall, RKU',
    desc: 'Two-day Model UN with 8 committees, 300+ delegates, and keynotes from diplomacy professionals.',
    img: '/images/i16.png',
    tags: ['MUN', '2 Days', 'Leadership'],
    seats: '300 seats left',
  },

  // PAST
  {
    id: 7,
    status: 'past',
    cat: 'annual-fest',
    title: 'Galore 2026 — Annual Mega Fest',
    club: 'SOAC · RK University',
    date: 'Feb 2–8, 2026',
    img: '/images/i19.png',
    tags: ['Mega Fest', '1,200+ Students'],
    highlight: '🏆 Best Edition Yet',
  },
  {
    id: 8,
    status: 'past',
    cat: 'sports',
    title: 'Basketball Championship — Galore 2026',
    club: 'IRONCREED · Sports Division',
    date: 'Feb 4–5, 2026',
    img: '/images/img5.png',
    tags: ['Sports', 'Basketball'],
    highlight: '🥇 IRONCREED Champions',
  },
  {
    id: 9,
    status: 'past',
    cat: 'cultural',
    title: 'Dance Finals — Galore 2026',
    club: 'Bumblebeez Dance Club',
    date: 'Feb 7, 2026',
    img: '/images/i11.png',
    tags: ['Dance', 'Cultural'],
    highlight: '🎭 Standing Ovation',
  },
  {
    id: 10,
    status: 'past',
    cat: 'cultural',
    title: 'Singing Finals — Galore 2026',
    club: 'Soul of Music · SOAC',
    date: 'Feb 6, 2026',
    img: '/images/asset-34.jpeg',
    tags: ['Singing', 'Cultural'],
    highlight: '🎤 500+ Audience',
  },
  {
    id: 11,
    status: 'past',
    cat: 'sports',
    title: 'Cricket League — Galore 2026',
    club: 'Rising Star Cricket Club',
    date: 'Feb 2–7, 2026',
    img: '/images/img8.png',
    tags: ['Cricket', 'Sports'],
    highlight: '🏏 Super Over Final',
  },
  {
    id: 12,
    status: 'past',
    cat: 'leadership',
    title: 'Public Speaking Finals — Galore 2026',
    club: 'SETU · SOAC',
    date: 'Feb 5, 2026',
    img: '/images/i23.png',
    tags: ['Speaking', 'Leadership'],
    highlight: '🎙️ 16 Finalists',
  },
  {
    id: 13,
    status: 'past',
    cat: 'annual-fest',
    title: 'Galore 2024 — Annual Mega Fest',
    club: 'SOAC · RK University',
    date: 'Feb 2024',
    img: '/images/asset-1.png',
    tags: ['Mega Fest', 'Galore 2024'],
    highlight: '🎪 Where It All Began',
  },
  {
    id: 14,
    status: 'past',
    cat: 'sports',
    title: 'Volleyball Championship — Sports Fiesta \'25',
    club: 'RKU Volley Avengers · SOAC',
    date: 'Sports Fiesta 2025',
    img: '/images/asset-39.jpeg',
    tags: ['Volleyball', 'Sports Fiesta'],
    highlight: '🏐 Nail-Biting Finals',
  },
  {
    id: 15,
    status: 'past',
    cat: 'cultural',
    title: 'Echoes of Independence — Dance Day 2024',
    club: 'Bumblebeez · SOAC',
    date: 'Aug 13, 2024',
    img: '/images/asset-5.png',
    tags: ['Dance', 'Independence Day'],
    highlight: '🇮🇳 Patriotic Tribute',
  },
  {
    id: 16,
    status: 'past',
    cat: 'sports',
    title: 'Girls Basketball — Sports Fiesta \'25',
    club: 'IRONCREED · Sports Division',
    date: 'Sports Fiesta 2025',
    img: '/images/asset-33.jpeg',
    tags: ['Basketball', 'Women\'s Sport'],
    highlight: '🏀 Women Champions',
  },
  {
    id: 17,
    status: 'past',
    cat: 'tech',
    title: 'E-Cell Entrepreneurship Fair',
    club: 'Change Makers E-Cell · SOAC',
    date: '2025',
    img: '/images/asset-10.png',
    tags: ['E-Cell', 'Startups', 'Innovation'],
    highlight: '💡 20+ Student Stalls',
  },
  {
    id: 18,
    status: 'past',
    cat: 'cultural',
    title: 'Holi Celebration 2024',
    club: 'SOAC · RK University',
    date: 'Mar 2024',
    img: '/images/asset-40.jpeg',
    tags: ['Holi', 'Festival', 'Cultural'],
    highlight: '🌈 Campus-Wide Colour Fest',
  },
  {
    id: 19,
    status: 'past',
    cat: 'sports',
    title: 'Table Tennis Championship — Sports Fiesta \'25',
    club: 'Sports Division · SOAC',
    date: 'Sports Fiesta 2025',
    img: '/images/i24.png',
    tags: ['Table Tennis', 'Sports Fiesta'],
    highlight: '🏓 24 Players Competed',
  },
  {
    id: 20,
    status: 'past',
    cat: 'cultural',
    title: 'Theatre & Mime — Galore 2026',
    club: 'Rang Manch · SOAC',
    date: 'Feb 2026',
    img: '/images/asset-11.png',
    tags: ['Theatre', 'Mime', 'Galore'],
    highlight: '🎭 Crowd Favourite',
  },
];

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'annual-fest', label: 'Annual Fest' },
  { key: 'sports', label: 'Sports' },
  { key: 'cultural', label: 'Cultural' },
  { key: 'tech', label: 'Tech' },
  { key: 'leadership', label: 'Leadership' },
];

const CAT_COLOR = {
  'annual-fest': '#D32F2F',
  sports: '#FF4757',
  cultural: '#FF6B9D',
  tech: '#635BFF',
  leadership: '#4B6E2E',
};

const GALLERY = [
  '/images/i9.png',
  '/images/asset-32.jpeg',
  '/images/img3.png',
  '/images/i13.png',
  '/images/asset-35.jpeg',
  '/images/img4.png',
  '/images/asset-30.jpeg',
  '/images/i18.png',
  '/images/asset-28.jpeg',
];

/* ── Main Events Page ────────────────────────────────── */
/* Normalise API event to match existing component shape */
const normaliseEvent = (e) => ({
  id: e._id,
  status: e.status,
  cat: e.category,
  title: e.title,
  club: e.club,
  date: e.date,
  time: e.time,
  venue: e.venue,
  desc: e.description,
  img: e.imageUrl || (e.image ? `/images/${e.image}` : '/images/i20.png'),
  tags: e.tags || [],
  seats: e.seats,
  highlight: e.highlight,
});

const DEPTS = ['ACH', 'AI/ML', 'FOT', 'SOE', 'SOM', 'SOP', 'SPT', 'SDS', 'SOS'];
const EMPTY_FORM = { name: '', enrollmentNo: '', dept: '', course: '', phone: '', email: '', gender: '' };

const Events = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [filter, setFilter] = useState('all');
  const [events, setEvents] = useState(EVENTS); // start with static data
  const [liveCount, setLiveCount]         = useState(0);

  /* ── Past records (collapsed until opened) ── */
  const [pastOpen, setPastOpen]           = useState(false);
  const [pastScores, setPastScores]       = useState([]);
  const [pastTotal, setPastTotal]         = useState(0);
  const [pastPage, setPastPage]           = useState(1);
  const [pastSearch, setPastSearch]       = useState('');
  const [pastSport, setPastSport]         = useState('all');
  const [pastLoading, setPastLoading]     = useState(false);
  const [pastSearchInput, setPastSearchInput] = useState('');
  const [statsModal, setStatsModal]       = useState(null);

  /* ── Registration modal state ── */
  const [regModal, setRegModal] = useState(null);   // null | { id, title }
  const [regForm, setRegForm] = useState(EMPTY_FORM);
  const [regErr, setRegErr] = useState({});
  const [regApi, setRegApi] = useState('');     // api-level error
  const [regDone, setRegDone] = useState(false);  // success screen
  const [regLoading, setRegLoading] = useState(false);

  const openReg = (ev) => {
    setRegModal({ id: ev.id, title: ev.title });
    setRegForm(user
      ? { ...EMPTY_FORM, name: user.name || '', email: user.email || '' }
      : EMPTY_FORM
    );
    setRegErr({});
    setRegApi('');
    setRegDone(false);
  };
  const closeReg = () => setRegModal(null);

  const sf = (k) => (e) => setRegForm(p => ({ ...p, [k]: e.target.value }));

  const validateReg = () => {
    const e = {};
    if (!regForm.name.trim()) e.name = 'Name is required.';
    if (!regForm.enrollmentNo.trim()) e.enrollmentNo = 'Enrollment number is required.';
    if (!regForm.dept) e.dept = 'Department is required.';
    if (!regForm.course.trim()) e.course = 'Course is required.';
    if (!regForm.phone.trim()) e.phone = 'Mobile number is required.';
    else { const digits = regForm.phone.replace(/[\s\-+]/g, '').replace(/^91/, ''); if (!/^\d{10}$/.test(digits)) e.phone = 'Enter a valid 10-digit mobile number.'; }
    if (!regForm.email.trim()) e.email = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regForm.email)) e.email = 'Enter a valid email.';
    if (!regForm.gender) e.gender = 'Gender is required.';
    setRegErr(e);
    return Object.keys(e).length === 0;
  };

  const submitReg = async (e) => {
    e.preventDefault();
    setRegApi('');
    if (!validateReg()) return;
    setRegLoading(true);
    try {
      const res = await fetch(`/api/events/${regModal.id}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Registration failed.');
      setRegDone(true);
    } catch (err) {
      setRegApi(err.message);
    } finally {
      setRegLoading(false);
    }
  };

  useEffect(() => {
    fetch('/api/events')
      .then(r => r.json())
      .then(d => {
        if (d.events?.length) {
          const apiEvents = d.events.map(normaliseEvent);
          // Always keep the rich static past-events showcase; only replace upcoming with live API data
          const staticPast = EVENTS.filter(e => e.status === 'past');
          setEvents([...apiEvents, ...staticPast]);
        }
      })
      .catch(() => { }); // silently fall back to static data
  }, []);

  /* Light poll: live count badge on the trigger button only */
  useEffect(() => {
    const refreshCount = () => {
      fetchPublicJson('/events/live-scores')
        .then((d) => {
          const n = (d.liveScores || []).filter((x) => x.status === 'live').length;
          setLiveCount(n);
        })
        .catch(() => setLiveCount(0));
    };
    refreshCount();
    const t = setInterval(refreshCount, 30000);
    return () => clearInterval(t);
  }, []);

  /* Past total for closed-state label */
  useEffect(() => {
    fetchPublicJson('/events/past-scores?limit=1')
      .then((d) => setPastTotal(d.total || 0))
      .catch(() => {});
  }, []);

  /* Load past scores only when dropdown is open */
  useEffect(() => {
    if (!pastOpen) return undefined;
    const controller = new AbortController();
    setPastLoading(true);
    const params = new URLSearchParams({ page: pastPage, limit: 20 });
    if (pastSearch) params.set('q', pastSearch);
    if (pastSport !== 'all') params.set('sport', pastSport);
    fetch(`/api/events/past-scores?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        if (!controller.signal.aborted) {
          setPastScores(d.pastScores || []);
          setPastTotal(d.total || 0);
        }
      })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setPastLoading(false); });
    return () => controller.abort();
  }, [pastOpen, pastSearch, pastSport, pastPage]);

  /* Debounce search input → pastSearch */
  useEffect(() => {
    const t = setTimeout(() => { setPastSearch(pastSearchInput); setPastPage(1); }, 400);
    return () => clearTimeout(t);
  }, [pastSearchInput]);

  const upcoming = events.filter(e =>
    e.status === 'upcoming' && (filter === 'all' || e.cat === filter)
  );
  const past = events.filter(e =>
    e.status === 'past' && (filter === 'all' || e.cat === filter)
  );

  const featured = upcoming[0] || null;
  const otherUpcoming = upcoming.slice(1);

  useEffect(() => {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); });
    }, { threshold: 0.06 });
    document.querySelectorAll('.fade').forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [filter]);

  return (
    <div className={styles.events}>

      {/* ── HERO ── */}
      <div className={styles.evHero}>
        <div className={styles.evHeroBg} />
        <div className="wrap" style={{ position: 'relative', zIndex: 1 }}>
          <div className="tag" style={{ color: 'rgba(255,120,120,.8)' }}>Events @ SOAC</div>
          <h1 className={`${styles.evTitle} fade`}>Campus Life,<br />Unforgettable.</h1>
          <p className={`${styles.evSub} fade`}>
            From Galore and Sports Fiesta to Singing Finals and MUN Summits — every event is a memory waiting to happen.
          </p>
          <div className={`${styles.evStats} fade`}>
            {[
              { n: '50+', l: 'Events / Year' },
              { n: '40', l: 'Clubs Involved' },
              { n: '1,400+', l: 'Participants' },
              { n: '7', l: 'Days of Galore' },
            ].map((s, i) => (
              <div key={i} className={styles.evStat}>
                <div className={styles.evStatNum}>{s.n}</div>
                <div className={styles.evStatLabel}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FILTER BAR ── */}
      <div className={styles.filterBar}>
        <div className="wrap">
          <div className={styles.filterInner}>
            <span className={styles.filterLabel}>Filter by</span>
            <div className={styles.filterPills}>
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  className={`${styles.fp} ${filter === f.key ? styles.fpOn : ''}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          UPCOMING EVENTS
      ══════════════════════════════════════════ */}
      <div className={styles.section}>
        <div className="wrap">
          <div className={styles.sectionHead}>
            <div>
              <div className={styles.sectionPill} style={{ background: '#fff3f3', color: '#D32F2F' }}>
                <span className={styles.liveDot} /> Upcoming
              </div>
              <h2 className={styles.sectionTitle}>Register for upcoming events.</h2>
            </div>
            {upcoming.length > 0 && (
              <p className={styles.sectionCount}>{upcoming.length} event{upcoming.length !== 1 ? 's' : ''}</p>
            )}
          </div>

          {upcoming.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>📭</div>
              <p>No upcoming events in this category.</p>
            </div>
          ) : (
            <>
              {/* Featured upcoming */}
              {featured && (
                <div className={`${styles.featCard} fade`}>
                  <div className={styles.featImg}>
                    <img src={featured.img} alt={featured.title} loading="lazy" />
                    <div className={styles.featImgOv} />
                  </div>
                  <div className={styles.featBody}>
                    <div className={styles.featMeta}>
                      <span className={styles.featCat} style={{ color: CAT_COLOR[featured.cat] || '#635BFF', background: (CAT_COLOR[featured.cat] || '#635BFF') + '14' }}>
                        {FILTERS.find(f => f.key === featured.cat)?.label}
                      </span>
                      <span className={styles.featSeats}>🎟️ {featured.seats}</span>
                    </div>
                    <h3 className={styles.featTitle}>{featured.title}</h3>
                    <p className={styles.featClub}>{featured.club}</p>
                    <p className={styles.featDesc}>{featured.desc}</p>
                    <div className={styles.featInfo}>
                      <div className={styles.featInfoItem}>
                        <span className={styles.featInfoIcon}>📅</span>
                        <div>
                          <div className={styles.featInfoLabel}>Date</div>
                          <div className={styles.featInfoVal}>{featured.date}</div>
                        </div>
                      </div>
                      <div className={styles.featInfoItem}>
                        <span className={styles.featInfoIcon}>🕐</span>
                        <div>
                          <div className={styles.featInfoLabel}>Time</div>
                          <div className={styles.featInfoVal}>{featured.time}</div>
                        </div>
                      </div>
                      <div className={styles.featInfoItem}>
                        <span className={styles.featInfoIcon}>📍</span>
                        <div>
                          <div className={styles.featInfoLabel}>Venue</div>
                          <div className={styles.featInfoVal}>{featured.venue}</div>
                        </div>
                      </div>
                    </div>
                    <div className={styles.featTags}>
                      {featured.tags.map(t => <span key={t} className={styles.tag}>{t}</span>)}
                    </div>
                    <button className={styles.regBtn} onClick={() => openReg(featured)}>
                      Register Now →
                    </button>
                  </div>
                </div>
              )}

              {/* Other upcoming events grid */}
              {otherUpcoming.length > 0 && (
                <div className={styles.upcomingGrid}>
                  {otherUpcoming.map((ev) => (
                    <div key={ev.id} className={styles.upCard}>
                      <div className={styles.upCardImg}>
                        <img src={ev.img} alt={ev.title} loading="lazy" />
                      </div>
                      <div className={styles.upCardBody}>
                        <h4 className={styles.upCardTitle}>{ev.title}</h4>
                        <p className={styles.upCardClub}>{ev.club}</p>
                        <div className={styles.upCardMeta}>
                          <span>📅 {ev.date}</span>
                          <span>📍 {ev.venue}</span>
                        </div>
                        <div className={styles.upCardFooter}>
                          <span className={styles.upCardSeats}>🎟️ {ev.seats}</span>
                          <button className={styles.upRegBtn} onClick={() => openReg(ev)}>
                            Register Now →
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════
          LIVE SCOREBOARD — dedicated page
      ══════════════════════════════════════════ */}
      <div className={`${styles.section} ${styles.sportsPanelSection}`}>
        <div className="wrap">
          <Link to="/events/live" className={`${styles.sportsPanelTrigger} ${styles.sportsPanelTriggerLive}`}>
            <div className={styles.sportsPanelTriggerMain}>
              <div className={styles.sectionPill} style={{ background: '#ecfdf5', color: '#059669' }}>
                <span className={styles.liveDot} /> Ongoing Games
              </div>
              <h2 className={styles.sportsPanelTitle}>Live Game Scores.</h2>
              <p className={styles.sportsPanelHint}>
                {liveCount > 0
                  ? `${liveCount} game${liveCount !== 1 ? 's' : ''} in progress — tap to watch live`
                  : 'Real-time scores from sports coordinators'}
              </p>
            </div>
            <div className={styles.sportsPanelTriggerEnd}>
              {liveCount > 0 && (
                <span className={styles.sportsPanelBadgeLive}>{liveCount} LIVE</span>
              )}
              <span className={styles.sportsPanelChevron} aria-hidden="true">→</span>
            </div>
          </Link>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          PAST SPORTS RECORDS — collapsible dropdown
      ══════════════════════════════════════════ */}
      <div className={`${styles.section} ${styles.sportsPanelSection}`}>
        <div className="wrap">
          <button
            type="button"
            className={`${styles.sportsPanelTrigger} ${styles.sportsPanelTriggerPast} ${pastOpen ? styles.sportsPanelTriggerOpen : ''}`}
            onClick={() => setPastOpen((o) => !o)}
            aria-expanded={pastOpen}
          >
            <div className={styles.sportsPanelTriggerMain}>
              <div className={styles.sectionPill} style={{ background: '#eff6ff', color: '#1d4ed8' }}>
                📊 Sports History
              </div>
              <h2 className={styles.sportsPanelTitle}>Past Sports Records</h2>
              <p className={styles.sportsPanelHint}>
                {pastTotal > 0
                  ? `${pastTotal} completed match${pastTotal !== 1 ? 'es' : ''} — tap to browse`
                  : 'Search results & match history'}
              </p>
            </div>
            <div className={styles.sportsPanelTriggerEnd}>
              {pastTotal > 0 && !pastOpen && (
                <span className={styles.sportsPanelBadgePast}>{pastTotal}</span>
              )}
              <span className={styles.sportsPanelChevron} aria-hidden="true">{pastOpen ? '▲' : '▼'}</span>
            </div>
          </button>

          {pastOpen && (
            <div className={styles.sportsDropdown}>
              <div className={styles.pastFilterBar}>
                <div className={styles.pastSearchWrap}>
                  <span className={styles.pastSearchIcon}>🔍</span>
                  <input
                    className={styles.pastSearchInput}
                    placeholder="Search by team or match…"
                    value={pastSearchInput}
                    onChange={(e) => setPastSearchInput(e.target.value)}
                  />
                  {pastSearchInput && (
                    <button type="button" className={styles.pastSearchClear} onClick={() => { setPastSearchInput(''); setPastPage(1); }}>✕</button>
                  )}
                </div>
                <div className={styles.pastSportPills}>
                  {SPORTS_LIST.map((sp) => (
                    <button
                      key={sp}
                      type="button"
                      className={`${styles.pastSportPill} ${pastSport === sp ? styles.pastSportPillOn : ''}`}
                      onClick={() => { setPastSport(sp); setPastPage(1); }}
                      style={pastSport === sp && sp !== 'all' ? { background: (SPORT_CFG[sp] || {}).color || '#1d4ed8', color: '#fff', borderColor: 'transparent' } : {}}
                    >
                      {sp === 'all' ? 'All' : sp.charAt(0).toUpperCase() + sp.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {pastLoading ? (
                <div className={styles.sportsDropdownEmpty}>Loading records…</div>
              ) : pastScores.length === 0 ? (
                <div className={styles.sportsDropdownEmpty}>
                  {pastSearch || pastSport !== 'all' ? 'No games match your search.' : 'No completed games yet.'}
                </div>
              ) : (
                <div className={styles.pastAccordion}>
                  {pastScores.map((g) => {
                    const cfg = SPORT_CFG[g.sport] || { color: '#6b7280', bg: '#f3f4f6', label: g.sport };
                    const w = winner(g);
                    const homeName = g.homeTeam || g.clubName || 'Home';
                    const hasStats = (g.homePlayers?.length > 0) || (g.awayPlayers?.length > 0);
                    return (
                      <details key={g.id} className={styles.pastAccordionItem} style={{ borderLeftColor: cfg.color }}>
                        <summary className={styles.pastAccordionSummary}>
                          <span className={styles.pastAccSport} style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                          <span className={styles.pastAccTitle}>{g.matchTitle || `${homeName} vs ${g.opponentName || 'Away'}`}</span>
                          <span className={styles.pastAccScore}>
                            <strong>{g.teamScore}</strong> – <strong>{g.opponentScore}</strong>
                          </span>
                          <span className={styles.pastAccDate}>{fmtDate(g.endedAt || g.updatedAt)}</span>
                        </summary>
                        <div className={styles.pastAccordionBody}>
                          {g.venue && <p className={styles.pastAccVenue}>📍 {g.venue}</p>}
                          {g.clubName && <p className={styles.pastAccClub}>Club: {g.clubName}</p>}
                          <div className={styles.pastAccTeams}>
                            <span className={w === 'home' ? styles.pastAccWin : ''}>{homeName}: {g.teamScore}{w === 'home' ? ' 🏆' : ''}</span>
                            <span>vs</span>
                            <span className={w === 'away' ? styles.pastAccWin : ''}>{g.opponentName || 'Away'}: {g.opponentScore}{w === 'away' ? ' 🏆' : ''}</span>
                          </div>
                          {w === 'draw' && <span className={styles.srDrawTag}>Draw</span>}
                          {hasStats && (
                            <button type="button" className={styles.srStatsBtn} onClick={() => setStatsModal(g)}>
                              View player stats →
                            </button>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              )}

              {pastTotal > 20 && (
                <div className={styles.pastPagination}>
                  <button type="button" className={styles.pastPageBtn} disabled={pastPage === 1} onClick={() => setPastPage((p) => p - 1)}>← Prev</button>
                  <span className={styles.pastPageInfo}>Page {pastPage} of {Math.ceil(pastTotal / 20)}</span>
                  <button type="button" className={styles.pastPageBtn} disabled={pastPage >= Math.ceil(pastTotal / 20)} onClick={() => setPastPage((p) => p + 1)}>Next →</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════
          PAST EVENTS
      ══════════════════════════════════════════ */}
      <div className={styles.pastSection}>
        <div className="wrap">
          <div className={styles.sectionHead}>
            <div>
              <div className={styles.sectionPill} style={{ background: 'rgba(255,255,255,.08)', color: 'rgba(255,255,255,.55)' }}>
                ✓ Past Events
              </div>
              <h2 className={styles.sectionTitle} style={{ color: '#fff' }}>Moments We've Made</h2>
            </div>
            {past.length > 0 && (
              <p className={styles.sectionCount} style={{ color: 'rgba(255,255,255,.3)' }}>{past.length} event{past.length !== 1 ? 's' : ''}</p>
            )}
          </div>

          {past.length === 0 ? (
            <div className={styles.empty} style={{ color: 'rgba(255,255,255,.4)' }}>
              <div className={styles.emptyIcon}>📭</div>
              <p>No past events in this category.</p>
            </div>
          ) : (
            <div className={styles.pastGrid}>
              {past.map((ev) => (
                <div key={ev.id} className={styles.pastCard}>
                  <div className={styles.pastCardImg}>
                    <img src={ev.img} alt={ev.title} loading="lazy" />
                    <div className={styles.pastCardOv}>
                      <div className={styles.pastCardTags}>
                        {ev.tags.map(t => <span key={t} className={styles.pastTag}>{t}</span>)}
                      </div>
                      <h4 className={styles.pastCardTitle}>{ev.title}</h4>
                      <p className={styles.pastCardDate}>{ev.date}</p>
                    </div>
                  </div>
                  {ev.highlight && (
                    <div className={styles.pastCardHighlight}>{ev.highlight}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Gallery strip */}
          <div className={styles.galleryWrap}>
            <p className={styles.galleryLabel}>Photo Gallery</p>
            <div className={styles.gallery}>
              {GALLERY.map((src, i) => (
                <div key={i} className={styles.galleryItem}>
                  <img src={src} alt={`Event ${i + 1}`} loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── CTA ── */}
      <div className={styles.evCta}>
        <div className="wrap">
          <div className={`${styles.evCtaInner} fade`}>
            <div className={styles.evCtaText}>
              <h2>Don't Miss the Next Event</h2>
              <p>Log in to the SOAC platform to register, track attendance and earn XP for every event you attend.</p>
            </div>
            <div className={styles.evCtaBtns}>
              <button className="btr" onClick={() => upcoming[0] && openReg(upcoming[0])}>
                {user ? `Register as ${user.name.split(' ')[0]}` : 'Register for an Event'}
              </button>
              <button className="btg" onClick={() => navigate('/clubs')}>Explore Clubs</button>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          REGISTRATION MODAL
      ══════════════════════════════════════════ */}
      {regModal && (
        <div className={styles.modalOv} onClick={closeReg}>
          <div className={styles.modalBox} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={closeReg}>✕</button>

            {regDone ? (
              /* ── Success screen ── */
              <div className={styles.regSuccess}>
                <div className={styles.regSuccessIcon}>✓</div>
                <h3>You're Registered!</h3>
                <p>You have successfully registered for <strong>{regModal.title}</strong>.</p>
                <p className={styles.regSuccessSub}>Check your email for confirmation details.</p>
                <button className={styles.regSubmitBtn} onClick={closeReg}>Close</button>
              </div>
            ) : (
              /* ── Registration form ── */
              <>
                <div className={styles.modalHead}>
                  <div className={styles.modalPill}>Event Registration</div>
                  <h2 className={styles.modalTitle}>{regModal.title}</h2>
                  {user ? (
                    <div className={styles.regLoggedIn}>
                      <span className={styles.regLoggedInDot} />
                      Registering as <strong>{user.name}</strong> · {user.email}
                    </div>
                  ) : (
                    <p className={styles.modalSub}>Fill in your details to secure your spot. No account needed.</p>
                  )}
                </div>

                <form className={styles.regForm} onSubmit={submitReg} noValidate>

                  {/* Row 1 — Name + Enrollment */}
                  <div className={styles.regRow}>
                    <div className={styles.regField}>
                      <label htmlFor="reg-name">
                        Full Name <span className={styles.req}>*</span>
                        {user && <span className={styles.regLockedTag}>auto-filled</span>}
                      </label>
                      <input
                        id="reg-name" type="text" placeholder="e.g. Arjun Sharma"
                        value={regForm.name} onChange={sf('name')}
                        className={`${regErr.name ? styles.regInputErr : ''} ${user ? styles.regInputLocked : ''}`}
                        readOnly={!!user}
                      />
                      {regErr.name && <span className={styles.regErrMsg}>{regErr.name}</span>}
                    </div>
                    <div className={styles.regField}>
                      <label htmlFor="reg-enroll">Enrollment No. <span className={styles.req}>*</span></label>
                      <input id="reg-enroll" type="text" placeholder="e.g. 22BCE001" value={regForm.enrollmentNo} onChange={sf('enrollmentNo')} className={regErr.enrollmentNo ? styles.regInputErr : ''} />
                      {regErr.enrollmentNo && <span className={styles.regErrMsg}>{regErr.enrollmentNo}</span>}
                    </div>
                  </div>

                  {/* Row 2 — Department + Course */}
                  <div className={styles.regRow}>
                    <div className={styles.regField}>
                      <label htmlFor="reg-dept">Department <span className={styles.req}>*</span></label>
                      <select id="reg-dept" value={regForm.dept} onChange={sf('dept')} className={regErr.dept ? styles.regInputErr : ''}>
                        <option value="">Select department</option>
                        {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      {regErr.dept && <span className={styles.regErrMsg}>{regErr.dept}</span>}
                    </div>
                    <div className={styles.regField}>
                      <label htmlFor="reg-course">Course <span className={styles.req}>*</span></label>
                      <input id="reg-course" type="text" placeholder="e.g. B.Tech CSE" value={regForm.course} onChange={sf('course')} className={regErr.course ? styles.regInputErr : ''} />
                      {regErr.course && <span className={styles.regErrMsg}>{regErr.course}</span>}
                    </div>
                  </div>

                  {/* Row 3 — Mobile + Email */}
                  <div className={styles.regRow}>
                    <div className={styles.regField}>
                      <label htmlFor="reg-phone">Mobile Number <span className={styles.req}>*</span></label>
                      <input id="reg-phone" type="tel" placeholder="e.g. 9876543210" value={regForm.phone} onChange={sf('phone')} className={regErr.phone ? styles.regInputErr : ''} />
                      {regErr.phone && <span className={styles.regErrMsg}>{regErr.phone}</span>}
                    </div>
                    <div className={styles.regField}>
                      <label htmlFor="reg-email">
                        Email Address <span className={styles.req}>*</span>
                        {user && <span className={styles.regLockedTag}>auto-filled</span>}
                      </label>
                      <input
                        id="reg-email" type="email" placeholder="you@rku.ac.in"
                        value={regForm.email} onChange={sf('email')}
                        className={`${regErr.email ? styles.regInputErr : ''} ${user ? styles.regInputLocked : ''}`}
                        readOnly={!!user}
                      />
                      {regErr.email && <span className={styles.regErrMsg}>{regErr.email}</span>}
                    </div>
                  </div>

                  {/* Row 4 — Gender */}
                  <div className={styles.regRow}>
                    <div className={styles.regField}>
                      <label htmlFor="reg-gender">Gender <span className={styles.req}>*</span></label>
                      <select id="reg-gender" value={regForm.gender} onChange={sf('gender')} className={regErr.gender ? styles.regInputErr : ''}>
                        <option value="">Select gender</option>
                        <option value="M">M</option>
                        <option value="F">F</option>
                      </select>
                      {regErr.gender && <span className={styles.regErrMsg}>{regErr.gender}</span>}
                    </div>
                  </div>

                  {regApi && <div className={styles.regApiErr}>{regApi}</div>}

                  <button type="submit" className={styles.regSubmitBtn} disabled={regLoading}>
                    {regLoading ? 'Submitting…' : 'Confirm Registration →'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════
          GAME STATS MODAL
      ══════════════════════════════════════════ */}
      {statsModal && (
        <div className={styles.modalOv} onClick={() => setStatsModal(null)}>
          <div className={styles.statsModalBox} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setStatsModal(null)}>✕</button>

            {/* Header */}
            <div className={styles.smHead}>
              <div className={styles.smSportPill} style={{ background: (SPORT_CFG[statsModal.sport] || {}).bg || '#f3f4f6', color: (SPORT_CFG[statsModal.sport] || {}).color || '#6b7280' }}>
                {(SPORT_CFG[statsModal.sport] || { label: statsModal.sport }).label}
              </div>
              <h2 className={styles.smTitle}>{statsModal.matchTitle || `${statsModal.homeTeam || statsModal.clubName || 'Home'} vs ${statsModal.opponentName || 'Away'}`}</h2>
              <p className={styles.smMeta}>{statsModal.venue && `📍 ${statsModal.venue}  ·  `}{fmtDate(statsModal.endedAt)}</p>
            </div>

            {/* Final score */}
            {(() => {
              const w = winner(statsModal);
              const cfg = SPORT_CFG[statsModal.sport] || { color: '#6b7280' };
              const homeName = statsModal.homeTeam || statsModal.clubName || 'Home';
              return (
                <div className={styles.smScoreBlock}>
                  <div className={`${styles.smTeamScore} ${w === 'home' ? styles.smWinner : w !== 'draw' ? styles.smLoser : ''}`}>
                    <div className={styles.smTeamName}>{homeName}</div>
                    <div className={styles.smBigScore} style={{ color: w === 'home' ? cfg.color : undefined }}>{statsModal.teamScore}</div>
                    {w === 'home' && <div className={styles.smTrophy}>🏆 Winner</div>}
                  </div>
                  <div className={styles.smVsDivider}>
                    <span>{w === 'draw' ? 'DRAW' : 'VS'}</span>
                    <span className={styles.smFinalLabel}>FINAL</span>
                  </div>
                  <div className={`${styles.smTeamScore} ${w === 'away' ? styles.smWinner : w !== 'draw' ? styles.smLoser : ''}`}>
                    <div className={styles.smTeamName}>{statsModal.opponentName || 'Away'}</div>
                    <div className={styles.smBigScore} style={{ color: w === 'away' ? cfg.color : undefined }}>{statsModal.opponentScore}</div>
                    {w === 'away' && <div className={styles.smTrophy}>🏆 Winner</div>}
                  </div>
                </div>
              );
            })()}

            {/* Player stats tables */}
            {[(
              { side: 'home', label: statsModal.homeTeam || statsModal.clubName || 'Home', players: statsModal.homePlayers || [] }
            ), (
              { side: 'away', label: statsModal.opponentName || 'Away', players: statsModal.awayPlayers || [] }
            )].map(({ side, label, players }) => players.length > 0 && (
              <div key={side} className={styles.smRoster}>
                <div className={styles.smRosterHead}>
                  <span className={styles.smRosterTeam}>{label}</span>
                  <div className={styles.smRosterCols}><span>PTS</span><span>STL</span><span>BLK</span></div>
                </div>
                {players.map((p, i) => (
                  <div key={i} className={styles.smRosterRow}>
                    <div className={styles.smPlayerName}>
                      {p.number && <span className={styles.smJersey}>#{p.number}</span>}
                      {p.name || '—'}
                    </div>
                    <div className={styles.smRosterCols}>
                      <span className={styles.smStat}>{p.stats?.points ?? 0}</span>
                      <span className={styles.smStat}>{p.stats?.steals ?? 0}</span>
                      <span className={styles.smStat}>{p.stats?.blocks ?? 0}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}

          </div>
        </div>
      )}

    </div>
  );
};

export default Events;


