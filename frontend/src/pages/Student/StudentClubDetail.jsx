import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import s from './StudentClubDetail.module.css';

const AVATAR_BASE = '/uploads/avatars/';

const TABS = [
  { key: 'Overview',    label: 'Overview'   },
  { key: 'Schedule',   label: 'Schedule'   },
  { key: 'Members',    label: 'Members'    },
  { key: 'Rules',      label: 'Rules'      },
  { key: 'Leadership', label: 'Leadership' },
  { key: 'Chat',       label: 'Chat'       },
  { key: 'Tasks',      label: 'Tasks'      },
];

const DEFAULT_RULES = [
  'Attend at least 70% of scheduled club meetings and events.',
  'Treat all members with respect — zero tolerance for harassment or discrimination.',
  'Complete assigned tasks and responsibilities on time.',
  'Represent the club and RKU with integrity at all events.',
  'Seek coordinator approval before organising external activities.',
  'Active participation in at least one club initiative per semester.',
];

const FIXED_STUDENT_ROLES = [
  { label: 'Student Coordinator I',  desc: 'Leads student activities and club operations.' },
  { label: 'Student Coordinator II', desc: 'Supports coordination and member engagement.'  },
  { label: 'Club Treasurer',         desc: 'Manages club finances and budget tracking.'    },
];

const PRIORITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };
const STATUS_LABEL   = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };
const STATUS_COLOR   = { todo: '#6b7280', in_progress: '#f59e0b', done: '#22c55e' };

