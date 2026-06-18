import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import s from './StudentClubs.module.css';

const CAT_LABELS = {
  sports:   'Sports',
  cultural: 'Cultural',
  social:   'Social',
  academic: 'Academic',
};
const CAT_SHORT = {
  sports:'SPORTS', cultural:'CULTURAL', social:'SOCIAL', academic:'ACADEMIC',
};
const DEPTS = ['SOE','SOM','SPT','FOT','SDS','SOS'];
const YEARS = ['1st Year','2nd Year','3rd Year','4th Year'];

/* Static fallback — shown instantly while API loads, or if API is down */
const STATIC_CLUBS = [
  { name:'IRONCREED',                     category:'sports',   color:'#FF4757', logo:'ZERO VIOLATION BASKETBALL CLUB.png', memberCount:72,  eventCount:3, coordinator:'Coach Ramesh Iyer',    foundedYear:'2015' },
  { name:'RKU Rangers FC',                category:'sports',   color:'#00C896', logo:'RKU RANGERS.png',                    memberCount:84,  eventCount:4, coordinator:'Coach Devraj Singh',   foundedYear:'2013' },
  { name:'RKU Shuttle Smashers',          category:'sports',   color:'#00AADD', logo:'RKU SHUTTLE SMASHERS.png',           memberCount:60,  eventCount:3, coordinator:'Prof. Ritesh Patel',   foundedYear:'2016' },
  { name:'RKU Volley Avengers',           category:'sports',   color:'#E25600', logo:'RKU VOLLEY AVENGERS.png',            memberCount:55,  eventCount:3, coordinator:'Coach Ravi Bose',      foundedYear:'2018' },
  { name:'Kabaddi Warriors',              category:'sports',   color:'#9B2335', logo:'Kabaddi Warriors Club logo.png',     memberCount:48,  eventCount:2, coordinator:'Prof. Sunil Desai',    foundedYear:'2019' },
  { name:'Powerhouse Fitness Club',       category:'sports',   color:'#06D6A0', logo:'Powerhouse Club logo.png',           memberCount:63,  eventCount:4, coordinator:'Dr. Kavya Iyer',       foundedYear:'2022' },
  { name:'Rising Star Cricket Club',      category:'sports',   color:'#C7522A', logo:'RISING STAR.png',                    memberCount:76,  eventCount:4, coordinator:'Coach Navin Shah',     foundedYear:'2014' },
  { name:'The King of 64 — Chess',        category:'sports',   color:'#9CA3AF', logo:'THE KING OF 64.png',                 memberCount:48,  eventCount:3, coordinator:'Prof. Mohan Rao',      foundedYear:'2014' },
  { name:'Bumblebeez',                    category:'cultural', color:'#FFD166', logo:'BUMBLEBEEZ.png',                     memberCount:39,  eventCount:3, coordinator:'Prof. Kavya Menon',    foundedYear:'2018' },
  { name:'Soul of Music',                 category:'cultural', color:'#FF9500', logo:'SOUL OF MUSIC.png',                  memberCount:68,  eventCount:4, coordinator:'Dr. Arjun Pillai',     foundedYear:'2015' },
  { name:'Kalaraw Club',                  category:'cultural', color:'#FF6B9D', logo:'KALARAW.png',                        memberCount:53,  eventCount:3, coordinator:'Dr. Leela Krishnan',   foundedYear:'2017' },
  { name:'Pictza Club',                   category:'cultural', color:'#A259FF', logo:'PICTZA.png',                         memberCount:47,  eventCount:2, coordinator:'Prof. Meera Singh',    foundedYear:'2019' },
  { name:'SHWET — Rise of Humanity',      category:'social',   color:'#FF6B9D', logo:'SHWET THE RISE OF HUMANITY.png',     memberCount:56,  eventCount:4, coordinator:'Dr. Ananya Roy',       foundedYear:'2016' },
  { name:'Android Development Club',      category:'academic', color:'#3DDC84', logo:'ANDROID DEVLOPMENT CLUB.png',        memberCount:98,  eventCount:4, coordinator:'Prof. Anita Mehta',    foundedYear:'2019' },
  { name:'Webify Club',                   category:'academic', color:'#635BFF', logo:'WEBIFY.png',                         memberCount:74,  eventCount:3, coordinator:'Dr. Rajesh Pillai',    foundedYear:'2020' },
  { name:'iOS Development Club',          category:'academic', color:'#007AFF', logo:'iOS DEVLOPMENT CLUB.png',            memberCount:52,  eventCount:2, coordinator:'Prof. Sneha Mehta',    foundedYear:'2021' },
  { name:'Mozilla Club',                  category:'academic', color:'#FF6611', logo:'MOZILLA.png',                        memberCount:61,  eventCount:3, coordinator:'Dr. Vinod Rao',        foundedYear:'2018' },
  { name:'IoT Club',                      category:'academic', color:'#00B5A3', logo:'IOT Club logo.png',                  memberCount:57,  eventCount:3, coordinator:'Prof. Arun Kumar',     foundedYear:'2020' },
  { name:'Imagination to Implementation', category:'academic', color:'#A259FF', logo:'IMAGINATION TO IMPLEMENTATION.png', memberCount:45,  eventCount:2, coordinator:'Prof. Divya Nair',     foundedYear:'2022' },
  { name:'Change Makers E-Cell',          category:'academic', color:'#FF9500', logo:'CHANGE MAKERS E-CELL.png',           memberCount:87,  eventCount:5, coordinator:'Dr. Kiran Sharma',     foundedYear:'2017' },
  { name:'BHASHA Club',                   category:'academic', color:'#635BFF', logo:'BHASHA.png',                         memberCount:44,  eventCount:2, coordinator:'Prof. Bharat Rao',     foundedYear:'2018' },
  { name:'Breaths & Beats',               category:'academic', color:'#FF6B9D', logo:'BREATHS & BEATS.png',                memberCount:41,  eventCount:3, coordinator:'Prof. Nisha Menon',    foundedYear:'2019' },
  { name:"Gobbler's Gang",                category:'academic', color:'#F0A500', logo:"GOBBLER'S GANG.png",                 memberCount:35,  eventCount:2, coordinator:'Prof. Rahul Joshi',    foundedYear:'2020' },
  { name:'Rang Manch',                    category:'academic', color:'#D32F2F', logo:'RANG MANCH.png',                     memberCount:50,  eventCount:3, coordinator:'Dr. Pooja Sharma',     foundedYear:'2016' },
  { name:'Aero Modelling Club',           category:'academic', color:'#00C8FF', logo:'AERO MODELLING.png',                 memberCount:34,  eventCount:2, coordinator:'Prof. Suresh Iyer',    foundedYear:'2019' },
  { name:'Club Nirmaan',                  category:'academic', color:'#FF9500', logo:'NIRMAAN.png',                        memberCount:61,  eventCount:2, coordinator:'Dr. Rahul Verma',      foundedYear:'2016' },
  { name:'Product Design Club',           category:'academic', color:'#A259FF', logo:'PRODUCT DESIGN.png',                 memberCount:42,  eventCount:2, coordinator:'Prof. Riya Das',       foundedYear:'2020' },
  { name:'Pharma Health Club',            category:'academic', color:'#00C896', logo:'PHARMA HEALTH CLUB.png',             memberCount:55,  eventCount:3, coordinator:'Dr. Preethi Nair',     foundedYear:'2018' },
  { name:'Parkinson Disease Support',     category:'academic', color:'#635BFF', logo:'PARKINSON DISEASE SUPPORT GROUP.png',memberCount:31,  eventCount:2, coordinator:'Dr. Sunita Kumar',     foundedYear:'2020' },
  { name:'Rajkot Knee Club',              category:'academic', color:'#FF6B9D', logo:'RAJKOT KNEE CLUB.png',               memberCount:28,  eventCount:2, coordinator:'Dr. Anil Mehta',       foundedYear:'2021' },
  { name:'Microbiologist Club',           category:'academic', color:'#635BFF', logo:'MICROBIOLOGIST CLUB.png',            memberCount:43,  eventCount:2, coordinator:'Prof. Kavitha Bose',   foundedYear:'2019' },
  { name:'Medicinal Plants Club',         category:'academic', color:'#00C896', logo:'MEDICINAL PLANTS CLUB.png',          memberCount:38,  eventCount:2, coordinator:'Prof. Sneha Rao',      foundedYear:'2020' },
  { name:'Ayushamrit Club',               category:'academic', color:'#4B6E2E', logo:'AYUSHAMRIT.png',                     memberCount:35,  eventCount:2, coordinator:'Dr. Vijay Pillai',     foundedYear:'2021' },
  { name:'GSG Club',                      category:'academic', color:'#4B6E2E', logo:'GSG Club Logo.png',                  memberCount:120, eventCount:6, coordinator:'Lt. Col. V. Desai',    foundedYear:'2010' },
  { name:'Sapiens — The HR Club',         category:'academic', color:'#A259FF', logo:'SAPIENS THE HR CLUB.png',            memberCount:57,  eventCount:3, coordinator:'Prof. Aditi Sharma',   foundedYear:'2019' },
  { name:'Unite Club',                    category:'academic', color:'#FF6B9D', logo:'UNITE.png',                          memberCount:49,  eventCount:3, coordinator:'Dr. Priya Menon',      foundedYear:'2020' },
  { name:'SETU — MUN',                    category:'academic', color:'#635BFF', logo:'SETU - MUN.png',                     memberCount:66,  eventCount:4, coordinator:'Prof. Sanjay Ghosh',   foundedYear:'2018' },
  { name:'Women Wonders',                 category:'academic', color:'#FF6B9D', logo:'WOMEN WONDERS.png',                  memberCount:74,  eventCount:4, coordinator:'Dr. Rekha Iyer',       foundedYear:'2017' },
  { name:'Know Your Finance',             category:'academic', color:'#FF9500', logo:'KNOW YOUR FINANCE.png',              memberCount:66,  eventCount:4, coordinator:'Dr. Rohan Shah',       foundedYear:'2017' },
  { name:'Mathemagicians',                category:'academic', color:'#635BFF', logo:'MATHEMAGICIANS.png',                 memberCount:52,  eventCount:3, coordinator:'Prof. Anika Joshi',    foundedYear:'2018' },
];

