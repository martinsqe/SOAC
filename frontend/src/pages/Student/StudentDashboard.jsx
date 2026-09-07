import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { refreshAppBadge } from '../../utils/badge';
import s from './StudentDashboard.module.css';

/* ── College calendar type metadata ── */
const CAL_TYPE_META = {
  event:    { label: 'Event',    color: '#635BFF', bg: '#f0f0ff' },
  holiday:  { label: 'Holiday',  color: '#10b981', bg: '#ecfdf5' },
  exam:     { label: 'Exam',     color: '#ef4444', bg: '#fff0f0' },
  deadline: { label: 'Deadline', color: '#f59e0b', bg: '#fffbeb' },
  academic: { label: 'Academic', color: '#3b82f6', bg: '#eff6ff' },
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function fmtEventDate(ev) {
  const raw = ev.startDate || ev.date;
  if (!raw) return { mon: '—', day: '—' };
  const d = new Date(raw);
  return {
    mon: d.toLocaleString('default', { month: 'short' }),
    day: d.getDate(),
  };
}

const STATIC_CLUBS = [
  { _id:'1', name:'Android Development Club',      category:'academic', color:'#3DDC84', logo:'ANDROID DEVLOPMENT CLUB.png',       memberCount:98,  eventCount:4 },
  { _id:'2', name:'Webify Club',                   category:'academic', color:'#635BFF', logo:'WEBIFY.png',                        memberCount:74,  eventCount:3 },
  { _id:'3', name:'iOS Development Club',          category:'academic', color:'#007AFF', logo:'iOS DEVLOPMENT CLUB.png',           memberCount:52,  eventCount:2 },
  { _id:'4', name:'RKU Rangers FC',                category:'sports',   color:'#00C896', logo:'RKU RANGERS.png',                   memberCount:84,  eventCount:4 },
];

const STATIC_EVENTS = [
  { id:'1', title:'Tech Fest 2024', club:'Webify Club', venue:'Main Auditorium', startDate: new Date().toISOString() },
  { id:'2', title:'Sports Meet',    club:'IRONCREED',  venue:'Campus Ground',    startDate: new Date().toISOString() },
];

export default function StudentDashboard() {
  const { user }     = useAuth();
  const navigate     = useNavigate();
  const [myClubs,    setMyClubs]    = useState([]);
  const [joinedFull, setJoinedFull] = useState([]);
  const [events,     setEvents]     = useState(STATIC_EVENTS);
  const [totalClubs, setTotalClubs] = useState(0);
  const [loading,    setLoading]    = useState(true);

  /* ── Coin / leaderboard state ── */
  const [myCoins,          setMyCoins]          = useState(0);
  /* ── College calendar state ── */
  const [calEvents,    setCalEvents]    = useState([]);
  const [calLoading,   setCalLoading]   = useState(true);

  /* ── Wall of Fame notification ── */
  const [wofNotif, setWofNotif] = useState(null);

  /* ── SOAC Updates + My Activity preview (replaces the coins/leaderboard cards).
     Notifications has its own dedicated sidebar page — not duplicated here. ── */
  const [soacUpdates,  setSoacUpdates]  = useState([]);
  const [soacLoading,  setSoacLoading]  = useState(true);
  const [myActivity,   setMyActivity]   = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/users/me/clubs').catch(() => ({ clubs: [] })),
      api.get('/clubs').catch(() => ({ clubs: [] })),
      api.get('/events?status=upcoming').catch(() => ({ events: [] })),
    ]).then(([myRes, allRes, evRes]) => {
      const joined = (myRes.clubs || []).filter(c => c);
      const all    = (allRes.clubs || []).length ? allRes.clubs : STATIC_CLUBS;
      const evList = (evRes.events || []).length ? evRes.events : STATIC_EVENTS;

      setMyClubs(joined);
      setTotalClubs(all.length);

      const enriched = joined.map(jc => {
        const full = all.find(c => String(c._id || c.id) === String(jc.club_id));
        return full ? { ...full, joined_at: jc.joined_at } : { name: jc.club_name, _id: jc.club_id, joined_at: jc.joined_at };
      });
      setJoinedFull(enriched);

      const joinedNames = new Set(joined.map(c => (c.club_name || '').toLowerCase()));
      const myEvents = evList.filter(e => joinedNames.has((e.club || '').toLowerCase()));
      setEvents((myEvents.length > 0 ? myEvents : evList).slice(0, 5));
    }).finally(() => setLoading(false));
  }, []);

  /* ── Fetch coins (still used by the hero "Coins" stat) ── */
  useEffect(() => {
    api.get('/users/me/coins')
      .then(d => setMyCoins(d.coins || 0))
      .catch(() => setMyCoins(0));
  }, []);

  /* ── Fetch Wall of Fame notification ── */
  useEffect(() => {
    api.get('/users/me/notifications')
      .then(d => {
        const wof = (d.notifications || []).find(n => n.type === 'wall_of_fame');
        if (wof) setWofNotif(wof);
      })
      .catch(() => {});
  }, []);

  /* ── SOAC Updates preview ── */
  useEffect(() => {
    api.get('/announcements/soac')
      .then(d => setSoacUpdates((d.announcements || []).slice(0, 4)))
      .catch(() => setSoacUpdates([]))
      .finally(() => setSoacLoading(false));
  }, []);

  /* ── My Activity preview (recent event registrations) ── */
  useEffect(() => {
    api.get('/users/me/activity')
      .then(d => setMyActivity((d.registrations || []).slice(0, 4)))
      .catch(() => setMyActivity([]))
      .finally(() => setActivityLoading(false));
  }, []);

  const dismissWofNotif = (id) => {
    setWofNotif(null);
    api.patch(`/users/me/notifications/${id}/read`, {})
      .then(() => refreshAppBadge(api))
      .catch(() => {});
  };

  /* ── Fetch college calendar (current + next month) ── */
  useEffect(() => {
    const now = new Date();
    const year = now.getFullYear();
    Promise.all([
      api.get(`/calendar?year=${year}&month=${now.getMonth()}`).catch(() => ({ events: [] })),
      api.get(`/calendar?year=${year}&month=${now.getMonth() + 1}`).catch(() => ({ events: [] })),
    ]).then(([r1, r2]) => {
      const today = now.toISOString().slice(0, 10);
      const combined = [...(r1.events || []), ...(r2.events || [])]
        .filter(e => (e.startDate || '').slice(0, 10) >= today)
        .sort((a, b) => a.startDate > b.startDate ? 1 : -1)
        .slice(0, 12);
      setCalEvents(combined);
    }).finally(() => setCalLoading(false));
  }, []);

  const firstName = user?.name?.split(' ')[0] || 'Student';
  const slotsLeft = 3 - myClubs.length;

  return (
    <div className={s.page}>

      {/* Hero */}
      <div className={s.hero}>
        <div className={s.heroText}>
          <div className={s.pill}>🎓 SOAC Student Portal</div>
          <h1 className={s.heroTitle}>{greeting()}, {firstName}!</h1>
          <p className={s.heroSub}>
            {myClubs.length > 0
              ? `You're a member of ${myClubs.length} club${myClubs.length > 1 ? 's' : ''}. ${slotsLeft > 0 ? `You can join ${slotsLeft} more.` : 'You\'ve reached the max of 3 clubs.'}`
              : 'Explore clubs, track events, and make the most of your campus life at RK University.'}
          </p>
        </div>
        <div className={s.heroStats}>
          <div className={s.heroStat}>
            <div className={s.heroStatN}>{totalClubs || 40}</div>
            <div className={s.heroStatL}>Clubs</div>
          </div>
          <div className={s.heroStat}>
            <div className={s.heroStatN} style={{ color: myClubs.length >= 3 ? '#fbbf24' : '#fff' }}>
              {myClubs.length}/3
            </div>
            <div className={s.heroStatL}>Joined</div>
          </div>
          <div className={s.heroStat}>
            <div className={s.heroStatN}>{myCoins}</div>
            <div className={s.heroStatL}>Coins</div>
          </div>
        </div>
      </div>

      {/* Wall of Fame notification — appears right after greeting */}
      {wofNotif && (
        <div className={s.wofBanner}>
          <div className={s.wofBannerStar}>★</div>
          <div className={s.wofBannerContent}>
            <div className={s.wofBannerTitle}>Congratulations, {firstName}!</div>
            <div className={s.wofBannerBody}>{wofNotif.body}</div>
          </div>
          <button
            className={s.wofBannerClose}
            onClick={() => dismissWofNotif(wofNotif.id)}
            aria-label="Dismiss"
          >×</button>
        </div>
      )}

      {/* My Clubs — only shown if joined any */}
      {!loading && myClubs.length > 0 && (
        <div className={s.myClubsStrip}>
          <div className={s.stripLabel}>My Clubs</div>
          <div className={s.stripClubs}>
            {joinedFull.map((c, i) => (
              <div key={c._id || i} className={s.stripClub} onClick={() => navigate('/student/clubs')}>
                <div
                  className={s.stripAvatar}
                  style={{ background: c.color ? c.color + '28' : '#635bff18', color: c.color || '#635bff', borderColor: c.color ? c.color + '40' : '#635bff30' }}
                >
                  {c.name?.[0]?.toUpperCase() || '?'}
                </div>
                <span className={s.stripName}>{c.name}</span>
              </div>
            ))}
            {slotsLeft > 0 && (
              <div className={s.stripAdd} onClick={() => navigate('/student/clubs')}>
                <div className={s.stripAddIcon}>+</div>
                <span className={s.stripName}>{slotsLeft} slot{slotsLeft > 1 ? 's' : ''} left</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className={s.actions}>
        {[
          { label:'My Clubs',        desc:'Clubs you\'ve joined',        onClick:() => navigate('/student/clubs')     },
          { label:'Events',           desc:'Upcoming campus events',      onClick:() => navigate('/student/events')    },
          { label:'Calendar',         desc:'College events & exams',      onClick:() => navigate('/student/calendar')  },
          { label:'Wall of Fame',     desc:'Top contributors',            onClick:() => navigate('/student/fame')      },
        ].map((a, i) => (
          <button key={i} className={s.actionCard} onClick={a.onClick}>
            <span className={s.actionLabel}>{a.label}</span>
            <span className={s.actionDesc}>{a.desc}</span>
          </button>
        ))}
      </div>

      {/* ── SOAC Updates + My Activity ── */}
      <div className={s.rewardRow}>

        {/* SOAC Updates */}
        <div className={s.lbCard}>
          <div className={s.lbHead}>
            <div>
              <div className={s.lbTitle}>SOAC Updates</div>
              <div className={s.lbSub}>Latest announcements from SOAC</div>
            </div>
            <button className={s.seeAll} onClick={() => navigate('/student/soac-updates')}>View All</button>
          </div>
          {soacLoading ? (
            <div className={s.loadList}>
              {[1,2,3].map(i => <div key={i} className={s.shimmer} style={{ height:44, borderRadius:9 }} />)}
            </div>
          ) : soacUpdates.length === 0 ? (
            <div className={s.empty}>No updates yet.</div>
          ) : (
            <div className={s.updList}>
              {soacUpdates.map(u => (
                <button key={u.id} className={s.updRow} onClick={() => navigate('/student/soac-updates')}>
                  <div className={s.updTitle}>{u.title}</div>
                  {u.body && <div className={s.updBody}>{u.body}</div>}
                  <div className={s.updMeta}>{new Date(u.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* My Activity */}
        <div className={s.lbCard}>
          <div className={s.lbHead}>
            <div>
              <div className={s.lbTitle}>My Activity</div>
              <div className={s.lbSub}>Events you've registered for</div>
            </div>
            <button className={s.seeAll} onClick={() => navigate('/student/profile')}>View All</button>
          </div>
          {activityLoading ? (
            <div className={s.loadList}>
              {[1,2,3].map(i => <div key={i} className={s.shimmer} style={{ height:44, borderRadius:9 }} />)}
            </div>
          ) : myActivity.length === 0 ? (
            <div className={s.empty}>No activity yet.</div>
          ) : (
            <div className={s.updList}>
              {myActivity.map(r => (
                <button key={r.eventId} className={s.updRow} onClick={() => navigate('/student/profile')}>
                  <div className={s.updTitle}>{r.eventTitle}</div>
                  <div className={s.updBody}>{r.clubName}{r.category ? ` · ${r.category}` : ''}</div>
                  <div className={s.updMeta}>
                    {/* eventDate is a free-text display string (e.g. "23 & 24th"), not an
                       ISO date — shown verbatim, never parsed. registeredAt is a real
                       timestamp and is the fallback when no eventDate was set. */}
                    {r.eventDate || (r.registeredAt ? new Date(r.registeredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—')}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── College Calendar ── */}
      <div className={s.calSection}>
        <div className={s.sectionHead}>
          <h2 className={s.sectionTitle}>📅 College Calendar</h2>
          <button className={s.seeAll} onClick={() => navigate('/student/calendar')}>View Full Calendar →</button>
        </div>
        {calLoading ? (
          <div className={s.loadList}>
            {[1,2,3].map(i => <div key={i} className={s.shimmer} style={{ height: 52, borderRadius: 10 }} />)}
          </div>
        ) : calEvents.length === 0 ? (
          <div className={s.calEmpty}>No upcoming college events scheduled.</div>
        ) : (
          <div className={s.calList}>
            {calEvents.map(ev => {
              const meta = CAL_TYPE_META[ev.type] || CAL_TYPE_META.event;
              const d    = new Date(ev.startDate);
              const mon  = d.toLocaleString('default', { month: 'short' });
              const day  = d.getDate();
              return (
                <div key={ev.id} className={s.calRow} style={{ borderLeftColor: meta.color }}>
                  <div className={s.calDate}>
                    <div className={s.calMon}>{mon}</div>
                    <div className={s.calDay}>{day}</div>
                  </div>
                  <div className={s.calInfo}>
                    <div className={s.calTitle}>{ev.title}</div>
                    {ev.description && <div className={s.calDesc}>{ev.description}</div>}
                  </div>
                  <span className={s.calTypeBadge}
                    style={{ background: meta.bg, color: meta.color }}>
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={s.cols}>
        {/* Upcoming events */}
        <div className={s.section}>
          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>
              {myClubs.length > 0 ? 'Events from My Clubs' : 'Upcoming Events'}
            </h2>
            <button className={s.seeAll} onClick={() => navigate('/student/events')}>See all →</button>
          </div>
          {loading ? (
            <div className={s.loadList}>
              {[1,2,3].map(i => <div key={i} className={s.shimmer} style={{ height:60, borderRadius:10 }} />)}
            </div>
          ) : events.length === 0 ? (
            <div className={s.empty}>No upcoming events found.</div>
          ) : (
            <div className={s.eventList}>
              {events.map((e, i) => {
                const { mon, day } = fmtEventDate(e);
                return (
                  <div key={e._id || i} className={s.eventRow}>
                    <div className={s.eventDate}>
                      <div className={s.eventMon}>{mon}</div>
                      <div className={s.eventDay}>{day}</div>
                    </div>
                    <div className={s.eventInfo}>
                      <div className={s.eventName}>{e.title}</div>
                      <div className={s.eventMeta}>{e.club} · {e.venue || 'TBD'}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Joined clubs or explore */}
        <div className={s.section}>
          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>{myClubs.length > 0 ? 'My Clubs' : 'Explore Clubs'}</h2>
            <button className={s.seeAll} onClick={() => navigate('/student/clubs')}>
              {myClubs.length > 0 ? 'Manage →' : 'Browse →'}
            </button>
          </div>
          {loading ? (
            <div className={s.loadList}>
              {[1,2,3].map(i => <div key={i} className={s.shimmer} style={{ height:54, borderRadius:10 }} />)}
            </div>
          ) : myClubs.length > 0 ? (
            <div className={s.clubList}>
              {joinedFull.map((c, i) => (
                <div key={c._id || i} className={s.clubRow} style={{ cursor:'pointer' }} onClick={() => navigate('/student/clubs')}>
                  <div className={s.clubColor} style={{ background: c.color || '#635BFF', width:12, height:12 }} />
                  <div className={s.clubInfo}>
                    <div className={s.clubName}>{c.name}</div>
                    <div className={s.clubMeta}>{c.category} · Member</div>
                  </div>
                  <span className={s.clubBadge} style={{ background:'#e8fdf5', color:'#059669' }}>✓ Joined</span>
                </div>
              ))}
              {slotsLeft > 0 && (
                <div
                  className={s.clubRow}
                  style={{ cursor:'pointer', background:'#f8fffe', border:'1.5px dashed #0f766e30' }}
                  onClick={() => navigate('/student/clubs')}
                >
                  <div style={{ width:12, height:12, borderRadius:'50%', background:'#0f766e', flexShrink:0 }} />
                  <div className={s.clubInfo}>
                    <div className={s.clubName} style={{ color:'#0f766e' }}>Join More Clubs</div>
                    <div className={s.clubMeta}>{slotsLeft} slot{slotsLeft > 1 ? 's' : ''} remaining</div>
                  </div>
                  <span className={s.clubBadge}>+ Join</span>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className={s.empty} style={{ paddingBottom:12 }}>
                You haven't joined any clubs yet.
              </div>
              <button
                onClick={() => navigate('/student/clubs')}
                style={{ width:'100%', padding:'10px', background:'linear-gradient(135deg,#0f766e,#059669)', color:'#fff', border:'none', borderRadius:10, fontWeight:700, fontSize:'.875rem', cursor:'pointer' }}
              >
                Browse Clubs →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
