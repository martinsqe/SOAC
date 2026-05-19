import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useCoordClub } from '../../context/CoordClubContext';
import api from '../../api/client';
import s from './CoordDashboard.module.css';

const AVS = [
  'linear-gradient(135deg,#3DDC84,#635BFF)',
  'linear-gradient(135deg,#FF6B35,#FFD166)',
  'linear-gradient(135deg,#A259FF,#3DDC84)',
  'linear-gradient(135deg,#06D6A0,#00E5FF)',
  'linear-gradient(135deg,#FF6B9D,#FF9500)',
  'linear-gradient(135deg,#635BFF,#A259FF)',
];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function timeAgo(iso) {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function CoordDashboard() {
  const { user }                  = useAuth();
  const navigate                  = useNavigate();
  const { club }                  = useCoordClub();

  const [members,   setMembers]   = useState([]);
  const [requests,  setRequests]  = useState([]);
  const [events,    setEvents]    = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [actionId,  setActionId]  = useState(null);
  const [calEvents, setCalEvents] = useState([]);

  const CAL_TYPE_META = {
    event:    { label: 'Event',    color: '#635BFF', bg: '#f0f0ff' },
    holiday:  { label: 'Holiday',  color: '#10b981', bg: '#ecfdf5' },
    exam:     { label: 'Exam',     color: '#ef4444', bg: '#fff0f0' },
    deadline: { label: 'Deadline', color: '#f59e0b', bg: '#fffbeb' },
    academic: { label: 'Academic', color: '#3b82f6', bg: '#eff6ff' },
  };

  const loadData = useCallback(() => {
    if (!club || !club.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const clubId = String(club.id || club._id);
    Promise.all([
      api.get(`/clubs/${clubId}/members`).catch(() => ({ members: [] })),
      api.get(`/requests?clubId=${clubId}&status=pending`).catch(() => ({ requests: [] })),
      // Use clubId param (not club name) to avoid mismatches with special chars
      api.get(`/events?clubId=${clubId}`).catch(() => api.get(`/events?club=${encodeURIComponent(club.name)}`).catch(() => ({ events: [] }))),
    ]).then(([mRes, rRes, eRes]) => {
      setMembers(mRes.members || []);
      setRequests(rRes.requests || []);
      setEvents((eRes.events || []).filter(e => e.status === 'upcoming').slice(0, 4));
    }).catch(() => {
      setMembers([]);
      setRequests([]);
      setEvents([]);
    }).finally(() => setLoading(false));
  }, [club]);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── Fetch college calendar ── */
  useEffect(() => {
    const now  = new Date();
    const year = now.getFullYear();
    const today = now.toISOString().slice(0, 10);
    api.get(`/calendar?year=${year}`)
      .then(({ events: evs = [] }) => {
        const upcoming = evs
          .filter(e => (e.startDate || '').slice(0, 10) >= today)
          .sort((a, b) => a.startDate > b.startDate ? 1 : -1)
          .slice(0, 8);
        setCalEvents(upcoming);
      })
      .catch(() => {});
  }, []);

  // Department breakdown from members
  const deptMap = {};
  members.forEach(m => {
    const dept = m.dept || 'Other';
    deptMap[dept] = (deptMap[dept] || 0) + 1;
  });
  const DEPT_COLORS = ['#635BFF','#3DDC84','#FF9500','#FF6B9D','#06D6A0','#9CA3AF'];
  const deptBreakdown = Object.entries(deptMap)
    .sort((a, b) => b[1] - a[1])
    .map(([dept, count], i) => ({ dept, count, color: DEPT_COLORS[i % DEPT_COLORS.length] }));
  const deptTotal = members.length;

  const nextEvent = events[0];
  const nextDateStr = nextEvent?.date || nextEvent?.startDate
    ? new Date(nextEvent.startDate || Date.now()).toLocaleDateString('en-IN',{day:'numeric',month:'short'})
    : null;

  const handleApprove = async (req) => {
    setActionId(req._id);
    try {
      await api.post(`/requests/${req._id}/approve`, {});
      setRequests(p => p.filter(r => r._id !== req._id));
      setMembers(p => [...p, { name: req.name, email: req.email, dept: req.dept, year: req.year, joined_at: new Date().toISOString() }]);
    } catch (_) {} finally { setActionId(null); }
  };

  const handleDecline = async (req) => {
    setActionId(req._id);
    try {
      await api.post(`/requests/${req._id}/decline`, {});
      setRequests(p => p.filter(r => r._id !== req._id));
    } catch (_) {} finally { setActionId(null); }
  };

  return (
    <div className={s.page}>

      {/* ══ HERO ══ */}
      <div className={s.hero}>
        <div className={s.heroLeft}>
          <div className={s.soacPill}>SOAC · RK University</div>
          <h1 className={s.heroTitle}>{greeting()}, {user?.name?.split(' ')[0] || user?.name}!</h1>
          <p className={s.heroSub}>
            {loading ? 'Loading club data…' : club
              ? <>Managing <strong>{club.name}</strong> · {club.category?.charAt(0).toUpperCase() + club.category?.slice(1) || 'Club'}</>
              : 'No club assigned yet'}
          </p>
          <p className={s.heroQuote}>"Great clubs are built on great coordination."</p>
        </div>
        <div className={s.heroRight}>
          {club && (
            <div className={s.clubBadge} style={{ borderColor: (club.color || '#635BFF') + '40' }}>
              {club.logoUrl
                ? <img src={club.logoUrl} alt={club.name} className={s.clubLogo} />
                : <div className={s.clubLogoFallback} style={{ background: (club.color || '#635BFF') + '20', color: club.color || '#635BFF' }}>{club.name?.[0]}</div>
              }
              <div className={s.clubInfo}>
                <div className={s.clubName}>{club.name}</div>
                <div className={s.clubCoord}>Lead Coordinator</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ══ STATS ══ */}
      {club && (
        <div className={s.statsScrollWrap}>
        <div className={s.statsGrid}>
                  <div className={`${s.sc} ${s.fu} ${s.d1}`} onClick={() => navigate('/coordinator/members')} style={{cursor:'pointer'}}>
            <div className={s.scVal} style={{ color:'#635BFF' }}>{loading ? '—' : (club?.memberCount ?? members.length)}</div>
            <div className={s.scName}>Total Members</div>
            <div className={s.scBadge} style={{ background:'#635bff14', color:'#635bff' }}>Click to manage</div>
          </div>
          <div className={`${s.sc} ${s.fu} ${s.d2}`} onClick={() => navigate('/coordinator/requests')} style={{cursor:'pointer'}}>
            <div className={s.scVal} style={{ color:'#FF9500' }}>{loading ? '—' : requests.length}</div>
            <div className={s.scName}>Pending Requests</div>
            <div className={s.scBadge} style={{ background:'#ff950014', color:'#c47700' }}>
              {requests.length > 0 ? 'Action needed' : 'All clear'}
            </div>
          </div>
          <div className={`${s.sc} ${s.fu} ${s.d3}`} onClick={() => navigate('/coordinator/events')} style={{cursor:'pointer'}}>
            <div className={s.scVal} style={{ color:'#00C896' }}>{loading ? '—' : (club?.eventCount ?? events.length)}</div>
            <div className={s.scName}>Upcoming Events</div>
            <div className={s.scBadge} style={{ background:'#00c89614', color:'#007a5e' }}>
              {nextDateStr ? `Next: ${nextDateStr}` : 'None scheduled'}
            </div>
          </div>
          <div className={`${s.sc} ${s.fu} ${s.d4}`}>
            <div className={s.scVal} style={{ color:'#06D6A0' }}>
              {loading ? '—' : (club?.foundedYear || '—')}
            </div>
            <div className={s.scName}>Founded Year</div>
            <div className={s.scBadge} style={{ background:'#06d6a014', color:'#047a5a' }}>
              {club?.category ? club.category.charAt(0).toUpperCase() + club.category.slice(1) : 'Club'}
            </div>
          </div>
        </div>
        </div>
      )}

      {/* ══ TWO-COLUMN ══ */}
      {club && (
      <div className={s.row2}>

        {/* Recent Members */}
        <div className={s.card}>
          <div className={s.cardHead}>
            <h3 className={s.cardTitle}>Recent Members</h3>
            <button className={s.cardAction} onClick={() => navigate('/coordinator/members')}>View All →</button>
          </div>
          {loading ? (
            <div className={s.emptyState}>Loading…</div>
          ) : members.length === 0 ? (
            <div className={s.emptyState}>No members yet</div>
          ) : (
            <div className={s.memberList}>
              {members.slice(0, 6).map((m, i) => (
                <div key={m.id || i} className={s.memberRow}>
                  <div className={s.memberAv} style={{ background: AVS[i % AVS.length] }}>
                    {(m.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className={s.memberInfo}>
                    <div className={s.memberName}>{m.name}</div>
                    <div className={s.memberMeta}>{m.email}</div>
                  </div>
                  <div className={s.memberRight}>
                    <span className={s.newsTime}>{timeAgo(m.joined_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column */}
        <div className={s.rightCol}>

          {/* Pending Requests */}
          <div className={s.card}>
            <div className={s.cardHead}>
              <h3 className={s.cardTitle}>Pending Requests</h3>
              <button className={s.cardAction} onClick={() => navigate('/coordinator/requests')}>View All →</button>
            </div>
            {loading ? (
              <div className={s.emptyState}>Loading…</div>
            ) : requests.length === 0 ? (
              <div className={s.emptyState}>All requests reviewed</div>
            ) : (
              <div className={s.requestList}>
                {requests.slice(0, 3).map((r, i) => {
                  const busy = actionId === r._id;
                  return (
                    <div key={r._id} className={s.requestRow}>
                      <div className={s.requestAv}>{(r.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</div>
                      <div className={s.requestInfo}>
                        <div className={s.requestName}>{r.name} <span className={s.requestMeta}>{r.dept} · {r.year}</span></div>
                        {r.message && <div className={s.requestMsg}>{r.message.slice(0, 80)}{r.message.length > 80 ? '…' : ''}</div>}
                        <div className={s.requestBtns}>
                          <button className={s.approveBtn} onClick={() => handleApprove(r)} disabled={busy}>{busy ? '…' : 'Approve'}</button>
                          <button className={s.declineBtn} onClick={() => handleDecline(r)} disabled={busy}>{busy ? '…' : 'Decline'}</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Upcoming Events */}
          <div className={s.card}>
            <div className={s.cardHead}>
              <h3 className={s.cardTitle}>Upcoming Events</h3>
              <button className={s.cardAction} onClick={() => navigate('/coordinator/events')}>Manage →</button>
            </div>
            {loading ? (
              <div className={s.emptyState}>Loading…</div>
            ) : events.length === 0 ? (
              <div className={s.emptyState}>No upcoming events</div>
            ) : (
              <div className={s.eventList}>
                {events.map((ev, i) => (
                  <div key={ev._id || i} className={s.eventRow}>
                    <div className={s.eventDate}>{ev.date || new Date(ev.startDate).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</div>
                    <div className={s.eventInfo}>
                      <div className={s.eventTitle}>{ev.title}</div>
                      {ev.venue && <div className={s.eventVenue}>{ev.venue}</div>}
                    </div>
                    <span className={s.eventStatus} style={{ background:'#635bff14', color:'#635bff' }}>upcoming</span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
      )}

      {/* ══ COLLEGE CALENDAR ══ */}
      {calEvents.length > 0 && (
        <div className={s.card}>
          <div className={s.cardHead}>
            <h3 className={s.cardTitle}>📅 College Calendar — Upcoming</h3>
          </div>
          <div className={s.calGrid}>
            {calEvents.map(ev => {
              const meta = CAL_TYPE_META[ev.type] || CAL_TYPE_META.event;
              const d    = new Date(ev.startDate);
              const mon  = d.toLocaleString('default', { month: 'short' });
              const day  = d.getDate();
              return (
                <div key={ev.id} className={s.calItem} style={{ borderLeftColor: meta.color }}>
                  <div className={s.calItemDate}>
                    <div className={s.calItemMon}>{mon}</div>
                    <div className={s.calItemDay}>{day}</div>
                  </div>
                  <div className={s.calItemInfo}>
                    <div className={s.calItemTitle}>{ev.title}</div>
                    {ev.description && <div className={s.calItemDesc}>{ev.description}</div>}
                  </div>
                  <span className={s.calItemBadge}
                    style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══ BOTTOM ROW ══ */}
      {club && (
      <div className={s.row3}>

        {/* Department Breakdown */}
        <div className={s.card}>
          <div className={s.cardHead}>
            <h3 className={s.cardTitle}>Department Breakdown</h3>
            <span className={s.cardSub}>{deptTotal} members</span>
          </div>
          {deptBreakdown.length === 0 ? (
            <div className={s.emptyState}>No members yet</div>
          ) : deptBreakdown.map((d, i) => (
            <div key={i} className={s.deptRow}>
              <div className={s.deptLabel}>
                <span>{d.dept}</span>
                <span style={{ color: d.color, fontWeight: 700 }}>{d.count}</span>
              </div>
              <div className={s.progBarBg}>
                <div className={s.progFill} style={{ width: deptTotal > 0 ? `${(d.count/deptTotal)*100}%` : '0%', background: d.color }} />
              </div>
            </div>
          ))}
        </div>

        {/* Club Info */}
        <div className={s.card}>
          <div className={s.cardHead}>
            <h3 className={s.cardTitle}>Club Details</h3>
          </div>
          {club ? (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {[
                { label:'Category',    val: club.category?.charAt(0).toUpperCase() + club.category?.slice(1) },
                { label:'Coordinator', val: club.coordinator },
                { label:'Founded',     val: club.foundedYear || '—' },
                { label:'Total Members', val: members.length },
                { label:'Total Events',  val: club.eventCount ?? events.length },
              ].map(({ label, val }) => (
                <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:'.82rem' }}>
                  <span style={{ color:'#9ca3af', fontWeight:600 }}>{label}</span>
                  <span style={{ color:'#0f172a', fontWeight:700 }}>{val ?? '—'}</span>
                </div>
              ))}
              {club.description && (
                <p style={{ fontSize:'.78rem', color:'#6b7280', lineHeight:1.5, marginTop:4 }}>
                  {club.description.slice(0, 120)}{club.description.length > 120 ? '…' : ''}
                </p>
              )}
            </div>
          ) : (
            <div className={s.emptyState}>Loading club info…</div>
          )}
        </div>

        {/* Quick Actions */}
        <div className={s.card}>
          <div className={s.cardHead}><h3 className={s.cardTitle}>Quick Actions</h3></div>
          <div className={s.qaGrid}>
                        {[
              { label:'Review Requests', to:'/coordinator/requests' },
              { label:'Add Event',        to:'/coordinator/events'   },
              { label:'View Members',     to:'/coordinator/members'  },
              { label:'Post News',        to:'/coordinator/news'     },
              { label:'Leadership',       to:'/coordinator/leaders'  },
              { label:'SOAC News',        to:'/coordinator/soac'     },
            ].map((a, i) => (
              <button key={i} className={s.qaBtn} onClick={() => navigate(a.to)}>
                <span className={s.qaLabel}>{a.label}</span>
              </button>
            ))}
          </div>
        </div>

      </div>
      )}
    </div>
  );
}