function ClubCard({ club, clubId, enrolled, maxReached, onJoin }) {
  const navigate = useNavigate();
  const locked   = !enrolled && maxReached;
  const topBg    = (club.color || '#635BFF') + '18';
  const badgeBg  = (club.color || '#635BFF') + '22';

  return (
    <div className={`${s.ccard} ${enrolled ? s.ccardJoined : ''} ${locked ? s.ccardLocked : ''}`}>

      {/* coloured top */}
      <div className={s.ct} style={{ background: topBg }}>
        <div className={s.cinit}>
          {club.logoUrl || club.logo ? (
            <img
              src={club.logoUrl || `/logos/${club.logo}`}
              alt={club.name}
              className={s.logoImg}
              onError={e => {
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'flex';
              }}
            />
          ) : null}
          <div
            className={s.logoFallback}
            style={{
              background: club.color || '#635BFF',
              display: (club.logoUrl || club.logo) ? 'none' : 'flex',
            }}
          >
            {club.name.charAt(0)}
          </div>
        </div>
        <div className={s.cbadge} style={{ background: badgeBg, color: club.color || '#635BFF' }}>
          {CAT_SHORT[club.category] || club.category?.toUpperCase()}
        </div>
        {enrolled && <div className={s.joinedRibbon}>Joined</div>}
      </div>

      {/* body */}
      <div className={s.cb}>
        <div className={s.cname}>{club.name}</div>
        <div className={s.cdesc}>
          {club.description
            ? club.description.slice(0, 72) + (club.description.length > 72 ? '…' : '')
            : 'A vibrant student community at RK University.'}
        </div>
      </div>

      {/* footer */}
      <div className={s.cfoot}>
        <span className={s.cmem}>Members: {club.memberCount || 0}</span>
        {enrolled ? (
          <button
            className={`${s.cjoin} ${s.viewBtn}`}
            onClick={() => clubId && navigate(`/student/clubs/${clubId}`, { state: { club } })}
          >
            View Club →
          </button>
        ) : locked ? (
          <span className={`${s.cj} ${s.locked}`}>Max reached</span>
        ) : (
          <button className={s.cjoin} onClick={() => onJoin(club)}>
            Join →
          </button>
        )}
      </div>
    </div>
  );
}

