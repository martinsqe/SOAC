import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import s from './StudentDashboard.module.css';

/* ── College calendar type metadata ── */
const CAL_TYPE_META = {
  event:    { label: 'Event',    color: '#635BFF', bg: '#f0f0ff' },
  holiday:  { label: 'Holiday',  color: '#10b981', bg: '#ecfdf5' },
  exam:     { label: 'Exam',     color: '#ef4444', bg: '#fff0f0' },
  deadline: { label: 'Deadline', color: '#f59e0b', bg: '#fffbeb' },
  academic: { label: 'Academic', color: '#3b82f6', bg: '#eff6ff' },
};

/* ── Coin helpers (mirrors backend formula) ── */
const TIERS = [
  { min: 1000, label: 'Platinum Elite', color: '#a855f7', bg: '#faf5ff', icon: '💎' },
  { min: 500,  label: 'Gold Member',    color: '#d97706', bg: '#fffbeb', icon: '🥇' },
  { min: 200,  label: 'Silver Member',  color: '#64748b', bg: '#f1f5f9', icon: '🥈' },
  { min: 50,   label: 'Bronze Member',  color: '#92400e', bg: '#fef3c7', icon: '🥉' },
  { min: 0,    label: 'Newcomer',       color: '#9ca3af', bg: '#f9fafb', icon: '🌱' },
];
const getTier = (coins) => TIERS.find(t => coins >= t.min) || TIERS[TIERS.length - 1];