/* ── Helpers ── */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (d < 1)  return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 30)  return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  if (d.toDateString() === yest.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function avatarUrl(filename) {
  if (!filename) return '';
  return filename.startsWith('http') ? filename : AVATAR_BASE + filename;
}

/* ── Avatar component ── */
function Avatar({ name, src, size = 36, color = '#635BFF' }) {
  const [imgErr, setImgErr] = useState(false);
  const initial = name?.charAt(0)?.toUpperCase() || '?';
  if (src && !imgErr) {
    return (
      <img
        src={src} alt={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        onError={() => setImgErr(true)}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 800, color: '#fff', flexShrink: 0,
      fontFamily: "'Plus Jakarta Sans', sans-serif",
    }}>
      {initial}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main component
═══════════════════════════════════════════════════════════════════════════ */
export default function StudentClubDetail() {
  const { id }       = useParams();
  const navigate     = useNavigate();
  const { user }     = useAuth();
  const { state }    = useLocation();

  /* ── Club — seed from nav state so page renders instantly (no white flash) ── */
  const [club,    setClub]    = useState(state?.club || null);
  const [loading, setLoading] = useState(true);

  /* ── Active tab ── */
  const [tab, setTab] = useState('Overview');

  /* ── Membership (badge only) ── */
  const [isMember, setIsMember] = useState(false);

  /* ── Members tab ── */
  const [members,       setMembers]       = useState([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [mSearch,       setMSearch]       = useState('');

  /* ── Leadership tab ── */
  const [leadership,   setLeadership]   = useState([]);
  const [leaderLoaded, setLeaderLoaded] = useState(false);

  /* ── Chat tab ── */
  const [messages,    setMessages]    = useState([]);
  const [chatLoaded,  setChatLoaded]  = useState(false);
  const [chatError,   setChatError]   = useState('');
  const [chatInput,   setChatInput]   = useState('');
  const [chatSending, setChatSending] = useState(false);
  const lastMsgIdRef  = useRef(null);
  const msgIdsRef     = useRef(new Set());
  const chatEndRef    = useRef(null);

  /* ── Tasks tab ── */
  const [tasks,       setTasks]       = useState([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [tasksError,  setTasksError]  = useState('');

  const color = club?.color || '#635BFF';

  /* ──────────────────────────────────────────────────────────────────────
     Initial load: club + membership badge + member list (for header count)
  ────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/clubs/${id}`).catch(() => null),
      api.get(`/clubs/${id}/membership`).catch(() => ({ isMember: false })),
      api.get(`/clubs/${id}/members?limit=200`).catch(() => ({ members: [] })),
    ]).then(([clubRes, memRes, mListRes]) => {
      /* Use live API data if available; fall back to the club passed via nav state */
      if (clubRes?.club) setClub(clubRes.club);
      /* if clubRes is null (API failed), keep whatever is already in state (nav state club) */
      setIsMember(!!memRes.isMember);
      setMembers(mListRes.members || []);
      setMembersLoaded(true);
    }).finally(() => setLoading(false));
  }, [id]);

  /* ──────────────────────────────────────────────────────────────────────
     Load data when tab is first opened
  ────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    /* Members are pre-loaded on mount — only re-fetch if switching back after a reset */
    if (tab === 'Members' && !membersLoaded) {
      api.get(`/clubs/${id}/members?limit=200`)
        .then(({ members }) => setMembers(members || []))
        .catch(() => {})
        .finally(() => setMembersLoaded(true));
    }

    if (tab === 'Leadership' && !leaderLoaded) {
      api.get(`/clubs/${id}/leadership`)
        .then(({ leadership }) => setLeadership(leadership || []))
        .catch(() => {})
        .finally(() => setLeaderLoaded(true));
    }
  }, [tab, id, membersLoaded, leaderLoaded]);

  /* ──────────────────────────────────────────────────────────────────────
     Chat: initial load + 3 s poll while tab is active
     Open to all authenticated users — no membership gate.
  ────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (tab !== 'Chat') return;
    let cancelled = false;

    const loadInitial = async () => {
      if (chatLoaded) return;
      try {
        const { messages: msgs } = await api.get(`/clubs/${id}/messages?limit=60`);
        if (cancelled) return;
        msgs.forEach(m => msgIdsRef.current.add(String(m.id)));
        setMessages(msgs);
        if (msgs.length) lastMsgIdRef.current = msgs[msgs.length - 1].id;
        setChatLoaded(true);
      } catch (err) {
        if (!cancelled) setChatError(err.message || 'Could not load messages.');
        setChatLoaded(true);
      }
    };

    const poll = async () => {
      if (!lastMsgIdRef.current) return;
      try {
        const { messages: newMsgs } = await api.get(`/clubs/${id}/messages?after=${lastMsgIdRef.current}`);
        if (cancelled || !newMsgs.length) return;
        const fresh = newMsgs.filter(m => !msgIdsRef.current.has(String(m.id)));
        if (!fresh.length) return;
        fresh.forEach(m => msgIdsRef.current.add(String(m.id)));
        setMessages(prev => [...prev, ...fresh]);
        lastMsgIdRef.current = fresh[fresh.length - 1].id;
      } catch (_) {}
    };

    loadInitial();
    const interval = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [tab, id, chatLoaded]);

  /* Auto-scroll chat to bottom */
  useEffect(() => {
    if (tab === 'Chat') chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, tab]);

  /* ──────────────────────────────────────────────────────────────────────
     Tasks: load + 10 s poll while tab is active
     Open to all authenticated users — no membership gate.
  ────────────────────────────────────────────────────────────────────── */
  const loadTasks = useCallback(async () => {
    try {
      const { tasks } = await api.get(`/clubs/${id}/tasks`);
      setTasks(tasks || []);
      setTasksLoaded(true);
      setTasksError('');
    } catch (err) {
      setTasksError(err.message || 'Could not load tasks.');
      setTasksLoaded(true);
    }
  }, [id]);

  useEffect(() => {
    if (tab !== 'Tasks') return;
    loadTasks();
    const interval = setInterval(loadTasks, 10000);
    return () => clearInterval(interval);
  }, [tab, loadTasks]);

  /* ──────────────────────────────────────────────────────────────────────
     Chat send
  ────────────────────────────────────────────────────────────────────── */
  const handleSend = async (e) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || chatSending) return;
    setChatSending(true);
    setChatError('');
    try {
      const { message } = await api.post(`/clubs/${id}/messages`, { content: text });
      if (!msgIdsRef.current.has(String(message.id))) {
        msgIdsRef.current.add(String(message.id));
        setMessages(prev => [...prev, message]);
        lastMsgIdRef.current = message.id;
      }
      setChatInput('');
    } catch (err) {
      setChatError(err.message || 'Failed to send.');
    } finally {
      setChatSending(false);
    }
  };

  /* ──────────────────────────────────────────────────────────────────────
     Loading / not-found
  ────────────────────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className={s.page}>
        <div className={s.loadWrap}><div className={s.spinner} /><p>Loading club…</p></div>
      </div>
    );
  }

  if (!club) {
    return (
      <div className={s.page}>
        <div className={s.empty}>
          <div className={s.emptyIcon}>🏆</div>
          <p>Club not found</p>
          <button className={s.backBtn} onClick={() => navigate('/student/clubs')}>← Back to Clubs</button>
        </div>
      </div>
    );
  }

  const rules           = club.rules?.length ? club.rules : DEFAULT_RULES;
  const filteredMembers = members.filter(m =>
    !mSearch ||
    m.name?.toLowerCase().includes(mSearch.toLowerCase()) ||
    m.email?.toLowerCase().includes(mSearch.toLowerCase()) ||
    m.dept?.toLowerCase().includes(mSearch.toLowerCase())
  );

  const tasksByStatus = {
    todo:        tasks.filter(t => t.status === 'todo'),
    in_progress: tasks.filter(t => t.status === 'in_progress'),
    done:        tasks.filter(t => t.status === 'done'),
  };

  /* ──────────────────────────────────────────────────────────────────────
     Render
  ────────────────────────────────────────────────────────────────────── */
  return (
    <div className={s.page}>

      {/* ── Hero ── */}
      <div className={s.hero}
        style={{ background: `linear-gradient(135deg,${color}1a 0%,${color}06 100%)`, borderColor: color + '28' }}>
        <button className={s.backLink} onClick={() => navigate('/student/clubs')}>← All Clubs</button>

        <div className={s.heroBody}>
          {/* Logo */}
          <div className={s.heroLogo} style={{ background: color + '1a', borderColor: color + '40' }}>
            {club.logoUrl ? (
              <img src={club.logoUrl} alt={club.name}
                onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
            ) : null}
            <div className={s.heroLogoFb} style={{ background: color, display: club.logoUrl ? 'none' : 'flex' }}>
              {club.name.charAt(0)}
            </div>
          </div>

          {/* Info */}
          <div className={s.heroInfo}>
            <div className={s.heroCat} style={{ background: color + '18', color }}>
              {club.category?.toUpperCase()}
            </div>
            <h1 className={s.heroName}>{club.name}</h1>
            {club.description && <p className={s.heroDesc}>{club.description}</p>}
            <div className={s.heroMeta}>
              {club.coordinator && <span>👤 {club.coordinator}</span>}
              {club.foundedYear  && <span>📅 Est. {club.foundedYear}</span>}
              {isMember && <span className={s.memberBadge} style={{ background: color + '18', color }}>✓ Member</span>}
            </div>
          </div>

          {/* Stats */}
          <div className={s.heroStats}>
            <div className={s.stat}>
              <div className={s.statN} style={{ color }}>{club.memberCount || members.length || 0}</div>
              <div className={s.statL}>Members</div>
            </div>
            <div className={s.statDiv} />
            <div className={s.stat}>
              <div className={s.statN} style={{ color }}>{club.eventCount || 0}</div>
              <div className={s.statL}>Events</div>
            </div>
            <div className={s.statDiv} />
            <div className={s.stat}>
              <div className={s.statN} style={{ color }}>
                {club.foundedYear ? new Date().getFullYear() - parseInt(club.foundedYear) : '—'}
              </div>
              <div className={s.statL}>Years Active</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className={s.tabBar}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            className={`${s.tabBtn} ${tab === key ? s.tabBtnOn : ''}`}
            style={tab === key ? { borderBottomColor: color, color } : {}}
            onClick={() => setTab(key)}
          >
            {label}
            {key === 'Members' && membersLoaded && members.length > 0 && (
              <span className={s.tabCount} style={{ background: color + '18', color }}>{members.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className={s.tabContent}>

        {/* ════════════════════════════════ OVERVIEW ════════════════════════════════ */}
        {tab === 'Overview' && (
          <div className={s.overviewGrid}>

            <div className={s.card}>
              <div className={s.cardHead}>
                <span className={s.cardIcon} style={{ background: color + '18', color }}>ℹ</span>
                <span className={s.cardTitle}>About</span>
              </div>
              <p className={s.cardText}>{club.description || 'No description available.'}</p>
              {club.vision && (
                <p className={s.cardText} style={{ marginTop: 10, fontStyle: 'italic', color: '#555', borderLeft: `3px solid ${color}40`, paddingLeft: 12 }}>
                  "{club.vision}"
                </p>
              )}
            </div>

            {club.tags?.length > 0 && (
              <div className={s.card}>
                <div className={s.cardHead}>
                  <span className={s.cardIcon} style={{ background: color + '18', color }}>⭐</span>
                  <span className={s.cardTitle}>Values & Focus Areas</span>
                </div>
                <div className={s.tagWrap}>
                  {club.tags.map((t, i) => (
                    <span key={i} className={s.valueTag}
                      style={{ background: color + '13', color, borderColor: color + '30' }}>{t}</span>
                  ))}
                </div>
              </div>
            )}

            <div className={s.card}>
              <div className={s.cardHead}>
                <span className={s.cardIcon} style={{ background: color + '18', color }}>👔</span>
                <span className={s.cardTitle}>Faculty Coordinator</span>
              </div>
              <div className={s.coordCard}>
                <div className={s.coordAv} style={{ background: color }}>
                  {club.coordinator?.charAt(0)?.toUpperCase() || 'C'}
                </div>
                <div>
                  <div className={s.coordName}>{club.coordinator || 'TBA'}</div>
                  <div className={s.coordRole}>Faculty Coordinator</div>
                  <div className={s.coordBadge} style={{ background: color + '18', color }}>Active</div>
                </div>
              </div>
            </div>

            <div className={s.card}>
              <div className={s.cardHead}>
                <span className={s.cardIcon} style={{ background: color + '18', color }}>📊</span>
                <span className={s.cardTitle}>Quick Info</span>
              </div>
              <div className={s.infoList}>
                {club.foundedYear && (
                  <div className={s.infoRow}>
                    <span className={s.infoLabel}>Founded</span>
                    <span className={s.infoVal}>{club.foundedYear}</span>
                  </div>
                )}
                {club.category && (
                  <div className={s.infoRow}>
                    <span className={s.infoLabel}>Category</span>
                    <span className={s.infoVal} style={{ textTransform: 'capitalize' }}>{club.category}</span>
                  </div>
                )}
                <div className={s.infoRow}>
                  <span className={s.infoLabel}>Members</span>
                  <span className={s.infoVal}>{club.memberCount || members.length || 0}</span>
                </div>
                <div className={s.infoRow}>
                  <span className={s.infoLabel}>Events Hosted</span>
                  <span className={s.infoVal}>{club.eventCount || 0}</span>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ════════════════════════════════ SCHEDULE ════════════════════════════════ */}
        {tab === 'Schedule' && (() => {
          const DAYS  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
          const SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
          const sched = club.schedule || '';

          /* Parse "Day: content" lines vs. generic notes */
          const dayMap = {};
          const genericLines = [];
          sched.split('\n').forEach(line => {
            const t = line.trim();
            if (!t) return;
            const found = DAYS.find(d => t.toLowerCase().startsWith(d.toLowerCase() + ':'));
            if (found) { dayMap[found] = t.slice(found.length + 1).trim(); }
            else        { genericLines.push(t); }
          });

          const activeDays    = new Set(Object.keys(dayMap));
          const hasStructured = activeDays.size > 0;

          /* For generic lines that remain, give them icons */
          const iconFor = (line) => {
            const l = line.toLowerCase();
            if (l.includes('hackathon') || l.includes('sprint'))  return '⚡';
            if (l.includes('workshop'))                            return '🛠';
            if (l.includes('showcase') || l.includes('demo'))     return '🎯';
            if (l.includes('festival') || l.includes('fest'))     return '🎉';
            if (l.includes('annual')   || l.includes('semester')) return '🏆';
            if (l.includes('monthly')  || l.includes('month'))    return '📅';
            if (l.includes('weekly')   || l.includes('every'))    return '🔄';
            return '📌';
          };

          return (
            <div className={s.scheduleWrap}>
              {!sched ? (
                <div className={s.emptyCard}>
                  <span style={{ fontSize: 36 }}>📆</span>
                  <p className={s.emptyCardTitle}>No schedule posted yet</p>
                  <p className={s.emptyCardSub}>Check back soon or ask your coordinator for meeting times.</p>
                </div>
              ) : (
                <>
                  {/* ── Weekly day pills ── */}
                  <div className={s.weekRow}>
                    {DAYS.map((day, i) => {
                      const on = activeDays.has(day);
                      return (
                        <div key={day}
                          className={`${s.dayCell} ${on ? s.dayCellOn : ''}`}
                          style={on ? { borderColor: color, background: color + '14', color } : {}}
                        >
                          <span className={s.dayShort}>{SHORT[i]}</span>
                          {on && <span className={s.dayDot} style={{ background: color }} />}
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Structured per-day rows ── */}
                  {hasStructured && (
                    <div className={s.daySchedList}>
                      {DAYS.filter(d => dayMap[d]).map(day => (
                        <div key={day} className={s.daySchedRow}>
                          <div className={s.daySchedName} style={{ background: color + '14', color }}>
                            {day}
                          </div>
                          <div className={s.daySchedContent}>{dayMap[day]}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── Generic / notes lines ── */}
                  {genericLines.length > 0 && (
                    <div className={s.schedItems}>
                      {genericLines.map((line, i) => (
                        <div key={i} className={s.schedItem}>
                          <div className={s.schedIconWrap} style={{ background: color + '14' }}>
                            <span className={s.schedIcon}>{iconFor(line)}</span>
                          </div>
                          <div className={s.schedBody}>
                            <p className={s.schedText}>{line.replace(/\.$/, '')}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {/* ════════════════════════════════ MEMBERS ════════════════════════════════ */}
        {tab === 'Members' && (
          <div>
            <div className={s.membersBar}>
              <span className={s.membersCount}>
                {membersLoaded ? `${members.length} member${members.length !== 1 ? 's' : ''}` : 'Loading…'}
              </span>
              <input
                className={s.membersSearch}
                placeholder="Search name, email or dept…"
                value={mSearch}
                onChange={e => setMSearch(e.target.value)}
              />
            </div>

            {!membersLoaded ? (
              <div className={s.loadWrap}><div className={s.spinner} /></div>
            ) : filteredMembers.length === 0 ? (
              <div className={s.empty}>
                <div className={s.emptyIcon}>👥</div>
                <p>{mSearch ? 'No members match your search' : 'No members yet'}</p>
              </div>
            ) : (
              <div className={s.membersGrid}>
                {filteredMembers.map((m, i) => {
                  const COLORS = [color, '#FF6B35', '#3DDC84', '#FF6B9D', '#06D6A0', '#845EF7'];
                  const av = COLORS[i % COLORS.length];
                  return (
                    <div key={m.id || i} className={s.memberCard}>
                      <div className={s.memberAv} style={{ background: av }}>
                        {m.name?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      <div className={s.memberInfo}>
                        <div className={s.memberName}>{m.name}</div>
                        <div className={s.memberMeta}>{[m.dept, m.year].filter(Boolean).join(' · ')}</div>
                        {m.enrollmentNo && <div className={s.memberEnroll}>{m.enrollmentNo}</div>}
                      </div>
                      <div className={s.memberJoined}>{timeAgo(m.joined_at)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════ RULES ════════════════════════════════ */}
        {tab === 'Rules' && (
          <div className={s.rulesWrap}>

            {/* ── Club Rules ── */}
            <div className={s.card} style={{ maxWidth: 680 }}>
              <div className={s.cardHead}>
                <span className={s.cardIcon} style={{ background: color + '18', color }}>📋</span>
                <span className={s.cardTitle}>Club Rules & Guidelines</span>
              </div>
              <ol className={s.ruleList}>
                {rules.map((r, i) => (
                  <li key={i} className={s.ruleItem}>
                    <span className={s.ruleNum} style={{ background: color + '18', color }}>{i + 1}</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ol>
              {!club.rules?.length && (
                <p style={{ marginTop: 16, fontSize: 12, color: '#9ca3af' }}>
                  These are standard RKU club guidelines. Club-specific rules may be added by your coordinator.
                </p>
              )}
            </div>

            {/* ── Values & Standards ── */}
            {club.tags?.length > 0 && (
              <div className={s.card} style={{ maxWidth: 680 }}>
                <div className={s.cardHead}>
                  <span className={s.cardIcon} style={{ background: color + '18', color }}>⭐</span>
                  <span className={s.cardTitle}>Values & Standards</span>
                </div>
                <p style={{ fontSize: '.82rem', color: '#6b7280', margin: '0 0 14px' }}>
                  The principles and focus areas that guide this club.
                </p>
                <div className={s.ruleStandardsList}>
                  {club.tags.map((tag, i) => (
                    <div key={i} className={s.ruleStandardItem}
                      style={{ borderLeftColor: color, background: color + '08' }}>
                      <span className={s.ruleStandardDot} style={{ background: color }} />
                      <span className={s.ruleStandardText}>{tag}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

        {/* ════════════════════════════════ LEADERSHIP ════════════════════════════════ */}
        {tab === 'Leadership' && (
          <div>
            {!leaderLoaded ? (
              <div className={s.loadWrap}><div className={s.spinner} /></div>
            ) : (
              <div className={s.leaderGrid}>

                {/* 1 — Faculty Coordinator (always from club data) */}
                {(() => {
                  const coordAvatar = club.coordinatorAvatar
                    ? (club.coordinatorAvatar.startsWith('http') ? club.coordinatorAvatar : AVATAR_BASE + club.coordinatorAvatar)
                    : null;
                  return (
                    <div className={s.leaderCard} style={{ borderColor: color + '40' }}>
                      {coordAvatar ? (
                        <div className={s.leaderAv} style={{ padding: 0 }}>
                          <img
                            src={coordAvatar}
                            alt={club.coordinator || 'Faculty Coordinator'}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center', display: 'block', borderRadius: '50%' }}
                          />
                        </div>
                      ) : (
                        <div className={s.leaderAv}
                          style={{ background: `linear-gradient(135deg,${color},${color}99)`, color: '#fff' }}>
                          {club.coordinator?.charAt(0)?.toUpperCase() || 'C'}
                        </div>
                      )}
                      <div className={s.leaderRole} style={{ color, background: color + '14' }}>
                        Faculty Coordinator
                      </div>
                      <div className={s.leaderName}>{club.coordinator || 'TBA'}</div>
                      <div className={s.leaderDesc}>Oversees all club operations and student welfare.</div>
                    </div>
                  );
                })()}

                {/* 2+ — Saved club leadership positions */}
                {(leadership.length > 0 ? leadership : FIXED_STUDENT_ROLES).map((pos, i) => {
                  const filled = !!pos.holder_name;
                  return (
                    <div key={pos.role_title || pos.label || i}
                      className={`${s.leaderCard} ${!filled ? s.leaderCardOpen : ''}`}
                      style={{ borderColor: color + '40' }}>
                      {/* Avatar: real photo if available, else gradient initials */}
                      {pos.photo_url ? (
                        <div className={s.leaderAv} style={{ padding: 0 }}>
                          <img
                            src={pos.photo_url}
                            alt={pos.holder_name || pos.role_title}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center', display: 'block', borderRadius: '50%' }}
                          />
                        </div>
                      ) : (
                        <div className={s.leaderAv} style={{
                          background: filled ? `linear-gradient(135deg,${color},${color}99)` : '#f3f4f6',
                          color: filled ? '#fff' : '#9ca3af',
                        }}>
                          {(pos.holder_name || pos.role_title || pos.label || '?').charAt(0)?.toUpperCase() || '?'}
                        </div>
                      )}
                      <div className={s.leaderRole} style={{
                        color: filled ? color : '#9ca3af',
                        background: filled ? color + '14' : '#f3f4f6',
                      }}>
                        {pos.role_title || pos.label}
                      </div>
                      <div className={s.leaderName} style={{ color: filled ? '#0f0a2e' : '#9ca3af' }}>
                        {pos.holder_name || 'Position Open'}
                      </div>
                      {pos.holder_email && (
                        <div className={s.leaderEmail}>{pos.holder_email}</div>
                      )}
                      {pos.phone && (
                        <div className={s.leaderPhone}>📞 {pos.phone}</div>
                      )}
                      {pos.responsibilities && (
                        <div className={s.leaderDesc}>{pos.responsibilities}</div>
                      )}
                      {!filled && !pos.responsibilities && pos.desc && (
                        <div className={s.leaderDesc}>{pos.desc}</div>
                      )}
                    </div>
                  );
                })}

              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════ CHAT ════════════════════════════════ */}
        {tab === 'Chat' && (
          <div className={s.chatOuter}>
            <div className={s.chatWrap}>
              {/* Message list */}
              <div className={s.chatMessages}>
                {!chatLoaded && (
                  <div className={s.chatLoading}><div className={s.spinner} /></div>
                )}
                {chatLoaded && messages.length === 0 && (
                  <div className={s.chatEmpty}>
                    <span>💬</span>
                    <p>No messages yet. Start the conversation!</p>
                  </div>
                )}
                {messages.map((msg, i) => {
                  const isMe    = msg.user_id === user?.id;
                  const prev    = messages[i - 1];
                  const grouped = prev?.user_id === msg.user_id &&
                    (new Date(msg.created_at) - new Date(prev.created_at)) < 300000;

                  return (
                    <div key={msg.id} className={`${s.msgRow} ${isMe ? s.msgRowMe : ''} ${grouped ? s.msgGrouped : ''}`}>
                      {!isMe && (
                        <div className={s.msgAvatarCol}>
                          {!grouped ? (
                            <Avatar name={msg.user_name} src={avatarUrl(msg.user_avatar)} size={32} color={color} />
                          ) : (
                            <div style={{ width: 32 }} />
                          )}
                        </div>
                      )}
                      <div className={s.msgBody}>
                        {!grouped && !isMe && (
                          <div className={s.msgSender}>{msg.user_name}</div>
                        )}
                        <div className={`${s.msgBubble} ${isMe ? s.msgBubbleMe : s.msgBubbleOther}`}
                          style={isMe ? { background: color } : {}}>
                          {msg.content}
                        </div>
                        {!grouped && (
                          <div className={`${s.msgTime} ${isMe ? s.msgTimeRight : ''}`}>
                            {formatTime(msg.created_at)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>

              {chatError && <div className={s.chatErr}>{chatError}</div>}

              {/* Input */}
              <form className={s.chatInputRow} onSubmit={handleSend}>
                <input
                  className={s.chatInputField}
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  placeholder="Type a message…"
                  maxLength={2000}
                  disabled={chatSending}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); }
                  }}
                />
                <button
                  className={s.chatSendBtn}
                  type="submit"
                  disabled={!chatInput.trim() || chatSending}
                  style={{ background: color }}
                >
                  {chatSending ? '…' : 'Send'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ════════════════════════════════ TASKS ════════════════════════════════ */}
        {tab === 'Tasks' && (
          <div>
            {!tasksLoaded ? (
              <div className={s.loadWrap}><div className={s.spinner} /></div>
            ) : tasksError ? (
              <div className={s.emptyCard} style={{ maxWidth: 420 }}>
                <span style={{ fontSize: 36 }}>⚠️</span>
                <p className={s.emptyCardTitle}>Could not load tasks</p>
                <p className={s.emptyCardSub}>{tasksError}</p>
              </div>
            ) : tasks.length === 0 ? (
              <div className={s.emptyCard}>
                <span style={{ fontSize: 36 }}>✅</span>
                <p className={s.emptyCardTitle}>No tasks yet</p>
                <p className={s.emptyCardSub}>Your coordinator will post tasks and to-dos here.</p>
              </div>
            ) : (
              <div className={s.kanban}>
                {(['todo', 'in_progress', 'done']).map(st => (
                  <div key={st} className={s.kanbanCol}>
                    <div className={s.kanbanHeader} style={{ borderTopColor: STATUS_COLOR[st] }}>
                      <span className={s.kanbanLabel} style={{ color: STATUS_COLOR[st] }}>
                        {STATUS_LABEL[st]}
                      </span>
                      <span className={s.kanbanCount}
                        style={{ background: STATUS_COLOR[st] + '18', color: STATUS_COLOR[st] }}>
                        {tasksByStatus[st].length}
                      </span>
                    </div>

                    <div className={s.kanbanCards}>
                      {tasksByStatus[st].length === 0 ? (
                        <div className={s.kanbanEmpty}>No tasks</div>
                      ) : tasksByStatus[st].map(task => (
                        <div key={task.id} className={s.taskCard}>
                          <div className={s.taskTop}>
                            <span className={s.taskPriority}
                              style={{ background: PRIORITY_COLOR[task.priority] + '18', color: PRIORITY_COLOR[task.priority] }}>
                              {task.priority}
                            </span>
                          </div>
                          <div className={s.taskTitle}>{task.title}</div>
                          {task.description && (
                            <div className={s.taskDesc}>{task.description}</div>
                          )}
                          <div className={s.taskMeta}>
                            {task.due_date && (
                              <span className={s.taskDue}>📅 {formatDate(task.due_date)}</span>
                            )}
                            {task.created_by_name && (
                              <span className={s.taskBy}>by {task.created_by_name}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
