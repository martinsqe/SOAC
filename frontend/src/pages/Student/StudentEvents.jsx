import { useState, useEffect } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import s from './StudentEvents.module.css';

const DEPTS = ['ACH','AI/ML','BCA', 'FOT','SOE', 'SOM', 'SPT',  'SDS', 'SOS'];
const EMPTY_FORM = { enrollmentNo: '', dept: '', course: '', phone: '' };

const CAT_COLOR = {
  tech:      '#635BFF',
  sports:    '#FF4757',
  cultural:  '#FF6B9D',
  health:    '#00C896',
  community: '#4B6E2E',
  general:   '#6b7280',
};

function fmtDate(raw) {
  if (!raw) return 'TBD';
  const d = new Date(raw);
  if (isNaN(d)) return 'TBD';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function StudentEvents() {
  const { user } = useAuth();
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('all');
  const [search,  setSearch]  = useState('');

  /* ── Registration modal ── */
  const [regModal,   setRegModal]   = useState(null);   // { id, title }
  const [regForm,    setRegForm]    = useState(EMPTY_FORM);
  const [regErr,     setRegErr]     = useState({});
  const [regApi,     setRegApi]     = useState('');
  const [regDone,    setRegDone]    = useState(false);
  const [regLoading, setRegLoading] = useState(false);

  useEffect(() => {
    api.get('/events')
      .then(({ events: data }) => setEvents(data || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  const tabs = [
    { key: 'all',      label: 'All' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'ongoing',  label: 'Ongoing' },
    { key: 'past',     label: 'Past' },
  ];

  const filtered = events.filter(e =>
    (filter === 'all' || e.status === filter) &&
    (!search || e.title?.toLowerCase().includes(search.toLowerCase()))
  );

  const openReg = (ev) => {
    setRegModal({ id: ev._id, title: ev.title });
    setRegForm(EMPTY_FORM);
    setRegErr({});
    setRegApi('');
    setRegDone(false);
  };
  const closeReg = () => setRegModal(null);

  const sf = (k) => (e) => setRegForm(p => ({ ...p, [k]: e.target.value }));

  const validate = () => {
    const e = {};
    if (!regForm.enrollmentNo.trim()) e.enrollmentNo = 'Enrollment number is required.';
    if (!regForm.dept)               e.dept          = 'Department is required.';
    if (!regForm.course.trim())      e.course        = 'Course is required.';
    if (!regForm.phone.trim())       e.phone         = 'Mobile number is required.';
    else {
      const digits = regForm.phone.replace(/[\s\-+]/g, '').replace(/^91/, '');
      if (!/^\d{10}$/.test(digits)) e.phone = 'Enter a valid 10-digit number.';
    }
    setRegErr(e);
    return Object.keys(e).length === 0;
  };

  const submitReg = async (ev) => {
    ev.preventDefault();
    setRegApi('');
    if (!validate()) return;
    setRegLoading(true);
    try {
      const res = await fetch(`/api/events/${regModal.id}/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:         user.name,
          email:        user.email,
          enrollmentNo: regForm.enrollmentNo,
          dept:         regForm.dept,
          course:       regForm.course,
          phone:        regForm.phone,
        }),
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

  return (
    <div className={s.page}>
      {/* ── Header ── */}
      <div className={s.header}>
        <h1 className={s.title}>Events</h1>
        <p className={s.sub}>{events.length} events across all clubs</p>
      </div>

      {/* ── Filter row ── */}
      <div className={s.filterRow}>
        <div className={s.tabs}>
          {tabs.map(t => (
            <button
              key={t.key}
              className={`${s.tab} ${filter === t.key ? s.tabActive : ''}`}
              onClick={() => setFilter(t.key)}
            >
              {t.label}
              {t.key !== 'all' && (
                <span className={s.tabCount}>
                  ({events.filter(e => e.status === t.key).length})
                </span>
              )}
            </button>
          ))}
        </div>
        <div className={s.searchWrap}>
          <svg className={s.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className={s.search}
            placeholder="Search events…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className={s.searchClear} onClick={() => setSearch('')}>✕</button>
          )}
        </div>
      </div>

      {/* ── Grid ── */}
      {loading ? (
        <div className={s.grid}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className={s.skeleton}>
              <div className={s.shimmer} style={{ height: 170 }} />
              <div style={{ padding: 16 }}>
                <div className={s.shimmer} style={{ height: 13, width: '55%', borderRadius: 6, marginBottom: 8 }} />
                <div className={s.shimmer} style={{ height: 10, width: '80%', borderRadius: 6, marginBottom: 6 }} />
                <div className={s.shimmer} style={{ height: 10, width: '65%', borderRadius: 6 }} />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className={s.empty}>
          <div className={s.emptyIcon}>📭</div>
          <p>No events found</p>
          {search && <button className={s.clearBtn} onClick={() => setSearch('')}>Clear search</button>}
        </div>
      ) : (
        <div className={s.grid}>
          {filtered.map((ev, i) => {
            const catColor = CAT_COLOR[ev.category] || '#6b7280';
            const isUpcoming = ev.status === 'upcoming';
            const isOngoing  = ev.status === 'ongoing';
            const canRegister = isUpcoming || isOngoing;

            return (
              <div key={ev._id || i} className={s.card}>
                {/* Image */}
                <div className={s.cardImg}>
                  {ev.imageUrl || ev.image ? (
                    <img
                      src={ev.imageUrl || `/images/${ev.image}`}
                      alt={ev.title}
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div className={s.cardImgFallback} style={{ background: catColor + '18' }}>
                      <span style={{ fontSize: 36 }}>
                        {ev.category === 'sports' ? '⚽' : ev.category === 'tech' ? '💻' : ev.category === 'cultural' ? '🎭' : '📅'}
                      </span>
                    </div>
                  )}
                  {/* Status badge overlaid on image */}
                  <span
                    className={s.statusBadge}
                    style={
                      isUpcoming ? { background: '#dcfce7', color: '#15803d' } :
                      isOngoing  ? { background: '#dbeafe', color: '#1d4ed8' } :
                                   { background: '#f3f4f6', color: '#6b7280' }
                    }
                  >
                    {isOngoing && <span className={s.liveDot} />}
                    {ev.status?.charAt(0).toUpperCase() + ev.status?.slice(1)}
                  </span>
                </div>

                {/* Body */}
                <div className={s.cardBody}>
                  <div className={s.catRow}>
                    <span className={s.catPill} style={{ background: catColor + '14', color: catColor }}>
                      {ev.category || 'General'}
                    </span>
                    <span className={s.dateStr}>{fmtDate(ev.date)}</span>
                  </div>
                  <div className={s.cardTitle}>{ev.title}</div>
                  {ev.venue && (
                    <div className={s.venue}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      {ev.venue}
                    </div>
                  )}
                  {ev.description && (
                    <div className={s.desc}>
                      {ev.description.length > 90 ? ev.description.slice(0, 90) + '…' : ev.description}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className={s.cardFoot}>
                  {ev.seats && <span className={s.seats}>🎟️ {ev.seats}</span>}
                  {canRegister ? (
                    <button className={s.regBtn} onClick={() => openReg(ev)}>
                      Register →
                    </button>
                  ) : (
                    <span className={s.closed}>Registration closed</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════
          REGISTRATION MODAL
      ══════════════════════════ */}
      {regModal && (
        <div className={s.modalOv} onClick={closeReg}>
          <div className={s.modalBox} onClick={e => e.stopPropagation()}>
            <button className={s.modalClose} onClick={closeReg} aria-label="Close">✕</button>

            {regDone ? (
              /* Success */
              <div className={s.success}>
                <div className={s.successIcon}>✓</div>
                <h3>You're Registered!</h3>
                <p>Successfully registered for <strong>{regModal.title}</strong>.</p>
                <p className={s.successSub}>Check your email for confirmation details.</p>
                <button className={s.submitBtn} onClick={closeReg}>Done</button>
              </div>
            ) : (
              <>
                {/* Modal header */}
                <div className={s.modalHead}>
                  <div className={s.modalPill}>Event Registration</div>
                  <h2 className={s.modalTitle}>{regModal.title}</h2>
                  {/* Logged-in indicator */}
                  <div className={s.loggedInBanner}>
                    <span className={s.loggedInDot} />
                    Registering as&nbsp;<strong>{user?.name}</strong>&nbsp;·&nbsp;{user?.email}
                  </div>
                </div>

                <form className={s.form} onSubmit={submitReg} noValidate>
                  {/* Row 1 — Enrollment + Dept */}
                  <div className={s.row}>
                    <div className={s.field}>
                      <label>Enrollment No. <span className={s.req}>*</span></label>
                      <input
                        type="text"
                        placeholder="e.g. 22BCE001"
                        value={regForm.enrollmentNo}
                        onChange={sf('enrollmentNo')}
                        className={regErr.enrollmentNo ? s.inputErr : ''}
                      />
                      {regErr.enrollmentNo && <span className={s.errMsg}>{regErr.enrollmentNo}</span>}
                    </div>
                    <div className={s.field}>
                      <label>Department <span className={s.req}>*</span></label>
                      <select
                        value={regForm.dept}
                        onChange={sf('dept')}
                        className={regErr.dept ? s.inputErr : ''}
                      >
                        <option value="">Select department</option>
                        {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      {regErr.dept && <span className={s.errMsg}>{regErr.dept}</span>}
                    </div>
                  </div>

                  {/* Row 2 — Course + Phone */}
                  <div className={s.row}>
                    <div className={s.field}>
                      <label>Course <span className={s.req}>*</span></label>
                      <input
                        type="text"
                        placeholder="e.g. B.Tech CSE"
                        value={regForm.course}
                        onChange={sf('course')}
                        className={regErr.course ? s.inputErr : ''}
                      />
                      {regErr.course && <span className={s.errMsg}>{regErr.course}</span>}
                    </div>
                    <div className={s.field}>
                      <label>Mobile Number <span className={s.req}>*</span></label>
                      <input
                        type="tel"
                        placeholder="e.g. 9876543210"
                        value={regForm.phone}
                        onChange={sf('phone')}
                        className={regErr.phone ? s.inputErr : ''}
                      />
                      {regErr.phone && <span className={s.errMsg}>{regErr.phone}</span>}
                    </div>
                  </div>

                  {regApi && <div className={s.apiErr}>{regApi}</div>}

                  <button type="submit" className={s.submitBtn} disabled={regLoading}>
                    {regLoading ? 'Submitting…' : 'Confirm Registration →'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
