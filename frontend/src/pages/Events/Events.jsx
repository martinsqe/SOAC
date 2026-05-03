import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './Events.module.css';
import api from '../../api/client';
import { getSocket } from '../../realtime/socket';
import { useAuth } from '../../context/AuthContext';

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

const DEPTS = ['SOE', 'SOM', 'SPT', 'FOT', 'SDS', 'SOS'];
const EMPTY_FORM = { name: '', enrollmentNo: '', dept: '', course: '', phone: '', email: '' };

/* ── Live score helpers ── */
const SPORT_CFG = {
  basketball: { color: '#f97316', bg: '#fff7ed', label: 'Basketball' },
  cricket: { color: '#16a34a', bg: '#f0fdf4', label: 'Cricket' },
  football: { color: '#2563eb', bg: '#eff6ff', label: 'Football' },
  volleyball: { color: '#ca8a04', bg: '#fefce8', label: 'Volleyball' },
  badminton: { color: '#7c3aed', bg: '#f5f3ff', label: 'Badminton' },
};
const teamAbbr = (name = '') =>
  name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3) || '??';

const SPORTS_LIST = ['all', 'basketball', 'football', 'cricket', 'volleyball', 'badminton'];

const Events = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [filter, setFilter] = useState('all');
  const [events, setEvents] = useState(EVENTS); // start with static data
  const [liveScores, setLiveScores] = useState([]);
  const [conn, setConn] = useState('connecting');
  const [lastUpdated, setLastUpdated] = useState(null);

  /* ── Past records state ── */
  const [pastScores, setPastScores]       = useState([]);
  const [pastTotal, setPastTotal]         = useState(0);
  const [pastPage, setPastPage]           = useState(1);
  const [pastSearch, setPastSearch]       = useState('');
  const [pastSport, setPastSport]         = useState('all');
  const [pastLoading, setPastLoading]     = useState(false);
  const [pastSearchInput, setPastSearchInput] = useState('');
  const [statsModal, setStatsModal]       = useState(null); // game object | null

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

  useEffect(() => {
    const socket = getSocket();
    const onConnect = () => setConn('connected');
    const onDisconnect = () => setConn('disconnected');
    const onLive = () => {
      setConn(socket.connected ? 'connected' : 'connecting');
      setLastUpdated(new Date().toISOString());
      api.get('/events/live-scores').then((d) => setLiveScores(d.liveScores || [])).catch(() => { });
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('basketball:live:update', onLive);
    setConn(socket.connected ? 'connected' : 'connecting');
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('basketball:live:update', onLive);
    };
  }, []);

  useEffect(() => {
    const loadLive = async () => {
      try {
        const data = await api.get('/events/live-scores');
        setLiveScores(data.liveScores || []);
      } catch {
        setLiveScores([]);
      }
    };
    loadLive();
    const t = setInterval(loadLive, 15000);
    return () => clearInterval(t);
  }, []);

  /* Tick live timers every second so the clock updates in real-time */
  useEffect(() => {
    const t = setInterval(() => {
      setLiveScores(prev => prev.map(sc =>
        sc.timerRunning && Number(sc.timeRemainingSeconds || 0) > 0
          ? { ...sc, timeRemainingSeconds: Math.max(0, Number(sc.timeRemainingSeconds || 0) - 1) }
          : sc
      ));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  /* Load past scores whenever search / sport / page changes */
  useEffect(() => {
    const controller = new AbortController();
    setPastLoading(true);
    const params = new URLSearchParams({ page: pastPage, limit: 20 });
    if (pastSearch) params.set('q', pastSearch);
    if (pastSport !== 'all') params.set('sport', pastSport);
    api.get(`/events/past-scores?${params}`)
      .then(d => { if (!controller.signal.aborted) { setPastScores(d.pastScores || []); setPastTotal(d.total || 0); } })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setPastLoading(false); });
    return () => controller.abort();
  }, [pastSearch, pastSport, pastPage]);

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
  const fmtClock = (sec) => {
    const n = Math.max(0, Number(sec || 0));
    const m = String(Math.floor(n / 60)).padStart(2, '0');
    const s = String(n % 60).padStart(2, '0');
    return `${m}:${s}`;
  };
  const playerSummary = (players = []) => {
    if (!players.length) return 'No player stats yet';
    const p = players[0] || {};
    const entries = Object.entries(p.stats || {}).filter(([, v]) => String(v || '').trim()).slice(0, 2);
    return `${p.name || 'Player'}${entries.length ? ` (${entries.map(([k, v]) => `${k}:${v}`).join(', ')})` : ''}`;
  };
  const topPerformer = (playerStats = {}) => {
    const rows = Object.entries(playerStats).map(([name, s]) => ({ name, ...s }));
    rows.sort((a, b) => (b.points || 0) - (a.points || 0));
    return rows[0] || null;
  };

  useEffect(() => {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); });
    }, { threshold: 0.06 });
    document.querySelectorAll('.fade').forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [filter]);

  const ongoingGames = liveScores.filter(x => x.status === 'live');

  /* Return 'home' | 'away' | 'draw' */
  const winner = (g) => {
    if (g.teamScore > g.opponentScore) return 'home';
    if (g.opponentScore > g.teamScore) return 'away';
    return 'draw';
  };

  /* Format a past date nicely */
  const fmtDate = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

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
          LIVE SCOREBOARD
      ══════════════════════════════════════════ */}
      <div className={styles.section}>
        <div className="wrap">
          <div className={styles.sectionHead}>
            <div>
              <div className={styles.sectionPill} style={{ background: '#ecfdf5', color: '#059669' }}>
                <span className={styles.liveDot} /> Ongoing Games
              </div>
              <h2 className={styles.sectionTitle}>Live Game Scores.</h2>
              <p className={styles.sectionCount} style={{ marginTop: 6, color: conn === 'connected' ? '#059669' : '#d97706' }}>
                {conn}{lastUpdated ? ` · Updated ${new Date(lastUpdated).toLocaleTimeString('en-IN')}` : ''}
              </p>
            </div>
            {ongoingGames.length > 0 && (
              <p className={styles.sectionCount}>{ongoingGames.length} live game{ongoingGames.length !== 1 ? 's' : ''}</p>
            )}
          </div>

          {ongoingGames.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>📡</div>
              <p>No live games right now. Check back during events!</p>
            </div>
          ) : (
            <div className={styles.liveScoresList}>
              {[...ongoingGames]
                .sort((a, b) => new Date(a.startedAt || a.createdAt) - new Date(b.startedAt || b.createdAt))
                .map(ls => {
                  const cfg = SPORT_CFG[ls.sport] || { color: '#6b7280', bg: '#f3f4f6', label: ls.sport };
                  const clockStr = fmtClock(ls.timeRemainingSeconds);
                  const homeN = Number(ls.teamScore ?? 0);
                  const awayN = Number(ls.opponentScore ?? 0);
                  const homeLeads = homeN > awayN;
                  const awayLeads = awayN > homeN;

                  /* ── Sport-specific display values ── */
                  let homeDisp = String(homeN);
                  let awayDisp = String(awayN);
                  let homeSub = null;
                  let awaySub = null;
                  let clockLabel = clockStr;
                  let centerExtra = null;

                  if (ls.sport === 'basketball') {
                    const q = ls.scoreData?.quarter || ls.gameClock || 'Q1';
                    clockLabel = `${q} · ${clockStr}`;
                    const hFouls = ls.teamFouls?.home ?? ls.scoreData?.home?.fouls ?? 0;
                    const aFouls = ls.teamFouls?.away ?? ls.scoreData?.away?.fouls ?? 0;
                    homeSub = `Fouls: ${hFouls}`;
                    awaySub = `Fouls: ${aFouls}`;
                    const qOrder = ['Q1', 'Q2', 'Q3', 'Q4', 'OT'];
                    const curQIdx = qOrder.indexOf(q);
                    centerExtra = (
                      <div className={styles.lsPeriodRow}>
                        {['Q1', 'Q2', 'Q3', 'Q4'].map((qq, qi) => (
                          <span key={qq} className={styles.lsPDot}
                            style={{ background: qi < curQIdx ? `${cfg.color}60` : qi === curQIdx ? cfg.color : '#e5e7eb' }}
                          />
                        ))}
                      </div>
                    );

                  } else if (ls.sport === 'cricket') {
                    const hWkt = ls.scoreData?.home?.wickets;
                    const aWkt = ls.scoreData?.away?.wickets;
                    homeDisp = hWkt != null ? `${homeN}/${hWkt}` : String(homeN);
                    awayDisp = aWkt != null ? `${awayN}/${aWkt}` : String(awayN);
                    homeSub = ls.scoreData?.home?.overs ? `${ls.scoreData.home.overs} ov` : null;
                    awaySub = ls.scoreData?.away?.overs ? `${ls.scoreData.away.overs} ov` : null;
                    clockLabel = ls.gameClock || 'LIVE';
                    if (ls.scoreData?.home?.target)
                      centerExtra = <div className={styles.lsCtxLine}>Target: {ls.scoreData.home.target}</div>;

                  } else if (ls.sport === 'football') {
                    const half = ls.scoreData?.home?.half;
                    clockLabel = half ? `Half ${half} · ${clockStr}` : (ls.gameClock || clockStr);
                    const poss = ls.scoreData?.home?.possession;
                    if (poss) centerExtra = <div className={styles.lsCtxLine}>Poss {poss}%</div>;

                  } else if (ls.sport === 'volleyball') {
                    const hSets = ls.scoreData?.home?.setsWon;
                    const aSets = ls.scoreData?.away?.setsWon;
                    if (hSets != null) { homeDisp = String(hSets); homeSub = `${homeN} pts`; }
                    if (aSets != null) { awayDisp = String(aSets); awaySub = `${awayN} pts`; }
                    const setNum = ls.scoreData?.home?.set || ls.gameClock || '—';
                    clockLabel = `Set ${setNum}`;

                  } else if (ls.sport === 'badminton') {
                    const hGames = ls.scoreData?.home?.gamesWon;
                    const aGames = ls.scoreData?.away?.gamesWon;
                    if (hGames != null) { homeDisp = String(hGames); homeSub = `${homeN} pts`; }
                    if (aGames != null) { awayDisp = String(aGames); awaySub = `${awayN} pts`; }
                    const gameNum = ls.scoreData?.home?.game || ls.gameClock || '—';
                    clockLabel = `Game ${gameNum}`;

                  } else {
                    clockLabel = ls.gameClock || clockStr;
                  }

                  const homeName  = ls.homeTeam || ls.clubName || 'Home Team';
                  const homeAbbr  = teamAbbr(homeName);
                  const awayAbbr  = teamAbbr(ls.opponentName || 'AWAY');
                  const lastPlay  = ls.playByPlay?.[0];

                  return (
                    <div key={ls.id} className={styles.lsCard}>
                      <div className={styles.lsHeader}>
                        <div className={styles.lsHeaderLeft}>
                          <span className={styles.lsHeaderTitle}>
                            {ls.matchTitle || `${homeName} vs ${ls.opponentName || 'Away'}`}
                          </span>
                          <div className={styles.lsHeaderMeta}>
                            <span className={styles.lsSportBadge} style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                            {ls.venue && <span className={styles.lsVenueTxt}>{ls.venue}</span>}
                          </div>
                        </div>
                        <div className={styles.lsHeaderRight}>
                          <span className={styles.lsClockBadge} style={{ color: cfg.color }}>{clockLabel}</span>
                          <span className={styles.lsLiveDot} />
                        </div>
                      </div>
                      <div className={styles.lsBody}>
                        <div className={styles.lsTeamSide}>
                          <div className={styles.lsAvatar} style={{ background: cfg.color }}>{homeAbbr}</div>
                          <div className={styles.lsTeamName}>{homeName}</div>
                          {homeSub && <div className={styles.lsTeamSub}>{homeSub}</div>}
                        </div>
                        <div className={styles.lsScoreArea}>
                          <div className={styles.lsScoreRow}>
                            <span className={`${styles.lsBigScore} ${homeLeads ? styles.lsBigScoreLead : ''}`}>{homeDisp}</span>
                            <span className={styles.lsDash}>-</span>
                            <span className={`${styles.lsBigScore} ${awayLeads ? styles.lsBigScoreLead : ''}`}>{awayDisp}</span>
                          </div>
                          {centerExtra}
                        </div>
                        <div className={`${styles.lsTeamSide} ${styles.lsTeamSideRight}`}>
                          <div className={styles.lsAvatar} style={{ background: '#374151' }}>{awayAbbr}</div>
                          <div className={styles.lsTeamName}>{ls.opponentName || 'Away Team'}</div>
                          {awaySub && <div className={styles.lsTeamSub}>{awaySub}</div>}
                        </div>
                      </div>
                      <div className={styles.lsFooter}>
                        <span className={styles.lsFooterLeft}>{cfg.label} · {ls.venue || 'Venue TBA'}</span>
                        {lastPlay
                          ? <span className={styles.lsLastPlay}>{lastPlay.player_name || 'Team'} · {String(lastPlay.event_type || '').replace(/_/g, ' ')}{lastPlay.points > 0 ? ` +${lastPlay.points}` : ''}</span>
                          : <span className={styles.lsFooterLeft}>Ongoing</span>}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>



      {/* ══════════════════════════════════════════
          PAST SPORTS RECORDS
      ══════════════════════════════════════════ */}
      <div className={styles.section}>
        <div className="wrap">
          <div className={styles.sectionHead}>
            <div>
              <div className={styles.sectionPill} style={{ background: '#eff6ff', color: '#1d4ed8' }}>📊 Sports History</div>
              <h2 className={styles.sectionTitle}>Past Sports Records</h2>
              <p className={styles.sectionCount} style={{ marginTop: 6 }}>Search and filter all completed games</p>
            </div>
            {pastTotal > 0 && <p className={styles.sectionCount}>{pastTotal} game{pastTotal !== 1 ? 's' : ''} found</p>}
          </div>

          {/* ── Search + sport filter ── */}
          <div className={styles.pastFilterBar}>
            <div className={styles.pastSearchWrap}>
              <span className={styles.pastSearchIcon}>🔍</span>
              <input
                className={styles.pastSearchInput}
                placeholder="Search by team name or match title…"
                value={pastSearchInput}
                onChange={e => setPastSearchInput(e.target.value)}
              />
              {pastSearchInput && (
                <button className={styles.pastSearchClear} onClick={() => { setPastSearchInput(''); setPastPage(1); }}>✕</button>
              )}
            </div>
            <div className={styles.pastSportPills}>
              {SPORTS_LIST.map(sp => (
                <button
                  key={sp}
                  className={`${styles.pastSportPill} ${pastSport === sp ? styles.pastSportPillOn : ''}`}
                  onClick={() => { setPastSport(sp); setPastPage(1); }}
                  style={pastSport === sp && sp !== 'all' ? { background: (SPORT_CFG[sp] || {}).color || '#1d4ed8', color: '#fff', borderColor: 'transparent' } : {}}
                >
                  {sp === 'all' ? 'All Sports' : sp.charAt(0).toUpperCase() + sp.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* ── Results ── */}
          {pastLoading ? (
            <div className={styles.empty}><div className={styles.emptyIcon}>⏳</div><p>Loading records…</p></div>
          ) : pastScores.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>🏆</div>
              <p>{pastSearch || pastSport !== 'all' ? 'No games match your search.' : 'No completed games yet. Records will appear here after games are played.'}</p>
            </div>
          ) : (
            <>
              <div className={styles.scoreRowList}>
                {pastScores.map(g => {
                  const cfg = SPORT_CFG[g.sport] || { color: '#6b7280', bg: '#f3f4f6', label: g.sport };
                  const w   = winner(g);
                  const homeName = g.homeTeam || g.clubName || 'Home';
                  const hasStats = (g.homePlayers?.length > 0) || (g.awayPlayers?.length > 0);
                  return (
                    <div key={g.id} className={styles.scoreRow} style={{ borderLeftColor: cfg.color }}>
                      <div className={styles.srLeft}>
                        <span className={styles.srSportBadge} style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                        <div className={styles.srTitle}>{g.matchTitle || `${homeName} vs ${g.opponentName || 'Away'}`}</div>
                        {g.venue && <div className={styles.srMeta}>📍 {g.venue}</div>}
                      </div>
                      <div className={styles.srCenter}>
                        <div className={`${styles.srTeam} ${w === 'home' ? styles.srWinner : w !== 'draw' ? styles.srLoser : ''}`}>
                          <span className={styles.srTeamName}>{homeName}</span>
                          {w === 'home' && <span className={styles.srTrophy}>🏆</span>}
                        </div>
                        <div className={styles.srScores}>
                          <span className={w === 'home' ? styles.srScoreWin : styles.srScoreDim}>{g.teamScore}</span>
                          <span className={styles.srDash}>–</span>
                          <span className={w === 'away' ? styles.srScoreWin : styles.srScoreDim}>{g.opponentScore}</span>
                        </div>
                        <div className={`${styles.srTeam} ${styles.srTeamRight} ${w === 'away' ? styles.srWinner : w !== 'draw' ? styles.srLoser : ''}`}>
                          {w === 'away' && <span className={styles.srTrophy}>🏆</span>}
                          <span className={styles.srTeamName}>{g.opponentName || 'Away'}</span>
                        </div>
                      </div>
                      <div className={styles.srRight}>
                        <span className={styles.srDate}>{fmtDate(g.endedAt || g.updatedAt)}</span>
                        {w === 'draw' && <span className={styles.srDrawTag}>Draw</span>}
                        {hasStats && <button className={styles.srStatsBtn} onClick={() => setStatsModal(g)}>View Stats →</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
              {pastTotal > 20 && (
                <div className={styles.pastPagination}>
                  <button className={styles.pastPageBtn} disabled={pastPage === 1} onClick={() => setPastPage(p => p - 1)}>← Prev</button>
                  <span className={styles.pastPageInfo}>Page {pastPage} of {Math.ceil(pastTotal / 20)}</span>
                  <button className={styles.pastPageBtn} disabled={pastPage >= Math.ceil(pastTotal / 20)} onClick={() => setPastPage(p => p + 1)}>Next →</button>
                </div>
              )}
            </>
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
                        id="reg-email" type="email" placeholder="you@example.com"
                        value={regForm.email} onChange={sf('email')}
                        className={`${regErr.email ? styles.regInputErr : ''} ${user ? styles.regInputLocked : ''}`}
                        readOnly={!!user}
                      />
                      {regErr.email && <span className={styles.regErrMsg}>{regErr.email}</span>}
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