const CATS = ['sports', 'cultural', 'social', 'academic'];

const EMPTY_FORM = { name: '', email: '', phone: '', enrollmentNo: '', dept: '', year: '', message: '' };

const EMPTY_PROPOSAL = {
  club_name: '', category: 'academic', color: '#635BFF',
  description: '', vision: '', reason: '',
  tags: '', rules: '', schedule: '', founded_year: '',
};

export default function StudentClubs() {
  const { user }                   = useAuth();
  const navigate                   = useNavigate();
  const [allClubs,   setAllClubs]  = useState(STATIC_CLUBS);
  /* myClubsRaw: raw [{club_id, club_name}] from /users/me/clubs — used for name-based
     enrollment detection when live club objects don't have _id (static fallback) */
  const [myClubsRaw, setMyClubsRaw]= useState([]);
  const [myClubIds,  setMyClubIds] = useState(new Set());
  const [loading,    setLoading]   = useState(true);

  const [filter,    setFilter]   = useState('all');
  const [search,    setSearch]   = useState('');

  /* join request modal */
  const [joinClub,   setJoinClub]  = useState(null);
  const [form,       setForm]      = useState(EMPTY_FORM);
  const [formErr,    setFormErr]   = useState({});
  const [submitting, setSubmitting]= useState(false);
  const [toast,      setToast]     = useState('');

  /* propose-a-club modal */
  const [propOpen,   setPropOpen]   = useState(false);
  const [prop,       setProp]       = useState(EMPTY_PROPOSAL);
  const [propErr,    setPropErr]    = useState({});
  const [propSaving, setPropSaving] = useState(false);
  const [propDone,   setPropDone]   = useState(false);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const load = () => {
    const fetchClubs   = api.get('/clubs').catch(() => ({ clubs: [] }));
    const fetchMyClubs = api.get('/users/me/clubs').catch(() => ({ clubs: [] }));
    Promise.all([fetchClubs, fetchMyClubs]).then(([cr, mr]) => {
      /* Fall back to static data when the API returns empty (backend down / empty DB) */
      setAllClubs(cr.clubs?.length ? cr.clubs : STATIC_CLUBS);
      const raw = mr.clubs || [];
      setMyClubsRaw(raw);
      setMyClubIds(new Set(raw.map(c => String(c.club_id))));
    }).catch(() => { setAllClubs(STATIC_CLUBS); setMyClubsRaw([]); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  /* Resolve the real DB id for a club — works for both live (has _id) and static data */
  const resolveClubId = (club) => {
    if (club._id) return club._id;
    const mc = myClubsRaw.find(c => c.club_name === club.name);
    return mc ? String(mc.club_id) : null;
  };

  /* Pre-fill name/email from auth user */
  const openJoin = (club) => {
    setJoinClub(club);
    setFormErr({});
    setForm({
      ...EMPTY_FORM,
      name:  user?.name  || '',
      email: user?.email || '',
    });
  };

  const sf = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  const validate = () => {
    const e = {};
    if (!form.name.trim())  e.name  = 'Required';
    if (!form.email.trim()) {
      e.email = 'Required';
    } else if (!form.email.trim().toLowerCase().endsWith('@rku.ac.in')) {
      e.email = 'Only RKU institutional emails are accepted (e.g. yourname@rku.ac.in)';
    }
    if (!form.dept)         e.dept  = 'Required';
    if (!form.year)         e.year  = 'Required';
    setFormErr(e);
    return Object.keys(e).length === 0;
  };

  const handleJoinSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await api.post('/requests', {
        clubId:      joinClub._id,
        clubName:    joinClub.name,
        name:        form.name.trim(),
        email:       form.email.trim().toLowerCase(),
        phone:       form.phone.trim(),
        enrollmentNo:form.enrollmentNo.trim(),
        dept:        form.dept,
        year:        form.year,
        message:     form.message.trim(),
      });
      setJoinClub(null);
      showToast(`Join request sent for ${joinClub.name}! You'll get an email once approved.`);
    } catch (err) {
      setFormErr({ api: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  /* proposal helpers */
  const sp = (k) => (e) => setProp(p => ({ ...p, [k]: e.target.value }));

  const validateProp = () => {
    const e = {};
    if (!prop.club_name.trim()) e.club_name = 'Required';
    if (!prop.description.trim()) e.description = 'Required';
    if (!prop.reason.trim()) e.reason = 'Required';
    setPropErr(e);
    return Object.keys(e).length === 0;
  };

  const openPropose = () => {
    setProp({ ...EMPTY_PROPOSAL });
    setPropErr({});
    setPropDone(false);
    setPropOpen(true);
  };

  const handlePropSubmit = async (ev) => {
    ev.preventDefault();
    if (!validateProp()) return;
    setPropSaving(true);
    try {
      await api.post('/club-proposals', {
        club_name:   prop.club_name.trim(),
        category:    prop.category,
        color:       prop.color,
        description: prop.description.trim(),
        vision:      prop.vision.trim(),
        reason:      prop.reason.trim(),
        tags:        prop.tags.split(',').map(t => t.trim()).filter(Boolean),
        rules:       prop.rules.split('\n').map(r => r.trim()).filter(Boolean),
        schedule:    prop.schedule.trim(),
        founded_year: prop.founded_year.trim(),
      });
      setPropDone(true);
    } catch (err) {
      setPropErr({ api: err.message });
    } finally {
      setPropSaving(false);
    }
  };

  /* Number of clubs the student has joined — works even when using static fallback */
  const enrolledCount = myClubsRaw.length || myClubIds.size;
  const maxReached    = enrolledCount >= 3;
  /* Match by ID (live data) or by name (static fallback) */
  const isEnrolled = (club) =>
    club._id
      ? myClubIds.has(String(club._id))
      : myClubsRaw.some(c => c.club_name === club.name);

  const filtered = allClubs
    .filter(c => (filter === 'all' || c.category === filter) &&
                 (!search || c.name.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => {
      const ae = isEnrolled(a), be = isEnrolled(b);
      if (ae && !be) return -1;
      if (!ae && be) return 1;
      return a.name.localeCompare(b.name);
    });

  const myClubList = allClubs.filter(c => isEnrolled(c));

  return (
    <div className={s.page}>

      {toast && (
        <div className={s.toast}>{toast}</div>
      )}

      {/* Header */}
      <div className={s.topbar}>
        <div>
          <h1 className={s.pageTitle}>All Clubs</h1>
          <p className={s.pageSub}>Browse all {allClubs.length} SOAC-recognised clubs. You can join up to 3.</p>
        </div>
        <button className={s.proposeBtn} onClick={openPropose}>
          + Propose a Club
        </button>
      </div>

      {/* Slot pills */}
      <div className={s.slotRow}>
        <span className={s.slotLabel}>Your clubs:</span>
        {[0, 1, 2].map(i => {
          const c   = myClubList[i];
          const cid = c ? resolveClubId(c) : null;
          return c ? (
            <span
              key={i}
              className={s.slotFilled}
              style={{
                borderBottomColor: c.color || '#635BFF',
                color:             c.color || '#635BFF',
                cursor: cid ? 'pointer' : 'default',
              }}
              onClick={() => cid && navigate(`/student/clubs/${cid}`, { state: { club: c } })}
            >
              {c.name}
            </span>
          ) : (
            <span key={i} className={s.slotEmpty}>Slot {i + 1} open</span>
          );
        })}
        {maxReached && <span className={s.maxBadge}>Max 3 clubs reached</span>}
      </div>

      {/* Filters */}
      <div className={s.filterRow}>
        <div className={s.fbwrap}>
          {['all', 'sports', 'cultural', 'social', 'academic'].map(cat => (
            <button
              key={cat}
              className={`${s.fb} ${filter === cat ? s.fbOn : ''}`}
              onClick={() => setFilter(cat)}
            >
              {cat === 'all' ? `All (${allClubs.length})` : CAT_LABELS[cat]}
            </button>
          ))}
        </div>
        <input
          className={s.searchInput}
          placeholder="Search clubs…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>


      {/* Grid */}
      {loading ? (
        <div className={s.cgrid}>
          {[...Array(8)].map((_, i) => (
            <div key={i} className={s.skeleton}>
              <div className={s.shimmer} style={{ height: 90 }} />
              <div style={{ padding: 16 }}>
                <div className={s.shimmer} style={{ height: 14, width: '70%', borderRadius: 6, marginBottom: 8 }} />
                <div className={s.shimmer} style={{ height: 11, width: '90%', borderRadius: 6 }} />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className={s.empty}>
          <p>No clubs found</p>
          <span>Try a different filter or search term.</span>
        </div>
      ) : (
        <div className={s.cgrid}>
          {filtered.map(club => (
            <ClubCard
              key={club._id || club.name}
              club={club}
              clubId={resolveClubId(club)}
              enrolled={isEnrolled(club)}
              maxReached={maxReached}
              onJoin={openJoin}
            />
          ))}
        </div>
      )}

      {/* ── Propose a Club Modal ── */}
      {propOpen && (
        <div className={s.modalOverlay} onClick={() => { if (!propSaving) setPropOpen(false); }}>
          <div className={s.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className={s.modalHead} style={{ borderColor: prop.color || '#635BFF' }}>
              <div>
                <div className={s.modalTitle}>Propose a New Club</div>
                <div className={s.modalSub}>Submit your idea — admin will review and create it</div>
              </div>
              <button className={s.modalClose} onClick={() => setPropOpen(false)}>✕</button>
            </div>

            {propDone ? (
              <div style={{ padding: '32px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
                <div style={{ fontWeight: 800, fontSize: 18, color: '#0f0a2e', marginBottom: 8 }}>
                  Proposal Submitted!
                </div>
                <div style={{ color: '#6b7280', fontSize: 14, marginBottom: 24 }}>
                  Your proposal for <strong>{prop.club_name}</strong> has been sent to the admin for review.
                </div>
                <button
                  className={s.mSubmitBtn}
                  style={{ background: '#635BFF' }}
                  onClick={() => setPropOpen(false)}
                >
                  Close
                </button>
              </div>
            ) : (
              <form className={s.modalForm} onSubmit={handlePropSubmit} noValidate>

                {/* Club name + category */}
                <div className={s.mGrid2}>
                  <div className={s.mField}>
                    <label>Club Name *</label>
                    <input value={prop.club_name} onChange={sp('club_name')} placeholder="e.g. Robotics Club" />
                    {propErr.club_name && <span className={s.mErr}>{propErr.club_name}</span>}
                  </div>
                  <div className={s.mField}>
                    <label>Category *</label>
                    <select value={prop.category} onChange={sp('category')}>
                      {CATS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                    </select>
                  </div>
                </div>

                {/* Color + founded year */}
                <div className={s.mGrid2}>
                  <div className={s.mField}>
                    <label>Club Colour</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="color"
                        value={prop.color}
                        onChange={sp('color')}
                        style={{ width: 40, height: 36, border: 'none', borderRadius: 6, cursor: 'pointer', padding: 2 }}
                      />
                      <input
                        value={prop.color}
                        onChange={sp('color')}
                        placeholder="#635BFF"
                        style={{ flex: 1 }}
                      />
                    </div>
                  </div>
                  <div className={s.mField}>
                    <label>Founded Year</label>
                    <input value={prop.founded_year} onChange={sp('founded_year')} placeholder="e.g. 2025" maxLength={4} />
                  </div>
                </div>

                {/* Description */}
                <div className={s.mField}>
                  <label>Description *</label>
                  <textarea
                    value={prop.description} onChange={sp('description')}
                    placeholder="What is this club about? Its purpose and activities…" rows={3}
                  />
                  {propErr.description && <span className={s.mErr}>{propErr.description}</span>}
                </div>

                {/* Vision */}
                <div className={s.mField}>
                  <label>Vision / Mission</label>
                  <textarea
                    value={prop.vision} onChange={sp('vision')}
                    placeholder="Long-term goals of the club (optional)…" rows={2}
                  />
                </div>

                {/* Reason */}
                <div className={s.mField}>
                  <label>Why should this club be created? *</label>
                  <textarea
                    value={prop.reason} onChange={sp('reason')}
                    placeholder="Explain why RK University needs this club…" rows={3}
                  />
                  {propErr.reason && <span className={s.mErr}>{propErr.reason}</span>}
                </div>

                {/* Tags */}
                <div className={s.mField}>
                  <label>Tags <span style={{ fontWeight: 400, color: '#9ca3af' }}>(comma-separated)</span></label>
                  <input value={prop.tags} onChange={sp('tags')} placeholder="e.g. robotics, AI, hardware" />
                </div>

                {/* Schedule */}
                <div className={s.mField}>
                  <label>Proposed Meeting Schedule</label>
                  <input value={prop.schedule} onChange={sp('schedule')} placeholder="e.g. Every Saturday 10 AM – 12 PM" />
                </div>

                {/* Rules */}
                <div className={s.mField}>
                  <label>Proposed Rules <span style={{ fontWeight: 400, color: '#9ca3af' }}>(one per line)</span></label>
                  <textarea
                    value={prop.rules} onChange={sp('rules')}
                    placeholder={"Attend at least 75% of sessions\nNo plagiarism"} rows={3}
                  />
                </div>

                {propErr.api && <div className={s.mApiErr}>{propErr.api}</div>}

                <div className={s.mBtnRow}>
                  <button type="button" className={s.mCancelBtn} onClick={() => setPropOpen(false)}>Cancel</button>
                  <button
                    type="submit"
                    className={s.mSubmitBtn}
                    style={{ background: prop.color || '#635BFF' }}
                    disabled={propSaving}
                  >
                    {propSaving ? 'Submitting…' : 'Submit Proposal →'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── Join Request Modal ── */}
      {joinClub && (
        <div className={s.modalOverlay} onClick={() => setJoinClub(null)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalHead} style={{ borderColor: joinClub.color || '#635BFF' }}>
              <div>
                <div className={s.modalTitle}>Request to Join</div>
                <div className={s.modalSub}>{joinClub.name}</div>
              </div>
              <button className={s.modalClose} onClick={() => setJoinClub(null)}>✕</button>
            </div>

            <form className={s.modalForm} onSubmit={handleJoinSubmit} noValidate>
              <div className={s.mGrid2}>
                <div className={s.mField}>
                  <label>Full Name *</label>
                  <input value={form.name} onChange={sf('name')} placeholder="Your full name" />
                  {formErr.name && <span className={s.mErr}>{formErr.name}</span>}
                </div>
                <div className={s.mField}>
                  <label>Email *</label>
                  <input type="email" value={form.email} onChange={sf('email')} placeholder="yourname@rku.ac.in" />
                  {formErr.email && <span className={s.mErr}>{formErr.email}</span>}
                </div>
              </div>
              <div className={s.mGrid2}>
                <div className={s.mField}>
                  <label>Enrollment No.</label>
                  <input value={form.enrollmentNo} onChange={sf('enrollmentNo')} placeholder="e.g. 22BCE001" />
                </div>
                <div className={s.mField}>
                  <label>Phone</label>
                  <input value={form.phone} onChange={sf('phone')} placeholder="10-digit mobile" />
                </div>
              </div>
              <div className={s.mGrid2}>
                <div className={s.mField}>
                  <label>Department *</label>
                  <select value={form.dept} onChange={sf('dept')}>
                    <option value="">Select dept…</option>
                    {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  {formErr.dept && <span className={s.mErr}>{formErr.dept}</span>}
                </div>
                <div className={s.mField}>
                  <label>Year *</label>
                  <select value={form.year} onChange={sf('year')}>
                    <option value="">Select year…</option>
                    {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  {formErr.year && <span className={s.mErr}>{formErr.year}</span>}
                </div>
              </div>
              <div className={s.mField}>
                <label>Why do you want to join? (optional)</label>
                <textarea value={form.message} onChange={sf('message')} placeholder="Tell us about yourself…" rows={3} />
              </div>

              {formErr.api && <div className={s.mApiErr}>{formErr.api}</div>}

              <div className={s.mBtnRow}>
                <button type="button" className={s.mCancelBtn} onClick={() => setJoinClub(null)}>Cancel</button>
                <button
                  type="submit"
                  className={s.mSubmitBtn}
                  style={{ background: joinClub.color || '#635BFF' }}
                  disabled={submitting}
                >
                  {submitting ? 'Sending…' : 'Send Request →'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