/* Top-3 qualify for the Free Registration award */
const FREE_REG_RANKS = 3;

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
  { _id:'1', name:'Android Development Club',      category:'tech',      color:'#3DDC84', logo:'ANDROID DEVLOPMENT CLUB.png',       memberCount:98,  eventCount:4 },
  { _id:'2', name:'Webify Club',                   category:'tech',      color:'#635BFF', logo:'WEBIFY.png',                        memberCount:74,  eventCount:3 },
  { _id:'3', name:'iOS Development Club',          category:'tech',      color:'#007AFF', logo:'iOS DEVLOPMENT CLUB.png',           memberCount:52,  eventCount:2 },
  { _id:'4', name:'RKU Rangers FC',                category:'sports',    color:'#00C896', logo:'RKU RANGERS.png',                   memberCount:84,  eventCount:4 },
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
  const [myCoins,      setMyCoins]      = useState(0);
  const [myRank,       setMyRank]       = useState(null);
  const [myClubProg,   setMyClubProg]   = useState([]);
  const [leaderboard,  setLeaderboard]  = useState([]);
  const [coinsLoading, setCoinsLoading] = useState(true);

  /* ── College calendar state ── */
  const [calEvents,    setCalEvents]    = useState([]);
  const [calLoading,   setCalLoading]   = useState(true);

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

  /* ── Fetch coins + leaderboard ── */
  useEffect(() => {
    Promise.all([
      api.get('/users/me/coins').catch(() => ({ coins: 0, rank: null, clubs: [] })),
      api.get('/clubs/leaderboard?limit=10').catch(() => ({ leaderboard: [] })),
    ]).then(([coinsRes, lbRes]) => {
      setMyCoins(coinsRes.coins || 0);
      setMyRank(coinsRes.rank || null);
      setMyClubProg(coinsRes.clubs || []);
      setLeaderboard(lbRes.leaderboard || []);
    }).finally(() => setCoinsLoading(false));
  }, []);

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
  const myTier    = getTier(myCoins);
  const isFreeReg = myRank !== null && myRank <= FREE_REG_RANKS;

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
          { icon:'🏅', label:'My Clubs',        desc:'Clubs you\'ve joined',        onClick:() => navigate('/student/clubs')     },
          { icon:'📅', label:'Events',           desc:'Upcoming campus events',      onClick:() => navigate('/student/events')    },
          { icon:'🗓️', label:'Calendar',         desc:'College events & exams',      onClick:() => navigate('/student/calendar')  },
          { icon:'📰', label:'News Feed',        desc:'Latest club news',            onClick:() => navigate('/student/news')      },
          { icon:'🏆', label:'Wall of Fame',     desc:'Top contributors',            onClick:() => navigate('/student/fame')      },
        ].map((a, i) => (
          <button key={i} className={s.actionCard} onClick={a.onClick}>
            <span className={s.actionIcon}>{a.icon}</span>
            <span className={s.actionLabel}>{a.label}</span>
            <span className={s.actionDesc}>{a.desc}</span>
          </button>
        ))}
      </div>

      {/* ── Coins card + Leaderboard ── */}
      <div className={s.rewardRow}>

        {/* Personal coins card */}
        <div className={s.coinsCard} style={{ borderColor: myTier.color + '40', background: myTier.bg }}>
          {isFreeReg && (
            <div className={s.freeRegBanner}>
              👑 Free Registration Award — Top {FREE_REG_RANKS} qualifier!
            </div>
          )}
          <div className={s.coinsTop}>
            <div>
              <div className={s.coinsTierIcon}>{myTier.icon}</div>
              <div className={s.coinsTierLabel} style={{ color: myTier.color }}>{myTier.label}</div>
            </div>
            <div className={s.coinsMain}>
              <span className={s.coinsNumber} style={{ color: myTier.color }}>{myCoins}</span>
              <span className={s.coinsSuffix}>coins</span>
            </div>
          </div>
          {myRank && (
            <div className={s.coinsRank}>Global rank #{myRank}</div>
          )}
          {/* Per-club breakdown */}
          {myClubProg.length > 0 && (
            <div className={s.coinsBreakdown}>
              {myClubProg.map((p, i) => (
                <div key={i} className={s.coinsBkRow}>
                  <div className={s.coinsBkDot} style={{ background: p.color || '#635BFF' }} />
                  <span className={s.coinsBkName}>{p.club_name}</span>
                  <span className={s.coinsBkVal}>{p.xp} XP · <strong>{p.coins}</strong> coins</span>
                </div>
              ))}
            </div>
          )}
          {myClubProg.length === 0 && !coinsLoading && (
            <p className={s.coinsEmpty}>Join clubs and get your progress tracked by coordinators to earn coins.</p>
          )}
          <div className={s.coinsHint}>
            Coins = XP × level multiplier (Expert=3× · Advanced=2× · Intermediate=1.5× · Beginner=1×)
          </div>
        </div>

        {/* Global leaderboard */}
        <div className={s.lbCard}>
          <div className={s.lbHead}>
            <div>
              <div className={s.lbTitle}>🏆 Coin Leaderboard</div>
              <div className={s.lbSub}>Top 3 earn free event registration at year end</div>
            </div>
          </div>
          {coinsLoading ? (
            <div className={s.loadList}>
              {[1,2,3,4,5].map(i => <div key={i} className={s.shimmer} style={{ height:44, borderRadius:9 }} />)}
            </div>
          ) : leaderboard.length === 0 ? (
            <div className={s.empty}>No progress data yet. Coordinators set XP to earn coins.</div>
          ) : (
            <div className={s.lbList}>
              {leaderboard.map((entry, i) => {
                const rank   = i + 1;
                const tier   = getTier(entry.coins);
                const isMe   = String(entry.user_id) === String(user?.id);
                const topThree = rank <= FREE_REG_RANKS;
                return (
                  <div key={entry.user_id}
                    className={`${s.lbRow} ${isMe ? s.lbRowMe : ''} ${topThree ? s.lbRowTop : ''}`}>
                    <div className={s.lbRank} style={{ color: topThree ? '#d97706' : '#9ca3af' }}>
                      {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`}
                    </div>
                    <div className={s.lbAvatar} style={{ background: tier.color + '22', color: tier.color }}>
                      {entry.user_name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className={s.lbInfo}>
                      <span className={s.lbName}>
                        {entry.user_name}
                        {isMe && <span className={s.lbYou}>you</span>}
                        {topThree && <span className={s.lbFreeReg}>Free Reg</span>}
                      </span>
                      <span className={s.lbMeta}>{entry.club_count} club{entry.club_count !== 1 ? 's' : ''} · {entry.total_xp} XP</span>
                    </div>
                    <div className={s.lbCoins} style={{ color: tier.color }}>
                      {tier.icon} {entry.coins}
                    </div>
                  </div>
                );
              })}
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
