import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCoordClub } from '../../context/CoordClubContext';
import api from '../../api/client';
import s from './CoordMyClub.module.css';
import { getSocket } from '../../realtime/socket';

const BASE_TABS   = ['Overview', 'Attendance', 'Tasks', 'Leadership', 'Progress'];
const SPORTS_TABS = [...BASE_TABS, 'Live Scoreboard'];

const WEEK_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DAY_SHORT  = { Monday:'Mon', Tuesday:'Tue', Wednesday:'Wed', Thursday:'Thu', Friday:'Fri', Saturday:'Sat', Sunday:'Sun' };

function parseScheduleToDays(text = '') {
  const days = {};
  WEEK_DAYS.forEach(d => { days[d] = ''; });
  const usedIdx = new Set();
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    const t = line.trim();
    for (const d of WEEK_DAYS) {
      if (t.toLowerCase().startsWith(d.toLowerCase() + ':')) {
        days[d] = t.slice(d.length + 1).trim();
        usedIdx.add(idx);
        break;
      }
    }
  });
  const notes = lines.filter((_, i) => !usedIdx.has(i) && lines[i].trim()).join('\n');
  return { days, notes };
}

function compileDaysToSchedule(days, notes) {
  const dayLines = WEEK_DAYS.filter(d => days[d].trim()).map(d => `${d}: ${days[d].trim()}`);
  return [...dayLines, ...(notes.trim() ? [notes.trim()] : [])].join('\n');
}

const LEVEL_OPTIONS = ['Beginner', 'Intermediate', 'Advanced', 'Expert', 'Alumni'];
const PRIORITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#6b7280' };
const STATUS_COLOR   = { todo: '#6b7280', in_progress: '#3b82f6', done: '#10b981' };
const STATUS_LABEL   = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };
const LIVE_SPORTS = ['cricket', 'basketball', 'football', 'volleyball', 'badminton'];
const SPORT_SCORE_FIELDS = {
  cricket: ['wickets', 'overs', 'target'],
  basketball: ['quarter', 'fouls', 'timeouts'],
  football: ['half', 'possession', 'yellowCards'],
  volleyball: ['set', 'setsWon', 'blocks'],
  badminton: ['game', 'gamesWon', 'ralliesWon'],
};
const SPORT_STAT_FIELDS = {
  cricket: ['boundaries', 'runRate', 'topScorer'],
  basketball: ['threePointers', 'rebounds', 'assists'],
  football: ['shotsOnTarget', 'corners', 'saves'],
  volleyball: ['aces', 'digs', 'serviceErrors'],
  badminton: ['smashes', 'netWins', 'unforcedErrors'],
};
const SPORT_TIMER_SECONDS = {
  cricket: 120 * 60,
  basketball: 40 * 60,
  football: 90 * 60,
  volleyball: 20 * 60, // per SET, not the whole match — volleyball has no match clock
  badminton: 60 * 60,
};
/* seconds per quarter / period for basketball */
const QUARTER_TIMER = { Q1: 600, Q2: 600, Q3: 600, Q4: 600, OT: 300 };
const PLAYER_STAT_FIELDS = {
  cricket:    ['runs', 'balls', 'wickets'],
  basketball: ['points', 'rebounds', 'assists'],
  football:   ['goals', 'assists', 'yellow_cards'],
  volleyball: ['points', 'attacks', 'blocks'],
  badminton:  ['points', 'winners', 'errors'],
  kabaddi:    ['points', 'raids', 'tackles'],
};

/* International rally-scoring volleyball: best-of-5 sets, each played to an editable
   target (25 by default; coordinators drop it to 15 for a deciding 5th set) and won by
   at least 2 clear points. First to 3 sets wins the match. */
const VOLLEYBALL_DEFAULT_POINTS_TO_WIN = 25;
const VOLLEYBALL_MAX_SETS = 5;
const VOLLEYBALL_SETS_TO_WIN_MATCH = 3;

/* Applies a just-recorded point to a volleyball scoreboard's set state — if either side has
   now reached the target with a 2-point lead, the set is logged to history, that side's
   setsWon is bumped, and both scores reset to 0-0 for the next set. Pure function: takes the
   current scoreData + the score values about to be written, returns the values to actually
   persist (either unchanged, or reset if a set just completed). */
function applyVolleyballSetResult(scoreData, teamScore, opponentScore) {
  const sd = { ...(scoreData || {}) };
  const home = { setsWon: 0, set: 1, ...(sd.home || {}) };
  const away = { setsWon: 0, set: 1, ...(sd.away || {}) };
  const sets = Array.isArray(sd.sets) ? [...sd.sets] : [];
  const pointsToWin = Number(sd.pointsToWin) || VOLLEYBALL_DEFAULT_POINTS_TO_WIN;
  const matchDecided = home.setsWon >= VOLLEYBALL_SETS_TO_WIN_MATCH || away.setsWon >= VOLLEYBALL_SETS_TO_WIN_MATCH;

  let finalTeamScore = teamScore;
  let finalOpponentScore = opponentScore;

  if (!matchDecided && home.set <= VOLLEYBALL_MAX_SETS) {
    const homeWinsSet = teamScore >= pointsToWin && teamScore - opponentScore >= 2;
    const awayWinsSet = opponentScore >= pointsToWin && opponentScore - teamScore >= 2;
    if (homeWinsSet || awayWinsSet) {
      const winner = homeWinsSet ? 'home' : 'away';
      sets.push({ set: home.set, home: teamScore, away: opponentScore, winner });
      if (winner === 'home') home.setsWon += 1; else away.setsWon += 1;
      const nextSetNum = Math.min(VOLLEYBALL_MAX_SETS, home.set + 1);
      home.set = nextSetNum;
      away.set = nextSetNum;
      finalTeamScore = 0;
      finalOpponentScore = 0;
    }
  }

  return {
    teamScore: finalTeamScore,
    opponentScore: finalOpponentScore,
    scoreData: { ...sd, home, away, sets, pointsToWin },
  };
}

/* Force-completes the current set without requiring the points-to-win/2-lead condition —
   used when the set's timer runs out, or the coordinator clicks ahead to the next set.
   Whoever has more points at that moment wins the set. Returns null (does nothing) if the
   scores are tied (nothing sensible to declare) or the match is already decided. */
function finalizeVolleyballSet(scoreData, teamScore, opponentScore) {
  const sd = { ...(scoreData || {}) };
  const home = { setsWon: 0, set: 1, ...(sd.home || {}) };
  const away = { setsWon: 0, set: 1, ...(sd.away || {}) };
  const sets = Array.isArray(sd.sets) ? [...sd.sets] : [];
  const matchDecided = home.setsWon >= VOLLEYBALL_SETS_TO_WIN_MATCH || away.setsWon >= VOLLEYBALL_SETS_TO_WIN_MATCH;

  if (matchDecided || home.set > VOLLEYBALL_MAX_SETS || teamScore === opponentScore) return null;

  const winner = teamScore > opponentScore ? 'home' : 'away';
  sets.push({ set: home.set, home: teamScore, away: opponentScore, winner });
  if (winner === 'home') home.setsWon += 1; else away.setsWon += 1;
  const nextSetNum = Math.min(VOLLEYBALL_MAX_SETS, home.set + 1);
  home.set = nextSetNum;
  away.set = nextSetNum;

  return {
    teamScore: 0,
    opponentScore: 0,
    scoreData: { ...sd, home, away, sets },
  };
}

/* Which stat on the player drives the team score total */
const SPORT_SCORE_STAT = {
  basketball: 'points',
  football:   'goals',
  cricket:    'runs',
  volleyball: 'points',
  badminton:  'points',
  kabaddi:    'points',
};

/* Sport-specific scoring buttons — each adds `value` to player stat AND team score */
const SPORT_SCORE_BUTTONS = {
  basketball: [
    { label: '1PT', value: 1, color: '#6366f1', title: 'Free throw' },
    { label: '2PT', value: 2, color: '#0ea5e9', title: 'Field goal' },
    { label: '3PT', value: 3, color: '#f59e0b', title: 'Three-pointer' },
  ],
  football: [
    { label: '⚽ Goal', value: 1, color: '#10b981', title: 'Goal scored' },
  ],
  cricket: [
    { label: '1', value: 1, color: '#6b7280' },
    { label: '2', value: 2, color: '#6b7280' },
    { label: '3', value: 3, color: '#6b7280' },
    { label: '4', value: 4, color: '#0ea5e9', title: 'Boundary' },
    { label: '6', value: 6, color: '#f59e0b', title: 'Six' },
  ],
  volleyball: [
    { label: '+1 PT',  value: 1, stat: 'points',  color: '#10b981', title: 'Point — adds to the team score' },
    { label: '+1 ATK', value: 1, stat: 'attacks', color: '#0ea5e9', title: 'Attack — MVP stat only, does not add to the team score', scores: false },
    { label: '+1 BLK', value: 1, stat: 'blocks',  color: '#f59e0b', title: 'Block — MVP stat only, does not add to the team score', scores: false },
  ],
  badminton: [
    { label: '+ Point', value: 1, color: '#10b981', title: 'Rally point' },
  ],
  kabaddi: [
    { label: 'Raid',      value: 1, color: '#6366f1', title: 'Raid point' },
    { label: 'Super Raid',value: 3, color: '#f59e0b', title: 'Super Raid (3 pts)' },
    { label: 'Tackle',    value: 1, color: '#10b981', title: 'Tackle point' },
  ],
  general: [
    { label: '+ Point', value: 1, color: '#10b981' },
  ],
};
const BASKETBALL_EVENT_TYPES = [
  { key: 'shot_made', label: 'Shot Made' },
  { key: 'shot_missed', label: 'Shot Missed' },
  { key: 'assist', label: 'Assist' },
  { key: 'rebound_off', label: 'Offensive Rebound' },
  { key: 'rebound_def', label: 'Defensive Rebound' },
  { key: 'foul', label: 'Foul' },
  { key: 'turnover', label: 'Turnover' },
  { key: 'steal', label: 'Steal' },
  { key: 'block', label: 'Block' },
  { key: 'substitution', label: 'Substitution' },
  { key: 'timeout', label: 'Timeout' },
];

/* ── Coin system ── */
const LEVEL_MULT = { Beginner: 1, Intermediate: 1.5, Advanced: 2, Expert: 3, Alumni: 2 };
const computeCoins = (xp, level) => Math.floor((Number(xp) || 0) * (LEVEL_MULT[level] || 1));

const TIERS = [
  { min: 1000, label: 'Platinum Elite', color: '#a855f7', bg: '#faf5ff', icon: '💎' },
  { min: 500,  label: 'Gold Member',    color: '#d97706', bg: '#fffbeb', icon: '🥇' },
  { min: 200,  label: 'Silver Member',  color: '#64748b', bg: '#f8fafc', icon: '🥈' },
  { min: 50,   label: 'Bronze Member',  color: '#92400e', bg: '#fef3c7', icon: '🥉' },
  { min: 0,    label: 'Newcomer',       color: '#9ca3af', bg: '#f9fafb', icon: '🌱' },
];
const getTier = (coins) => TIERS.find(t => coins >= t.min) || TIERS[TIERS.length - 1];

const GRADS = [
  'linear-gradient(135deg,#3DDC84,#635BFF)',
  'linear-gradient(135deg,#FF6B35,#FFD166)',
  'linear-gradient(135deg,#A259FF,#3DDC84)',
  'linear-gradient(135deg,#06D6A0,#00E5FF)',
  'linear-gradient(135deg,#FF6B9D,#FF9500)',
  'linear-gradient(135deg,#635BFF,#A259FF)',
];

function initials(name = '') {
  return name.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function sessionMonDay(dateStr) {
  const d = new Date(dateStr);
  return {
    mon: d.toLocaleString('default', { month: 'short' }).toUpperCase(),
    day: d.getDate(),
  };
}

/* ── Toast helper ── */
function useToast() {
  const [msg, setMsg] = useState('');
  const show = useCallback((m, ms = 2800) => {
    setMsg(m);
    setTimeout(() => setMsg(''), ms);
  }, []);
  return [msg, show];
}

/* ══════════════════════════════════════════════════════════
   MAIN
══════════════════════════════════════════════════════════ */
export default function CoordMyClub() {
  const { user }                                        = useAuth();
  const { clubs, club, clubLoading, refetchClub,
          selectedClub, setSelectedClub }               = useCoordClub();
  const clubId                = club?._id || String(club?.id || '');

  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [tab,     setTab]     = useState('Overview');
  const [toast,   showToast]  = useToast();

  // Reset to Overview tab when switching clubs so stale data isn't shown
  const prevClubId = useRef(clubId);
  useEffect(() => {
    if (prevClubId.current !== clubId) {
      setTab('Overview');
      setMembers([]);
      prevClubId.current = clubId;
    }
  }, [clubId]);

  useEffect(() => {
    if (!clubId) return;
    setLoading(true);
    api.get(`/clubs/${clubId}/members?limit=200`)
      .then(mr => setMembers(mr.members || []))
      .catch(e => setError(e.message || 'Could not load members.'))
      .finally(() => setLoading(false));
  }, [clubId]);

  if (clubLoading || loading) return <div className={s.loading}><div className={s.spinner} /></div>;
  if (error)                  return <div style={{ padding: 32 }}><div className={s.errBox}>{error}</div></div>;
  if (!club)                  return null;

  const catColors   = { sports:'#ef4444', cultural:'#a855f7', social:'#06d6a0', academic:'#635BFF' };
  const color       = club.color || catColors[club.category] || '#4c44e0';
  const isSportsClub = club.category === 'sports';
  const visibleTabs  = isSportsClub ? SPORTS_TABS : BASE_TABS;

  return (
    <div className={s.page}>

      {/* ── Club selector (only shown when managing 2+ clubs) ── */}
      {clubs.length > 1 && (
        <div className={s.managingStrip}>
          <span className={s.managingLabel}>Managing:</span>
          {clubs.map(c => {
            const isActive = String(c.id) === String(club.id || club._id);
            const cColor = c.color || '#635BFF';
            return (
              <button
                key={c.id}
                onClick={() => setSelectedClub(c)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: isActive ? `2px solid ${cColor}` : '2px solid #e5e7eb',
                  background: isActive ? cColor + '12' : '#fff',
                  color: isActive ? cColor : '#6b7280',
                  fontWeight: isActive ? 800 : 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  transition: 'all .15s',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: isActive ? cColor : '#d1d5db',
                  display: 'inline-block', flexShrink: 0,
                }} />
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Club banner ── */}
      <div className={s.banner}>
        <div className={s.bannerColor} style={{ background: color }}>
          {initials(club.name)}
        </div>
        <div className={s.bannerInfo}>
          <p className={s.bannerName}>{club.name}</p>
          <p className={s.bannerSub}>{club.category} · {club.realMemberCount ?? club.memberCount ?? 0} members</p>
        </div>
        <span className={s.bannerBadge} style={{ background: color + '18', color }}>Coordinator</span>
      </div>

      {/* ── Tab bar ── */}
      <div className={s.tabBar}>
        {visibleTabs.map(t => (
          <button key={t} className={`${s.tab} ${tab === t ? s.tabActive : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {tab === 'Overview'    && <OverviewTab    club={club} clubId={clubId} refetchClub={refetchClub} showToast={showToast} />}
      {tab === 'Attendance'  && <AttendanceTab  clubId={clubId} members={members} showToast={showToast} />}
      {tab === 'Tasks'       && <TasksTab       clubId={clubId} user={user} showToast={showToast} />}
      {tab === 'Leadership'  && <LeadershipTab  clubId={clubId} showToast={showToast} />}
      {tab === 'Progress'    && <ProgressTab    clubId={clubId} members={members} showToast={showToast} />}
      {isSportsClub && tab === 'Live Scoreboard' && <LiveScoreboardTab clubId={clubId} club={club} showToast={showToast} />}

      {toast && <div className={s.toast}>{toast}</div>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   OVERVIEW TAB
══════════════════════════════════════════════════════════ */
function OverviewTab({ club, clubId, refetchClub, showToast }) {
  const parsed = parseScheduleToDays(club.schedule || '');

  const [form, setForm]         = useState({ description: club.description || '', vision: club.vision || '' });
  const [schedDays, setSchedDays] = useState(parsed.days);
  const [schedNotes, setSchedNotes] = useState(parsed.notes);
  const [rules,    setRules]    = useState(club.rules || []);
  const [tags,     setTags]     = useState(club.tags  || []);
  const [ruleInput,setRuleInput]= useState('');
  const [tagInput, setTagInput] = useState('');
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState('');

  const addRule = () => {
    const v = ruleInput.trim();
    if (v && !rules.includes(v)) { setRules(r => [...r, v]); setRuleInput(''); }
  };
  const addTag = () => {
    const v = tagInput.trim();
    if (v && !tags.includes(v))  { setTags(t => [...t, v]);  setTagInput(''); }
  };

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const schedule = compileDaysToSchedule(schedDays, schedNotes);
      const res = await api.patch(`/clubs/${clubId}/overview`, { ...form, schedule, rules, tags });
      refetchClub();
      showToast('Overview saved ✓');
    } catch (e) {
      setErr(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {err && <div className={s.errBox}>{err}</div>}

      {/* ── About ── */}
      <div className={s.card}>
        <div className={s.sectionHead}>
          <div className={s.sectionIcon}>📝</div>
          <div>
            <p className={s.cardTitle}>About the Club</p>
            <p className={s.cardSub}>Public description and vision — visible to all students on the Overview tab.</p>
          </div>
        </div>
        <div className={s.field}>
          <label>Description</label>
          <textarea rows={4} value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>
        <div className={s.field}>
          <label>Vision</label>
          <textarea rows={3} value={form.vision}
            onChange={e => setForm(f => ({ ...f, vision: e.target.value }))} />
        </div>
      </div>

      {/* ── Weekly Schedule ── */}
      <div className={s.card}>
        <div className={s.sectionHead}>
          <div className={s.sectionIcon}>📅</div>
          <div>
            <p className={s.cardTitle}>Weekly Schedule</p>
            <p className={s.cardSub}>Set activity times per day — students see this on their Schedule tab.</p>
          </div>
        </div>
        <div className={s.schedGrid}>
          {WEEK_DAYS.map(day => (
            <div key={day} className={`${s.schedDayRow} ${schedDays[day].trim() ? s.schedDayActive : ''}`}>
              <span className={s.schedDayLabel}>{DAY_SHORT[day]}</span>
              <input
                className={s.schedDayInput}
                placeholder="e.g. Practice session, 4 PM – CS Lab 4"
                value={schedDays[day]}
                onChange={e => setSchedDays(d => ({ ...d, [day]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className={s.field} style={{ marginTop: 12 }}>
          <label>Additional Notes</label>
          <textarea rows={2} value={schedNotes} placeholder="Any extra schedule details…"
            onChange={e => setSchedNotes(e.target.value)} />
        </div>
      </div>

      {/* ── Club Rules ── */}
      <div className={s.card}>
        <div className={s.sectionHead}>
          <div className={s.sectionIcon}>📋</div>
          <div>
            <p className={s.cardTitle}>Club Rules</p>
            <p className={s.cardSub}>Conduct guidelines shown on the Rules tab for all members.</p>
          </div>
        </div>
        <div className={s.chipWrap}>
          {rules.map((r, i) => (
            <span key={i} className={s.chip}>
              {r}
              <button className={s.chipDel} onClick={() => setRules(rs => rs.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
          {rules.length === 0 && <span className={s.emptyChipNote}>No rules added yet.</span>}
        </div>
        <div className={s.chipAdd}>
          <input className={s.chipInput} value={ruleInput} placeholder="Type a rule and press Enter or Add…"
            onChange={e => setRuleInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addRule())} />
          <button className={s.chipBtn} onClick={addRule}>Add</button>
        </div>
      </div>

      {/* ── Values & Standards ── */}
      <div className={s.card}>
        <div className={s.sectionHead}>
          <div className={s.sectionIcon}>⭐</div>
          <div>
            <p className={s.cardTitle}>Values & Standards</p>
            <p className={s.cardSub}>Key focus areas shown on the club Overview page under "Values & Focus Areas".</p>
          </div>
        </div>
        <div className={s.chipWrap}>
          {tags.map((t, i) => (
            <span key={i} className={s.chip} style={{ background: 'rgba(99,91,255,.1)', color: '#635BFF' }}>
              {t}
              <button className={s.chipDel} onClick={() => setTags(ts => ts.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
          {tags.length === 0 && <span className={s.emptyChipNote}>No values added yet.</span>}
        </div>
        <div className={s.chipAdd}>
          <input className={s.chipInput} value={tagInput} placeholder="Type a value or focus area and press Enter or Add…"
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} />
          <button className={s.chipBtn} onClick={addTag}>Add</button>
        </div>
      </div>

      <div className={s.btnRow}>
        <button className={`${s.btn} ${s.btnPrimary}`} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save All Changes'}
        </button>
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════
   ATTENDANCE TAB
══════════════════════════════════════════════════════════ */
function AttendanceTab({ clubId, members, showToast }) {
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [view,     setView]     = useState('list'); // 'list' | 'new' | 'detail'
  const [selSession,setSelSession]=useState(null);
  const [selRecords,setSelRecords]=useState([]);

  /* new session form */
  const [newDate,  setNewDate]  = useState(() => new Date().toISOString().slice(0, 10));
  const [newLabel, setNewLabel] = useState('');
  const [marks,    setMarks]    = useState({});
  const [saving,   setSaving]   = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get(`/clubs/${clubId}/attendance`);
      setSessions(data.sessions || []);
    } catch { /* noop */ }
    setLoading(false);
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  /* init marks when starting new session */
  useEffect(() => {
    if (view !== 'new') return;
    const init = {};
    members.forEach(m => { init[m.id] = 'present'; });
    setMarks(init);
  }, [view, members]);

  const openDetail = async (session) => {
    setSelSession(session);
    try {
      const data = await api.get(`/clubs/${clubId}/attendance/${session.id}/records`);
      setSelRecords(data.records || []);
    } catch { setSelRecords([]); }
    setView('detail');
  };

  const saveSession = async () => {
    setSaving(true);
    try {
      const records = members.map(m => ({
        user_id: m.id, user_name: m.name, status: marks[m.id] || 'present', notes: '',
      }));
      await api.post(`/clubs/${clubId}/attendance`, {
        session_date: newDate,
        session_label: newLabel || `Session – ${new Date(newDate).toLocaleDateString('en-IN', { day:'numeric', month:'short' })}`,
        records,
      });
      showToast('Attendance recorded ✓');
      setView('list');
      setNewLabel('');
      load();
    } catch (e) {
      showToast(e.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const deleteSession = async (id) => {
    if (!window.confirm('Delete this attendance session?')) return;
    try {
      await api.delete(`/clubs/${clubId}/attendance/${id}`);
      showToast('Session deleted.');
      load();
    } catch (e) { showToast(e.message || 'Failed to delete.'); }
  };

  const toggleMark = (userId, status) => setMarks(m => ({ ...m, [userId]: status }));

  const patchRecord = async (recordId, status) => {
    try {
      const res = await api.patch(`/clubs/${clubId}/attendance/records/${recordId}`, { status });
      setSelRecords(rs => rs.map(r => r.id === recordId ? { ...r, ...res.record } : r));
    } catch { /* noop */ }
  };

  if (loading) return <div className={s.loading}><div className={s.spinner} /></div>;

  /* ── Detail view ── */
  if (view === 'detail' && selSession) {
    const { mon, day } = sessionMonDay(selSession.session_date);
    return (
      <div className={s.card}>
        <div className={s.cardHead}>
          <div>
            <p className={s.cardTitle}>{selSession.session_label}</p>
            <p className={s.cardSub}>{mon} {day} · {selRecords.length} members</p>
          </div>
          <button className={`${s.btn} ${s.btnOutline} ${s.btnSmall}`} onClick={() => setView('list')}>← Back</button>
        </div>
        <div className={s.attGrid}>
          {selRecords.map(r => (
            <div key={r.id} className={s.attRow}>
              <span className={s.attName}>{r.user_name}</span>
              <div className={s.attBtns}>
                {['present','absent','late','excused'].map(st => (
                  <button key={st}
                    className={`${s.attBtn} ${r.status === st ? s['att' + st.charAt(0).toUpperCase() + st.slice(1)] : ''}`}
                    onClick={() => patchRecord(r.id, st)}>
                    {st.charAt(0).toUpperCase() + st.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {selRecords.length === 0 && <div className={s.empty}><div className={s.emptyIco}>📋</div>No records found.</div>}
        </div>
      </div>
    );
  }

  /* ── New session view ── */
  if (view === 'new') {
    const presentCount = Object.values(marks).filter(v => v === 'present').length;
    return (
      <div className={s.card}>
        <div className={s.cardHead}>
          <div>
            <p className={s.cardTitle}>Record Attendance</p>
            <p className={s.cardSub}>{presentCount}/{members.length} marked present</p>
          </div>
          <button className={`${s.btn} ${s.btnOutline} ${s.btnSmall}`} onClick={() => setView('list')}>Cancel</button>
        </div>

        <div className={s.grid2} style={{ marginBottom: 16 }}>
          <div className={s.field}>
            <label>Session Date</label>
            <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
          </div>
          <div className={s.field}>
            <label>Session Label</label>
            <input placeholder="e.g. Week 5 – Machine Learning" value={newLabel} onChange={e => setNewLabel(e.target.value)} />
          </div>
        </div>

        <div className={s.attGrid}>
          {members.map(m => (
            <div key={m.id} className={s.attRow}>
              <span className={s.attName}>{m.name}</span>
              <div className={s.attBtns}>
                {['present','absent','late','excused'].map(st => (
                  <button key={st}
                    className={`${s.attBtn} ${marks[m.id] === st ? s['att' + st.charAt(0).toUpperCase() + st.slice(1)] : ''}`}
                    onClick={() => toggleMark(m.id, st)}>
                    {st.charAt(0).toUpperCase() + st.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {members.length === 0 && <div className={s.empty}><div className={s.emptyIco}>👥</div>No members found.</div>}
        </div>

        {members.length > 0 && (
          <div className={s.btnRow} style={{ marginTop: 16 }}>
            <button className={`${s.btn} ${s.btnPrimary}`} onClick={saveSession} disabled={saving}>
              {saving ? 'Saving…' : 'Save Attendance'}
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ── List view ── */
  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div>
          <p className={s.cardTitle}>Attendance</p>
          <p className={s.cardSub}>{sessions.length} session{sessions.length !== 1 ? 's' : ''} recorded</p>
        </div>
        <button className={`${s.btn} ${s.btnPrimary} ${s.btnSmall}`} onClick={() => setView('new')}>
          + Record Session
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className={s.empty}>
          <div className={s.emptyIco}>📋</div>
          <p>No attendance sessions yet.</p>
          <p>Click "Record Session" to take your first roll call.</p>
        </div>
      ) : (
        <div className={s.sessionList}>
          {sessions.map(se => {
            const { mon, day } = sessionMonDay(se.session_date);
            return (
              <div key={se.id} className={s.sessionRow} onClick={() => openDetail(se)}>
                <div className={s.sessionDate}>
                  <div className={s.sessionMon}>{mon}</div>
                  <div className={s.sessionDay}>{day}</div>
                </div>
                <div className={s.sessionInfo}>
                  <div className={s.sessionLabel}>{se.session_label || fmtDate(se.session_date)}</div>
                  <div className={s.sessionStats}>
                    <span className={`${s.sStat} ${s.sPresent}`}>✓ {se.present} present</span>
                    <span className={`${s.sStat} ${s.sAbsent}`}>✗ {se.absent} absent</span>
                    {se.late > 0    && <span className={`${s.sStat} ${s.sLate}`}>⏱ {se.late} late</span>}
                    {se.excused > 0 && <span className={`${s.sStat} ${s.sExcused}`}>○ {se.excused} excused</span>}
                  </div>
                </div>
                <button className={`${s.btn} ${s.btnDanger} ${s.btnSmall}`}
                  onClick={e => { e.stopPropagation(); deleteSession(se.id); }}>
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   TASKS TAB
══════════════════════════════════════════════════════════ */
function TasksTab({ clubId, user, showToast }) {
  const [tasks,             setTasks]             = useState([]);
  const [loading,           setLoading]           = useState(true);
  const [showForm,          setShowForm]          = useState(false);
  const [editing,           setEditing]           = useState(null);
  const [form,              setForm]              = useState({ title:'', description:'', priority:'medium', due_date:'' });
  const [saving,            setSaving]            = useState(false);
  /* completion panel */
  const [selectedTask,      setSelectedTask]      = useState(null);
  const [completions,       setCompletions]       = useState([]);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [completionSaving,  setCompletionSaving]  = useState(false);
  const [completionSaved,   setCompletionSaved]   = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get(`/clubs/${clubId}/tasks`);
      setTasks(data.tasks || []);
    } catch (_) {}
    setLoading(false);
  }, [clubId]);
  useEffect(() => { load(); }, [load]);

  /* ── Open completion panel for a task ── */
  const openCompletions = async (task) => {
    setSelectedTask(task);
    setCompletionSaved(false);
    setCompletionLoading(true);
    try {
      const data = await api.get(`/clubs/${clubId}/tasks/${task.id}/completions`);
      setCompletions(data.members || []);
    } catch (_) { setCompletions([]); }
    setCompletionLoading(false);
  };

  const toggleCompletion = (userId) => {
    if (selectedTask?.is_deleted) return;
    setCompletions(cs => cs.map(c => c.userId === userId ? { ...c, isCompleted: !c.isCompleted } : c));
    setCompletionSaved(false);
  };

  const saveCompletions = async () => {
    if (!selectedTask || selectedTask.is_deleted) return;
    setCompletionSaving(true);
    try {
      const result = await api.post(`/clubs/${clubId}/tasks/${selectedTask.id}/completions`, { completions });
      setCompletionSaved(true);
      showToast(`Saved! ${result.totalCoinsAwarded} coins awarded to members.`);
    } catch (e) { showToast(e.message || 'Save failed.'); }
    finally { setCompletionSaving(false); }
  };

  /* ── Task form ── */
  const openNew = () => {
    setEditing(null);
    setForm({ title:'', description:'', priority:'medium', due_date:'' });
    setShowForm(true);
  };
  const openEdit = (t, e) => {
    e.stopPropagation();
    setEditing(t);
    setForm({ title: t.title, description: t.description || '', priority: t.priority, due_date: t.due_date?.slice(0,10) || '' });
    setShowForm(true);
  };
  const save = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        const res = await api.patch(`/clubs/${clubId}/tasks/${editing.id}`, form);
        setTasks(ts => ts.map(t => t.id === editing.id ? res.task : t));
        showToast('Task updated ✓');
      } else {
        const res = await api.post(`/clubs/${clubId}/tasks`, form);
        setTasks(ts => [res.task, ...ts]);
        showToast('Task created ✓');
      }
      setShowForm(false);
    } catch (e) { showToast(e.message || 'Save failed.'); }
    finally { setSaving(false); }
  };

  const cycle = async (task, e) => {
    e.stopPropagation();
    if (task.is_deleted) return;
    const next = { todo:'in_progress', in_progress:'done', done:'todo' }[task.status];
    try {
      const res = await api.patch(`/clubs/${clubId}/tasks/${task.id}`, { status: next });
      setTasks(ts => ts.map(t => t.id === task.id ? res.task : t));
      if (selectedTask?.id === task.id) setSelectedTask(res.task);
    } catch (_) {}
  };

  const del = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Archive this task? Records and coins are preserved. No further edits will be possible.')) return;
    try {
      await api.delete(`/clubs/${clubId}/tasks/${id}`);
      setTasks(ts => ts.map(t => t.id === id ? { ...t, is_deleted: true } : t));
      if (selectedTask?.id === id) setSelectedTask(prev => prev ? { ...prev, is_deleted: true } : null);
      showToast('Task archived. Records preserved.');
    } catch (e) { showToast(e.message || 'Archive failed.'); }
  };

  const activeTasks   = tasks.filter(t => !t.is_deleted);
  const archivedTasks = tasks.filter(t =>  t.is_deleted);
  const completedCount = completions.filter(c => c.isCompleted).length;

  if (loading) return <div className={s.loading}><div className={s.spinner} /></div>;

  return (
    <>
      <div className={s.taskLayout}>

        {/* ══ Left: task list ══ */}
        <div className={s.taskListPanel}>
          <div className={s.taskListHead}>
            <div>
              <div className={s.cardTitle}>Tasks</div>
              <div className={s.cardSub}>{activeTasks.length} active · click a task to manage completions</div>
            </div>
            <button className={`${s.btn} ${s.btnPrimary} ${s.btnSmall}`} onClick={openNew}>+ New Task</button>
          </div>

          {activeTasks.length === 0 && archivedTasks.length === 0 ? (
            <div className={s.empty}>
              <div className={s.emptyIco}>✅</div>
              <p>No tasks yet. Create one to assign and track member work.</p>
            </div>
          ) : (
            <div className={s.taskScrollList}>
              {activeTasks.map(t => (
                <div key={t.id}
                  className={`${s.taskCard} ${selectedTask?.id === t.id ? s.taskCardSel : ''}`}
                  onClick={() => openCompletions(t)}>
                  <div className={s.taskCardTop}>
                    <div className={s.taskDot} style={{ background: PRIORITY_COLOR[t.priority] }} />
                    <div className={s.taskCardName}>{t.title}</div>
                    <div className={s.taskActions} onClick={e => e.stopPropagation()}>
                      <button className={`${s.btn} ${s.btnOutline} ${s.btnSmall}`} onClick={e => openEdit(t, e)}>Edit</button>
                      <button className={`${s.btn} ${s.btnDanger}  ${s.btnSmall}`} onClick={e => del(t.id, e)}>Del</button>
                    </div>
                  </div>
                  {t.description && <div className={s.taskDesc}>{t.description}</div>}
                  <div className={s.taskMeta}>
                    <span className={s.taskBadge}
                      style={{ background: STATUS_COLOR[t.status]+'18', color: STATUS_COLOR[t.status], cursor:'pointer' }}
                      onClick={e => cycle(t, e)} title="Click to cycle status">
                      {STATUS_LABEL[t.status]}
                    </span>
                    <span className={s.taskBadge} style={{ background: PRIORITY_COLOR[t.priority]+'18', color: PRIORITY_COLOR[t.priority] }}>
                      {t.priority}
                    </span>
                    {t.due_date && (
                      <span className={s.taskBadge} style={{ background:'#f3f4f6', color:'#6b7280' }}>
                        Due {fmtDate(t.due_date)}
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {archivedTasks.length > 0 && (
                <>
                  <div className={s.taskArchiveDivider}>Archived</div>
                  {archivedTasks.map(t => (
                    <div key={t.id}
                      className={`${s.taskCard} ${s.taskCardArchived} ${selectedTask?.id === t.id ? s.taskCardSel : ''}`}
                      onClick={() => openCompletions(t)}>
                      <div className={s.taskCardTop}>
                        <div className={s.taskDot} style={{ background: '#d1d5db' }} />
                        <div className={s.taskCardName} style={{ color:'#9ca3af', textDecoration:'line-through' }}>{t.title}</div>
                        <span className={s.taskArchivedBadge}>Archived</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* ══ Right: completion panel ══ */}
        <div className={`${s.completionPanel} ${selectedTask ? s.completionPanelOpen : ''}`}>
          {!selectedTask ? (
            <div className={s.completionEmpty}>
              <div className={s.completionEmptyIco}>👆</div>
              <p>Click a task to view members and manage completions</p>
            </div>
          ) : (
            <>
              <div className={s.completionHead}>
                <div className={s.completionHeadInfo}>
                  <div className={s.completionHeadTitle}>{selectedTask.title}</div>
                  {selectedTask.is_deleted
                    ? <span className={s.taskArchivedBadge}>Archived — read only</span>
                    : <span className={s.completionSubtitle}>Check members who completed this task</span>
                  }
                </div>
                <button className={s.completionClose} onClick={() => setSelectedTask(null)}>✕</button>
              </div>

              {completionLoading ? (
                <div className={s.loading}><div className={s.spinner} /></div>
              ) : completions.length === 0 ? (
                <div className={s.completionEmpty}>
                  <div className={s.completionEmptyIco}>👥</div>
                  <p>No members in this club yet.</p>
                </div>
              ) : (
                <>
                  <div className={s.completionStats}>
                    <div className={s.completionStatChip}>
                      <span className={s.completionStatVal}>{completedCount}/{completions.length}</span>
                      <span className={s.completionStatLbl}>Completed</span>
                    </div>
                    <div className={s.completionStatChip}>
                      <span className={s.completionStatVal} style={{ color:'#635bff' }}>{completedCount * 100}</span>
                      <span className={s.completionStatLbl}>Coins to award</span>
                    </div>
                  </div>

                  <div className={s.completionList}>
                    {completions.map((c, i) => (
                      <div key={c.userId}
                        className={`${s.completionRow} ${c.isCompleted ? s.completionRowDone : ''}`}
                        onClick={() => toggleCompletion(c.userId)}
                        style={{ cursor: selectedTask.is_deleted ? 'default' : 'pointer' }}>
                        <span className={s.memberNum}>{i + 1}</span>
                        <span className={s.completionMemberName}>{c.userName}</span>
                        {c.isCompleted
                          ? <span className={s.completionCoinBadge}>+100</span>
                          : <span className={s.completionZeroBadge}>+0</span>
                        }
                        <div className={`${s.completionCheck} ${c.isCompleted ? s.completionCheckOn : ''}`}>
                          {c.isCompleted && '✓'}
                        </div>
                      </div>
                    ))}
                  </div>

                  {!selectedTask.is_deleted && (
                    <div className={s.completionFooter}>
                      {completionSaved && (
                        <span className={s.completionSavedMsg}>Coins allocated successfully!</span>
                      )}
                      <button
                        className={`${s.btn} ${s.btnPrimary}`}
                        style={{ width:'100%' }}
                        onClick={saveCompletions}
                        disabled={completionSaving}>
                        {completionSaving ? 'Saving…' : 'Save & Award Coins'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Task form modal */}
      {showForm && (
        <div className={s.modalOverlay} onClick={() => setShowForm(false)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalHead}>
              <span className={s.modalTitle}>{editing ? 'Edit Task' : 'New Task'}</span>
              <button className={s.modalClose} onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className={s.modalBody}>
              <div className={s.field}><label>Title *</label>
                <input value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} placeholder="Task title" />
              </div>
              <div className={s.field}><label>Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} rows={3} placeholder="Optional details…" />
              </div>
              <div className={s.grid2}>
                <div className={s.field}><label>Priority</label>
                  <select value={form.priority} onChange={e => setForm(f => ({...f, priority: e.target.value}))}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div className={s.field}><label>Due Date</label>
                  <input type="date" value={form.due_date} onChange={e => setForm(f => ({...f, due_date: e.target.value}))} />
                </div>
              </div>
              <div className={s.btnRow}>
                <button className={`${s.btn} ${s.btnPrimary}`} onClick={save} disabled={saving || !form.title.trim()}>
                  {saving ? 'Saving…' : editing ? 'Update Task' : 'Create Task'}
                </button>
                <button className={`${s.btn} ${s.btnOutline}`} onClick={() => setShowForm(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════
   LEADERSHIP TAB
══════════════════════════════════════════════════════════ */
const EMPTY_POS = { role_title: '', holder_name: '', holder_email: '', phone: '', responsibilities: '', photo_url: '' };

const LEADER_GRADIENTS = [
  'linear-gradient(135deg,#635BFF,#A259FF)',
  'linear-gradient(135deg,#FF6B9D,#A259FF)',
  'linear-gradient(135deg,#3DDC84,#635BFF)',
  'linear-gradient(135deg,#FF9500,#FF6B9D)',
  'linear-gradient(135deg,#06D6A0,#00AADD)',
  'linear-gradient(135deg,#FFD166,#FF9500)',
];

function leaderInitials(name = '') {
  return name.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
}

function LeadershipTab({ clubId, showToast }) {
  const [leadership,    setLeadership]    = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [editing,       setEditing]       = useState(false);
  const [positions,     setPositions]     = useState([]);
  const [photoFiles,    setPhotoFiles]    = useState({});      // index → File
  const [photoPreviews, setPhotoPreviews] = useState({});      // index → object URL
  const [saving,        setSaving]        = useState(false);
  const fileRefs = useRef({});

  useEffect(() => {
    api.get(`/clubs/${clubId}/leadership`)
      .then(r => setLeadership(r.leadership || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [clubId]);

  // Revoke blob URLs on cleanup
  useEffect(() => {
    return () => { Object.values(photoPreviews).forEach(URL.revokeObjectURL); };
  }, [photoPreviews]);

  const startEdit = () => {
    setPositions(leadership.length
      ? leadership.map(l => ({
          role_title:      l.role_title      || '',
          holder_name:     l.holder_name     || '',
          holder_email:    l.holder_email    || '',
          phone:           l.phone           || '',
          responsibilities: l.responsibilities || '',
          photo_url:       l.photo_url       || '',
        }))
      : [{ ...EMPTY_POS }]
    );
    setPhotoFiles({});
    setPhotoPreviews({});
    setEditing(true);
  };

  const updatePos = (i, field, value) =>
    setPositions(ps => ps.map((x, j) => j === i ? { ...x, [field]: value } : x));

  const removePos = (i) => {
    setPositions(ps => ps.filter((_, j) => j !== i));
    setPhotoFiles(prev => {
      const next = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = parseInt(k, 10);
        if (ki < i) next[ki] = v;
        else if (ki > i) next[ki - 1] = v;
      });
      return next;
    });
    setPhotoPreviews(prev => {
      if (prev[i]) URL.revokeObjectURL(prev[i]);
      const next = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = parseInt(k, 10);
        if (ki < i) next[ki] = v;
        else if (ki > i) next[ki - 1] = v;
      });
      return next;
    });
  };

  const handlePhotoChange = (i, file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPhotoFiles(prev => ({ ...prev, [i]: file }));
    setPhotoPreviews(prev => {
      if (prev[i]) URL.revokeObjectURL(prev[i]);
      return { ...prev, [i]: url };
    });
  };

  const removePhoto = (i) => {
    setPhotoFiles(prev => { const n = { ...prev }; delete n[i]; return n; });
    setPhotoPreviews(prev => {
      if (prev[i]) URL.revokeObjectURL(prev[i]);
      const n = { ...prev }; delete n[i]; return n;
    });
    updatePos(i, 'photo_url', '');
    if (fileRefs.current[i]) fileRefs.current[i].value = '';
  };

  const save = async () => {
    if (!positions.some(p => p.role_title.trim())) {
      showToast('Add at least one role title before saving.');
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('positions', JSON.stringify(positions));
      Object.entries(photoFiles).forEach(([idx, file]) => fd.append(`photo_${idx}`, file));
      const res = await api.putForm(`/clubs/${clubId}/leadership`, fd);
      setLeadership(res.leadership || []);
      // Clear stale blob URLs
      setPhotoPreviews(prev => { Object.values(prev).forEach(u => URL.revokeObjectURL(u)); return {}; });
      setPhotoFiles({});
      setEditing(false);
      showToast('Leadership saved ✓');
    } catch (e) { showToast(e.message || 'Save failed.'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className={s.loading}><div className={s.spinner} /></div>;

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div>
          <p className={s.cardTitle}>Leadership Positions</p>
          <p className={s.cardSub}>{leadership.length} position{leadership.length !== 1 ? 's' : ''} defined</p>
        </div>
        {!editing && (
          <button className={`${s.btn} ${s.btnPrimary} ${s.btnSmall}`} onClick={startEdit}>
            {leadership.length > 0 ? 'Edit' : '+ Add'}
          </button>
        )}
      </div>

      {/* ── Read view ── */}
      {!editing && (
        leadership.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyIco}>👑</div>
            <p>No positions defined yet. Click Add to set up leadership roles.</p>
          </div>
        ) : (
          <div className={s.leaderGrid}>
            {leadership.map((l, i) => (
              <div key={l.id || i} className={s.leaderCard}>
                {l.photo_url ? (
                  <div className={s.leaderAv} style={{ padding: 0 }}>
                    <img
                      src={l.photo_url}
                      alt={l.holder_name || l.role_title}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center', display: 'block', borderRadius: '50%' }}
                    />
                  </div>
                ) : (
                  <div className={s.leaderAv}
                    style={{ background: LEADER_GRADIENTS[i % LEADER_GRADIENTS.length] }}>
                    {leaderInitials(l.holder_name || l.role_title)}
                  </div>
                )}
                <div className={s.leaderRole}>{l.role_title}</div>
                <div className={s.leaderName}>{l.holder_name || '—'}</div>
                <div className={s.leaderContactRow}>
                  {l.holder_email && (
                    <div className={s.leaderContact}>
                      <span className={s.leaderContactIcon}>✉</span>
                      <span>{l.holder_email}</span>
                    </div>
                  )}
                  {l.phone && (
                    <div className={s.leaderContact}>
                      <span className={s.leaderContactIcon}>📞</span>
                      <span>{l.phone}</span>
                    </div>
                  )}
                </div>
                {l.responsibilities && (
                  <div className={s.leaderResp}>{l.responsibilities}</div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Edit view ── */}
      {editing && (
        <>
          {positions.map((p, i) => {
            const preview = photoPreviews[i] || p.photo_url || null;
            return (
              <div key={i} className={s.posCard}>
                {/* Photo row */}
                <div className={s.posPhotoRow}>
                  <div className={s.posPhotoCircle}>
                    {preview
                      ? <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span style={{ fontSize: 20, color: '#9ca3af' }}>👤</span>
                    }
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <button type="button" className={s.photoUploadBtn}
                      onClick={() => fileRefs.current[i]?.click()}>
                      {preview ? '🔄 Change Photo' : '📷 Upload Photo'}
                    </button>
                    {preview && (
                      <button type="button" className={s.photoRemoveBtn} onClick={() => removePhoto(i)}>
                        Remove
                      </button>
                    )}
                  </div>
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    ref={el => fileRefs.current[i] = el}
                    onChange={e => handlePhotoChange(i, e.target.files[0])} />
                  {/* Remove position button pushed to right */}
                  <button className={`${s.btn} ${s.btnDanger} ${s.btnSmall}`}
                    style={{ marginLeft: 'auto', alignSelf: 'flex-start' }}
                    onClick={() => removePos(i)}>✕</button>
                </div>

                {/* Fields grid */}
                <div className={s.posGrid}>
                  <div className={s.field} style={{ margin: 0 }}>
                    <label>Role Title *</label>
                    <input value={p.role_title} placeholder="e.g. President"
                      onChange={e => updatePos(i, 'role_title', e.target.value)} />
                  </div>
                  <div className={s.field} style={{ margin: 0 }}>
                    <label>Holder Name</label>
                    <input value={p.holder_name} placeholder="Member name"
                      onChange={e => updatePos(i, 'holder_name', e.target.value)} />
                  </div>
                  <div className={s.field} style={{ margin: 0 }}>
                    <label>Email</label>
                    <input value={p.holder_email} placeholder="email@rku.ac.in"
                      onChange={e => updatePos(i, 'holder_email', e.target.value)} />
                  </div>
                  <div className={s.field} style={{ margin: 0 }}>
                    <label>Phone / WhatsApp</label>
                    <input value={p.phone} placeholder="+91 9876543210"
                      onChange={e => updatePos(i, 'phone', e.target.value)} />
                  </div>
                </div>

                {/* Responsibilities */}
                <div className={s.field} style={{ margin: '8px 0 0' }}>
                  <label>Roles & Responsibilities</label>
                  <textarea rows={2} value={p.responsibilities}
                    placeholder="Describe this position's duties and responsibilities…"
                    onChange={e => updatePos(i, 'responsibilities', e.target.value)}
                    style={{ resize: 'vertical', lineHeight: 1.5 }} />
                </div>
              </div>
            );
          })}

          <div className={s.btnRow} style={{ marginTop: 8 }}>
            <button className={`${s.btn} ${s.btnOutline} ${s.btnSmall}`}
              onClick={() => setPositions(ps => [...ps, { ...EMPTY_POS }])}>
              + Add Position
            </button>
          </div>
          <div className={s.btnRow} style={{ marginTop: 12 }}>
            <button className={`${s.btn} ${s.btnPrimary}`} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save Leadership'}
            </button>
            <button className={`${s.btn} ${s.btnOutline}`} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   PROGRESS TAB — Advanced Performance Tracking
══════════════════════════════════════════════════════════ */

/* ── Period / date helpers (pure, no hooks) ── */
function fmtIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function periodLabel(period, d) {
  switch (period) {
    case 'day': return d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    case 'week': {
      const mon = new Date(d); mon.setDate(d.getDate()-((d.getDay()+6)%7));
      const sun = new Date(mon); sun.setDate(mon.getDate()+6);
      return `${mon.toLocaleDateString('en-GB',{day:'numeric',month:'short'})} – ${sun.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}`;
    }
    case 'month': return d.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
    case 'year':  return String(d.getFullYear());
    default: return '';
  }
}
function navDate(period, d, dir) {
  const n = new Date(d);
  switch (period) {
    case 'day':   n.setDate(n.getDate()+dir);           break;
    case 'week':  n.setDate(n.getDate()+dir*7);         break;
    case 'month': n.setMonth(n.getMonth()+dir);         break;
    case 'year':  n.setFullYear(n.getFullYear()+dir);   break;
  }
  return n;
}
function applyLabel(param, value) {
  const ts = Array.isArray(param.thresholds) ? param.thresholds : [];
  if (!ts.length) return { label: '—', color: '#6b7280' };
  if (param.measurement_type === 'lower_better') {
    for (const t of ts) if (value <= Number(t.value)) return { label: t.label, color: t.color||'#6b7280' };
  } else {
    for (const t of ts) if (value >= Number(t.value)) return { label: t.label, color: t.color||'#6b7280' };
  }
  const last = ts[ts.length-1];
  return { label: last.label, color: last.color||'#6b7280' };
}
const THRESHOLD_COLORS = ['#059669','#3b82f6','#f59e0b','#ef4444','#8b5cf6','#ec4899'];

/* ── Param form modal ── */
function ParamFormModal({ initial, onSave, onClose, saving }) {
  const blank = { name:'', description:'', unit:'', measurement_type:'higher_better',
                  max_value:'', category:'General', thresholds:[] };
  const [form, setForm] = useState(initial ? { ...blank, ...initial,
    max_value: initial.max_value ?? '',
    thresholds: Array.isArray(initial.thresholds) ? initial.thresholds.map(t=>({...t})) : []
  } : blank);

  const setF = (k,v) => setForm(f=>({...f,[k]:v}));
  const addThreshold = () => setForm(f=>({
    ...f,
    thresholds:[...f.thresholds,{ value:'', label:'', color: THRESHOLD_COLORS[f.thresholds.length % THRESHOLD_COLORS.length] }]
  }));
  const setT = (i,k,v) => setForm(f=>({ ...f, thresholds: f.thresholds.map((t,j)=>j===i?{...t,[k]:v}:t) }));
  const removeT = (i)   => setForm(f=>({ ...f, thresholds: f.thresholds.filter((_,j)=>j!==i) }));

  const isHigh = form.measurement_type === 'higher_better';
  const thresholdHint = isHigh
    ? 'Sort from best (highest) to worst (lowest) — e.g. ≥ 8 = Excellent, ≥ 5 = Good, ≥ 0 = Improving'
    : 'Sort from best (lowest) to worst (highest) — e.g. ≤ 10s = Elite, ≤ 15s = Good, ≤ 999 = Improving';

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modal} style={{maxWidth:540,width:'94vw'}} onClick={e=>e.stopPropagation()}>
        <div className={s.modalHead}>
          <span className={s.modalTitle}>{initial?.id ? 'Edit Parameter' : 'New Parameter'}</span>
          <button className={s.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={s.modalBody}>
          <div className={s.grid2}>
            <div className={s.field} style={{gridColumn:'1/-1'}}>
              <label>Parameter Name *</label>
              <input value={form.name} onChange={e=>setF('name',e.target.value)} placeholder="e.g. Shooting Accuracy" />
            </div>
            <div className={s.field}>
              <label>Unit</label>
              <input value={form.unit} onChange={e=>setF('unit',e.target.value)} placeholder="e.g. goals, seconds, kg" />
            </div>
            <div className={s.field}>
              <label>Category</label>
              <input value={form.category} onChange={e=>setF('category',e.target.value)} placeholder="e.g. Technical, Physical" />
            </div>
            <div className={s.field}>
              <label>Measurement</label>
              <select value={form.measurement_type} onChange={e=>setF('measurement_type',e.target.value)}>
                <option value="higher_better">Higher is Better</option>
                <option value="lower_better">Lower is Better</option>
              </select>
            </div>
            <div className={s.field}>
              <label>Max Value (optional)</label>
              <input type="number" value={form.max_value} onChange={e=>setF('max_value',e.target.value)} placeholder="e.g. 10 for shots/10" />
            </div>
            <div className={s.field} style={{gridColumn:'1/-1'}}>
              <label>Description</label>
              <textarea rows={2} value={form.description} onChange={e=>setF('description',e.target.value)}
                placeholder="What does this parameter measure?" />
            </div>
          </div>

          <div className={s.thresholdsSection}>
            <div className={s.thresholdsHead}>
              <span className={s.thresholdsTitle}>Performance Thresholds</span>
              <button className={`${s.btn} ${s.btnSmall} ${s.btnOutline}`} type="button" onClick={addThreshold}>+ Add</button>
            </div>
            <p className={s.thresholdsHint}>{thresholdHint}</p>
            {form.thresholds.map((t,i) => (
              <div key={i} className={s.thresholdRow}>
                <span className={s.thresholdDir}>{isHigh ? '≥' : '≤'}</span>
                <input className={s.thresholdVal} type="number" step="0.1"
                  value={t.value} onChange={e=>setT(i,'value',e.target.value)} placeholder="0" />
                <input className={s.thresholdLabel} value={t.label}
                  onChange={e=>setT(i,'label',e.target.value)} placeholder="Label" />
                <input type="color" className={s.thresholdColor}
                  value={t.color||'#6b7280'} onChange={e=>setT(i,'color',e.target.value)} />
                <button className={s.thresholdDel} onClick={()=>removeT(i)}>✕</button>
              </div>
            ))}
            {form.thresholds.length === 0 &&
              <p style={{fontSize:'.75rem',color:'#9ca3af',margin:'6px 0 0'}}>No thresholds yet — scores will show raw values only.</p>
            }
          </div>

          <div className={s.btnRow}>
            <button className={`${s.btn} ${s.btnPrimary}`} disabled={saving || !form.name.trim()}
              onClick={() => onSave(form)}>
              {saving ? 'Saving…' : (initial?.id ? 'Update Parameter' : 'Create Parameter')}
            </button>
            <button className={`${s.btn} ${s.btnOutline}`} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Record Assessments modal ── */
function RecordModal({ param, players, onSave, onClose, saving }) {
  const today = fmtIso(new Date());
  const [date, setDate]     = useState(today);
  const [vals, setVals]     = useState(() =>
    Object.fromEntries(players.map(p => [p.userId, { value:'', notes:'' }]))
  );
  const setV = (uid, k, v) => setVals(prev => ({ ...prev, [uid]: { ...prev[uid], [k]: v } }));

  const hasMax = param.max_value && Number(param.max_value) > 0;
  const maxV   = Number(param.max_value);

  const preview = (uid) => {
    const v = vals[uid]?.value;
    if (v === '' || v == null) return null;
    const num = parseFloat(v);
    if (isNaN(num)) return null;
    return applyLabel(param, num);
  };

  const validCount = players.filter(p => vals[p.userId]?.value !== '' && vals[p.userId]?.value != null).length;

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modal} style={{maxWidth:560,width:'95vw',maxHeight:'90vh',display:'flex',flexDirection:'column'}} onClick={e=>e.stopPropagation()}>
        <div className={s.modalHead}>
          <span className={s.modalTitle}>Record: {param.name}</span>
          <button className={s.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={s.modalBody} style={{overflowY:'auto',flex:1}}>
          <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:12,flexWrap:'wrap'}}>
            <div className={s.field} style={{flex:1,minWidth:140,marginBottom:0}}>
              <label>Assessment Date</label>
              <input type="date" value={date} onChange={e=>setDate(e.target.value)} />
            </div>
            <div className={s.field} style={{flex:1,minWidth:160,marginBottom:0}}>
              <label>Unit</label>
              <span style={{display:'flex',alignItems:'center',gap:6,fontSize:'.85rem',color:'#6b7280',marginTop:6}}>
                {param.unit || 'raw score'}
                {hasMax && <span style={{color:'#8b5cf6',fontWeight:600}}>/ {maxV}</span>}
                <span style={{fontSize:'.72rem',background:'#f3f4f6',padding:'2px 6px',borderRadius:4}}>
                  {param.measurement_type === 'lower_better' ? 'Lower = Better' : 'Higher = Better'}
                </span>
              </span>
            </div>
          </div>
          <div className={s.recordList}>
            {players.map((p,i) => {
              const lbl = preview(p.userId);
              return (
                <div key={p.userId} className={s.recordRow}>
                  <div className={s.recordAv} style={{background: GRADS[i % GRADS.length]}}>
                    {initials(p.userName)}
                  </div>
                  <span className={s.recordName}>{p.userName}</span>
                  <input
                    className={s.recordInput}
                    type="number" step="0.01"
                    min={0} max={hasMax ? maxV : undefined}
                    value={vals[p.userId]?.value ?? ''}
                    placeholder={hasMax ? `0 – ${maxV}` : '—'}
                    onChange={e=>setV(p.userId,'value',e.target.value)}
                  />
                  {lbl && (
                    <span className={s.recordLabel} style={{background: lbl.color+'22', color: lbl.color, border:`1px solid ${lbl.color}44`}}>
                      {lbl.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className={s.btnRow} style={{marginTop:16}}>
            <button className={`${s.btn} ${s.btnPrimary}`} disabled={saving || validCount===0}
              onClick={() => onSave(date, vals)}>
              {saving ? 'Saving…' : `Save ${validCount} Assessment${validCount!==1?'s':''}`}
            </button>
            <button className={`${s.btn} ${s.btnOutline}`} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Player Detail Modal ── */
function PlayerDetailModal({ player, params, clubId, period, currentDate, onClose }) {
  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await api.get(
          `/clubs/${clubId}/performance/player/${player.userId}?period=${period}&date=${fmtIso(currentDate)}`
        );
        setTimeline(data);
      } catch (_) {}
      setLoading(false);
    };
    fetch();
  }, [clubId, player.userId, period, currentDate]);

  const attStats = { present:0, late:0, absent:0, excused:0 };
  if (timeline?.attendance) {
    for (const a of timeline.attendance) attStats[a.status] = (attStats[a.status]||0)+1;
  }
  const totalSessions = timeline?.attendance?.length || 0;

  return (
    <div className={s.modalOverlay} onClick={onClose}>
      <div className={s.modal} style={{maxWidth:600,width:'95vw',maxHeight:'90vh',display:'flex',flexDirection:'column'}}
           onClick={e=>e.stopPropagation()}>
        <div className={s.modalHead}>
          <span className={s.modalTitle}>{player.userName} — Detailed View</span>
          <button className={s.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={s.modalBody} style={{overflowY:'auto',flex:1}}>
          {loading ? (
            <div className={s.loading}><div className={s.spinner}/></div>
          ) : (
            <>
              {/* Summary chips */}
              <div className={s.detailChips}>
                <div className={s.detailChip}>
                  <span className={s.detailChipVal}>{player.xp}</span>
                  <span className={s.detailChipLbl}>XP</span>
                </div>
                <div className={s.detailChip}>
                  <span className={s.detailChipVal}>{player.coins}</span>
                  <span className={s.detailChipLbl}>Coins</span>
                </div>
                <div className={s.detailChip}>
                  <span className={s.detailChipVal}>{player.level}</span>
                  <span className={s.detailChipLbl}>Level</span>
                </div>
                <div className={s.detailChip}>
                  <span className={s.detailChipVal}>{totalSessions > 0 ? `${attStats.present}/${totalSessions}` : '—'}</span>
                  <span className={s.detailChipLbl}>Present</span>
                </div>
              </div>

              {/* Attendance log */}
              {timeline?.attendance?.length > 0 && (
                <div className={s.detailSection}>
                  <p className={s.detailSectionTitle}>Attendance ({timeline.attendance.length} sessions)</p>
                  <div className={s.detailAttList}>
                    {timeline.attendance.map((a, i) => (
                      <div key={i} className={s.detailAttRow}>
                        <span className={s.detailAttDate}>{new Date(a.session_date).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>
                        <span className={`${s.detailBadge} ${s[`weeklyBadge_${a.status}`]}`}>{a.status}</span>
                        {a.session_label && <span className={s.detailAttLabel}>{a.session_label}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Task completions */}
              {timeline?.tasks?.length > 0 && (
                <div className={s.detailSection}>
                  <p className={s.detailSectionTitle}>Tasks ({timeline.tasks.filter(t=>t.is_completed).length}/{timeline.tasks.length} completed)</p>
                  <div className={s.detailTaskList}>
                    {timeline.tasks.map((t,i) => (
                      <div key={i} className={s.detailTaskRow}>
                        <span className={t.is_completed ? s.detailTaskDone : s.detailTaskPend}>
                          {t.is_completed ? '✓' : '○'}
                        </span>
                        <span className={s.detailTaskName}>{t.task_title}</span>
                        {t.is_completed && <span className={s.detailTaskCoins}>+{t.coins_awarded} coins</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Performance timeline per param */}
              {params.map(p => {
                const records = timeline?.performance?.[String(p.id)] || [];
                if (!records.length) return null;
                return (
                  <div key={p.id} className={s.detailSection}>
                    <p className={s.detailSectionTitle}>{p.name} ({p.unit || 'score'})</p>
                    <div className={s.detailPerfList}>
                      {records.map((r,i) => (
                        <div key={i} className={s.detailPerfRow}>
                          <span className={s.detailPerfDate}>{new Date(r.date).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</span>
                          <span className={s.detailPerfVal}>
                            {r.value}{p.max_value ? `/${p.max_value}` : ''} {p.unit}
                          </span>
                          {r.label && (
                            <span style={{fontSize:'.72rem',fontWeight:600,padding:'2px 8px',borderRadius:4,
                              background:r.color+'22',color:r.color,border:`1px solid ${r.color}44`}}>
                              {r.label}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {(!timeline?.attendance?.length && !timeline?.tasks?.length && Object.keys(timeline?.performance||{}).length===0) && (
                <p style={{color:'#9ca3af',fontSize:'.85rem',textAlign:'center',padding:'24px 0'}}>No records for this period.</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main ProgressTab ── */
const PERIODS = ['Day','Week','Month','Year'];

function ProgressTab({ clubId, members, showToast }) {
  const [period,      setPeriod]      = useState('Week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [subTab,      setSubTab]      = useState('players'); // 'players' | 'params' | 'record'

  /* Dashboard data */
  const [dashData,    setDashData]    = useState(null);
  const [dashLoading, setDashLoading] = useState(true);

  /* Param management */
  const [showParamForm, setShowParamForm] = useState(false);
  const [editingParam,  setEditingParam]  = useState(null);
  const [paramSaving,   setParamSaving]   = useState(false);

  /* Assessment recording */
  const [recordParam,  setRecordParam]  = useState(null);
  const [recordSaving, setRecordSaving] = useState(false);

  /* Player detail */
  const [detailPlayer, setDetailPlayer] = useState(null);


  const loadDash = useCallback(async () => {
    setDashLoading(true);
    try {
      const data = await api.get(
        `/clubs/${clubId}/performance/dashboard?period=${period.toLowerCase()}&date=${fmtIso(currentDate)}`
      );
      setDashData(data);
    } catch (_) {}
    setDashLoading(false);
  }, [clubId, period, currentDate]);

  useEffect(() => { loadDash(); }, [loadDash]);

  /* Period navigation */
  const navigate = (dir) => setCurrentDate(d => navDate(period.toLowerCase(), d, dir));

  /* Param CRUD */
  const saveParam = async (form) => {
    setParamSaving(true);
    try {
      const cleaned = {
        ...form,
        max_value: form.max_value !== '' ? Number(form.max_value) : null,
        thresholds: form.thresholds.map(t => ({ ...t, value: Number(t.value) })),
      };
      if (editingParam?.id) {
        await api.put(`/clubs/${clubId}/performance/params/${editingParam.id}`, cleaned);
        showToast('Parameter updated ✓');
      } else {
        await api.post(`/clubs/${clubId}/performance/params`, cleaned);
        showToast('Parameter created ✓');
      }
      setShowParamForm(false);
      setEditingParam(null);
      loadDash();
    } catch (e) { showToast(e.message || 'Save failed.'); }
    setParamSaving(false);
  };

  const deactivateParam = async (paramId) => {
    if (!window.confirm('Deactivate this parameter? Existing records are kept.')) return;
    try {
      await api.delete(`/clubs/${clubId}/performance/params/${paramId}`);
      showToast('Parameter deactivated.');
      loadDash();
    } catch (e) { showToast(e.message || 'Failed.'); }
  };

  /* Assessment recording */
  const saveAssessment = async (date, vals) => {
    setRecordSaving(true);
    try {
      const records = (dashData?.players || [])
        .filter(p => vals[p.userId]?.value !== '' && vals[p.userId]?.value != null)
        .map(p => ({ userId: p.userId, userName: p.userName, value: Number(vals[p.userId].value), notes: vals[p.userId].notes || '' }));
      await api.post(`/clubs/${clubId}/performance/records`, { paramId: recordParam.id, recordedDate: date, records });
      showToast(`Assessments saved for ${records.length} member(s) ✓`);
      setRecordParam(null);
      loadDash();
    } catch (e) { showToast(e.message || 'Failed.'); }
    setRecordSaving(false);
  };

  const params  = dashData?.params  || [];
  const players = dashData?.players || [];

  /* Summary stats */
  const avgAtt  = players.filter(p=>p.attendance.rate!=null).length
    ? Math.round(players.filter(p=>p.attendance.rate!=null).reduce((a,p)=>a+p.attendance.rate,0)/players.filter(p=>p.attendance.rate!=null).length)
    : null;
  const avgTask = players.filter(p=>p.tasks.rate!=null).length
    ? Math.round(players.filter(p=>p.tasks.rate!=null).reduce((a,p)=>a+p.tasks.rate,0)/players.filter(p=>p.tasks.rate!=null).length)
    : null;

  return (
    <>
      {/* Period selector + date navigator */}
      <div className={s.perfHeader}>
        <div className={s.periodTabs}>
          {PERIODS.map(p => (
            <button key={p}
              className={`${s.periodTab} ${period===p ? s.periodTabActive : ''}`}
              onClick={()=>{ setPeriod(p); }}>
              {p}
            </button>
          ))}
        </div>
        <div className={s.dateNav}>
          <button className={s.dateNavBtn} onClick={()=>navigate(-1)}>&#8249;</button>
          <span className={s.dateNavLabel}>{periodLabel(period.toLowerCase(), currentDate)}</span>
          <button className={s.dateNavBtn} onClick={()=>navigate(1)}>&#8250;</button>
        </div>
      </div>

      {/* Summary bar */}
      <div className={s.perfSummary}>
        <div className={s.perfSumChip}>
          <span className={s.perfSumVal}>{players.length}</span>
          <span className={s.perfSumLbl}>Members</span>
        </div>
        <div className={s.perfSumChip}>
          <span className={s.perfSumVal}>{avgAtt != null ? `${avgAtt}%` : '—'}</span>
          <span className={s.perfSumLbl}>Avg Attendance</span>
        </div>
        <div className={s.perfSumChip}>
          <span className={s.perfSumVal}>{avgTask != null ? `${avgTask}%` : '—'}</span>
          <span className={s.perfSumLbl}>Avg Tasks Done</span>
        </div>
        <div className={s.perfSumChip}>
          <span className={s.perfSumVal}>{params.length}</span>
          <span className={s.perfSumLbl}>Active Metrics</span>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className={s.perfSubTabs}>
        <button className={`${s.perfSubTab} ${subTab==='players'?s.perfSubTabActive:''}`} onClick={()=>setSubTab('players')}>
          Players Overview
        </button>
        <button className={`${s.perfSubTab} ${subTab==='params'?s.perfSubTabActive:''}`} onClick={()=>setSubTab('params')}>
          Metrics ({params.length})
        </button>
        <button className={`${s.perfSubTab} ${subTab==='record'?s.perfSubTabActive:''}`} onClick={()=>setSubTab('record')}>
          Record Now
        </button>
      </div>

      {dashLoading ? (
        <div className={s.loading}><div className={s.spinner}/></div>
      ) : (

        /* ── PLAYERS OVERVIEW ── */
        subTab === 'players' ? (
          <div className={s.card}>
            {players.length === 0 ? (
              <div className={s.empty}>
                <div className={s.emptyIco}>📊</div>
                <p>No members yet or no data for this period.</p>
              </div>
            ) : (
              <div className={s.perfTableWrap}>
                <table className={s.perfTable}>
                  <thead>
                    <tr>
                      <th className={s.perfThName}>Player</th>
                      <th className={s.perfTh}>Attendance</th>
                      <th className={s.perfTh}>Tasks</th>
                      {params.map(p=>(
                        <th key={p.id} className={s.perfTh} title={p.description}>
                          {p.name}{p.unit?` (${p.unit})`:''}
                        </th>
                      ))}
                      <th className={s.perfTh}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {players.map((p,i) => {
                      return (
                        <tr key={p.userId} className={s.perfRow} onClick={()=>{
                          setDetailPlayer(p);
                        }}>
                          <td className={s.perfTdName}>
                            <div className={s.perfAvWrap}>
                              <div className={s.perfAv} style={{background:GRADS[i%GRADS.length]}}>
                                {initials(p.userName)}
                              </div>
                              <span>{p.userName}</span>
                            </div>
                          </td>
                          <td className={s.perfTd}>
                            {p.attendance.sessions > 0 ? (
                              <div className={s.perfRateWrap}>
                                <div className={s.perfRateBar}>
                                  <div className={s.perfRateFill} style={{
                                    width:`${p.attendance.rate??0}%`,
                                    background: p.attendance.rate >= 75 ? '#059669' : p.attendance.rate >= 50 ? '#f59e0b' : '#ef4444'
                                  }}/>
                                </div>
                                <span className={s.perfRateNum}>{p.attendance.rate}%</span>
                                <span className={s.perfRateSub}>{p.attendance.present}P {p.attendance.late}L {p.attendance.absent}A</span>
                              </div>
                            ) : <span style={{color:'#9ca3af',fontSize:'.75rem'}}>No sessions</span>}
                          </td>
                          <td className={s.perfTd}>
                            {p.tasks.total > 0 ? (
                              <div className={s.perfRateWrap}>
                                <div className={s.perfRateBar}>
                                  <div className={s.perfRateFill} style={{
                                    width:`${p.tasks.rate??0}%`,
                                    background: p.tasks.rate >= 80 ? '#059669' : p.tasks.rate >= 50 ? '#f59e0b' : '#ef4444'
                                  }}/>
                                </div>
                                <span className={s.perfRateNum}>{p.tasks.rate}%</span>
                                <span className={s.perfRateSub}>{p.tasks.completed}/{p.tasks.total}</span>
                              </div>
                            ) : <span style={{color:'#9ca3af',fontSize:'.75rem'}}>—</span>}
                          </td>
                          {params.map(param => {
                            const rec = p.params[String(param.id)];
                            return (
                              <td key={param.id} className={s.perfTd}>
                                {rec ? (
                                  <div className={s.perfParamCell}>
                                    <span className={s.perfParamVal}>
                                      {rec.value}{param.max_value?`/${param.max_value}`:''}
                                    </span>
                                    {rec.label && (
                                      <span className={s.perfParamLabel}
                                        style={{background:rec.color+'22',color:rec.color,border:`1px solid ${rec.color}44`}}>
                                        {rec.label}
                                      </span>
                                    )}
                                  </div>
                                ) : <span style={{color:'#9ca3af',fontSize:'.75rem'}}>—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) :

        /* ── PARAMS MANAGEMENT ── */
        subTab === 'params' ? (
          <div className={s.card}>
            <div className={s.cardHead}>
              <div>
                <p className={s.cardTitle}>Performance Metrics</p>
                <p className={s.cardSub}>Define what you measure. Each metric can have custom thresholds.</p>
              </div>
              <button className={`${s.btn} ${s.btnPrimary} ${s.btnSmall}`}
                onClick={()=>{ setEditingParam(null); setShowParamForm(true); }}>
                + Add Metric
              </button>
            </div>

            {params.length === 0 ? (
              <div className={s.empty}>
                <div className={s.emptyIco}>🎯</div>
                <p>No metrics defined yet. Add your first performance parameter.</p>
              </div>
            ) : (
              <div className={s.paramGrid}>
                {params.map(p => (
                  <div key={p.id} className={s.paramCard}>
                    <div className={s.paramCardTop}>
                      <div>
                        <p className={s.paramName}>{p.name}</p>
                        <p className={s.paramMeta}>
                          {p.unit && <span>{p.unit}</span>}
                          {p.category && <span className={s.paramCat}>{p.category}</span>}
                          <span className={`${s.paramDir} ${p.measurement_type==='lower_better'?s.paramDirLow:s.paramDirHigh}`}>
                            {p.measurement_type==='lower_better'?'↓ Lower Better':'↑ Higher Better'}
                          </span>
                        </p>
                        {p.description && <p className={s.paramDesc}>{p.description}</p>}
                      </div>
                      <div className={s.paramActions}>
                        <button className={`${s.btn} ${s.btnSmall} ${s.btnOutline}`}
                          onClick={()=>{ setEditingParam(p); setShowParamForm(true); }}>Edit</button>
                        <button className={`${s.btn} ${s.btnSmall} ${s.btnDanger}`}
                          onClick={()=>deactivateParam(p.id)}>Remove</button>
                      </div>
                    </div>
                    {Array.isArray(p.thresholds) && p.thresholds.length > 0 && (
                      <div className={s.paramThresholds}>
                        {p.thresholds.map((t,i) => (
                          <span key={i} className={s.paramThreshChip}
                            style={{background:t.color+'22',color:t.color,border:`1px solid ${t.color}44`}}>
                            {p.measurement_type==='lower_better'?'≤':'≥'}{t.value} = {t.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) :

        /* ── RECORD NOW ── */
        (
          <div className={s.card}>
            <div className={s.cardHead}>
              <div>
                <p className={s.cardTitle}>Record Assessments</p>
                <p className={s.cardSub}>Select a metric below and enter scores for each member.</p>
              </div>
            </div>
            {params.length === 0 ? (
              <div className={s.empty}>
                <div className={s.emptyIco}>📝</div>
                <p>No metrics defined. Go to the Metrics tab to add parameters first.</p>
              </div>
            ) : (
              <div className={s.recordParamList}>
                {params.map(p => (
                  <div key={p.id} className={s.recordParamCard}>
                    <div className={s.recordParamInfo}>
                      <p className={s.recordParamName}>{p.name}</p>
                      <p className={s.recordParamMeta}>
                        {p.unit && <span>{p.unit}</span>}
                        {p.max_value && <span>max {p.max_value}</span>}
                        <span className={`${s.paramDir} ${p.measurement_type==='lower_better'?s.paramDirLow:s.paramDirHigh}`}>
                          {p.measurement_type==='lower_better'?'↓ Lower Better':'↑ Higher Better'}
                        </span>
                      </p>
                      {Array.isArray(p.thresholds) && p.thresholds.length > 0 && (
                        <div className={s.paramThresholds} style={{marginTop:4}}>
                          {p.thresholds.map((t,i)=>(
                            <span key={i} className={s.paramThreshChip}
                              style={{background:t.color+'22',color:t.color,border:`1px solid ${t.color}44`}}>
                              {t.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button className={`${s.btn} ${s.btnPrimary} ${s.btnSmall}`}
                      onClick={()=>setRecordParam(p)}>
                      Enter Scores
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      )}

      {/* Param form modal */}
      {showParamForm && (
        <ParamFormModal
          initial={editingParam}
          onSave={saveParam}
          onClose={()=>{ setShowParamForm(false); setEditingParam(null); }}
          saving={paramSaving}
        />
      )}

      {/* Record assessment modal */}
      {recordParam && (
        <RecordModal
          param={recordParam}
          players={players}
          onSave={saveAssessment}
          onClose={()=>setRecordParam(null)}
          saving={recordSaving}
        />
      )}

      {/* Player detail modal */}
      {detailPlayer && (
        <PlayerDetailModal
          player={detailPlayer}
          params={params}
          clubId={clubId}
          period={period.toLowerCase()}
          currentDate={currentDate}
          onClose={()=>setDetailPlayer(null)}
        />
      )}

    </>
  );
}

/* ── Shared utility ── */
const formatClock = (sec) => {
  const n = Math.max(0, Number(sec || 0));
  const m = String(Math.floor(n / 60)).padStart(2, '0');
  const s2 = String(n % 60).padStart(2, '0');
  return `${m}:${s2}`;
};

/* ── Basketball LED Scoreboard Display ── */
function BasketballScoreboard({ score, clubName, events }) {
  const homeScore  = Number(score?.teamScore    ?? 0);
  const awayScore  = Number(score?.opponentScore ?? 0);
  const quarter    = score?.scoreData?.quarter   || 'Q1';
  const possession = score?.scoreData?.possession || null;
  const homeFouls  = Number(score?.scoreData?.home?.fouls ?? 0);
  const awayFouls  = Number(score?.scoreData?.away?.fouls ?? 0);
  /* bonus = opponent committed ≥ 7 fouls this half */
  const homeBonus  = awayFouls >= 7;
  const awayBonus  = homeFouls >= 7;
  const periodNum  = ({ Q1:1, Q2:2, Q3:3, Q4:4, OT:5 })[quarter] ?? 1;

  /* jersey # of last scorer */
  const lastScorer = (events || []).find(ev => ev.event_type === 'shot_made' && ev.player_name);
  const playerJersey = (() => {
    if (!lastScorer) return '--';
    const roster = lastScorer.team_side === 'home'
      ? (score?.homePlayers || [])
      : (score?.awayPlayers || []);
    const p = roster.find(r => r.name === lastScorer.player_name);
    return p?.number || '--';
  })();

  return (
    <div className={s.sbBoard}>
      {/* ── Team name bar with possession / period indicators ── */}
      <div className={s.sbTeamBar}>
        <span className={s.sbTeamTxt}>{(clubName || 'HOME').toUpperCase()}</span>
        <div className={s.sbCenterBar}>
          <span className={`${s.sbPossDot} ${possession === 'home' ? s.sbPossDotOn : ''}`} />
          <span className={s.sbMiniLbl}>POSS</span>
          <div className={s.sbPeriodWrap}>
            <span className={s.sbMiniLbl}>PERIOD</span>
            <div className={s.sbPeriodRow}>
              {[1,2,3,4].map(n => (
                <span key={n} className={`${s.sbPeriodDot} ${n <= periodNum ? s.sbPeriodDotOn : ''}`} />
              ))}
            </div>
          </div>
          <span className={s.sbMiniLbl}>POSS</span>
          <span className={`${s.sbPossDot} ${possession === 'away' ? s.sbPossDotOn : ''}`} />
        </div>
        <span className={`${s.sbTeamTxt} ${s.sbTeamTxtRight}`}>{(score?.opponentName || 'GUEST').toUpperCase()}</span>
      </div>

      {/* ── Scores + clock ── */}
      <div className={s.sbMainRow}>
        <div className={s.sbScoreCol}>
          <div className={s.sbLedGreen}>{String(homeScore).padStart(2, '0')}</div>
          <div className={s.sbBonusLine}>
            <span className={`${s.sbBonusDot} ${homeBonus ? s.sbBonusDotOn : ''}`} />
            <span className={s.sbMiniLbl}>BONUS</span>
          </div>
        </div>
        <div className={s.sbClockCol}>
          <div className={s.sbLedAmber}>{formatClock(score?.timeRemainingSeconds)}</div>
          <div className={s.sbQtrLabel}>{quarter}</div>
        </div>
        <div className={s.sbScoreCol}>
          <div className={s.sbLedGreen}>{String(awayScore).padStart(2, '0')}</div>
          <div className={s.sbBonusLine}>
            <span className={`${s.sbBonusDot} ${awayBonus ? s.sbBonusDotOn : ''}`} />
            <span className={s.sbMiniLbl}>BONUS</span>
          </div>
        </div>
      </div>

      {/* ── Fouls + player strip ── */}
      <div className={s.sbFooter}>
        <div className={s.sbFoulBlock}>
          <div className={s.sbFDotRow}>
            {Array.from({ length: 7 }).map((_, i) => (
              <span key={i} className={`${s.sbFDot} ${i < homeFouls ? s.sbFDotOn : ''}`} />
            ))}
          </div>
          <div className={s.sbFoulData}>
            <span className={s.sbFoulNum}>{homeFouls}</span>
            <div className={s.sbFoulLabels}>
              <span className={s.sbMiniLbl}>FOULS</span>
              <span className={s.sbScoreTag}>SCORE</span>
            </div>
          </div>
        </div>
        <div className={s.sbPlayerMid}>
          <span className={s.sbMiniLbl}>PLAYER</span>
          <span className={s.sbPlayerJersey}>{playerJersey}</span>
          <span className={s.sbMiniLbl}>MATCH</span>
        </div>
        <div className={`${s.sbFoulBlock} ${s.sbFoulBlockRight}`}>
          <div className={s.sbFoulData}>
            <div className={s.sbFoulLabels}>
              <span className={s.sbMiniLbl}>FOULS</span>
              <span className={s.sbScoreTag}>SCORE</span>
            </div>
            <span className={s.sbFoulNum}>{awayFouls}</span>
          </div>
          <div className={s.sbFDotRow}>
            {Array.from({ length: 7 }).map((_, i) => (
              <span key={i} className={`${s.sbFDot} ${i < awayFouls ? s.sbFDotOn : ''}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Inline-edit text field ─────────────────────────────
   Renders as styled text; click → input; blur/Enter saves.
   Escape cancels. className applied to both display + input.
──────────────────────────────────────────────────────── */
function InlineEdit({ value, onSave, className, placeholder, style }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value || '');
  const inputRef              = useRef(null);

  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);
  useEffect(() => { if (!editing) setDraft(value || ''); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== (value || '').trim()) onSave(v);
  };

  if (!editing) return (
    <div
      className={className}
      style={{ cursor: 'text', ...style }}
      title="Click to edit"
      onClick={() => { setDraft(value || ''); setEditing(true); }}
    >
      {value || <span style={{ opacity: .45 }}>{placeholder}</span>}
    </div>
  );
  return (
    <input
      ref={inputRef}
      className={className}
      style={{ background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.55)', borderRadius: 5, color: 'inherit', font: 'inherit', padding: '2px 6px', width: '100%', boxSizing: 'border-box', outline: 'none', ...style }}
      value={draft}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') setEditing(false); }}
    />
  );
}

/* ── Inline-edit timer (MM:SS) ──────────────────────────
   Displays the formatted clock; click to type a new time.
──────────────────────────────────────────────────────── */
function TimerInlineEdit({ seconds, onSave, className }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const inputRef              = useRef(null);

  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const parseMMSS = (v) => {
    const s = v.trim();
    const colonIdx = s.indexOf(':');
    if (colonIdx !== -1) {
      const m = parseInt(s.slice(0, colonIdx), 10);
      const sec = parseInt(s.slice(colonIdx + 1), 10);
      if (!isNaN(m) && !isNaN(sec)) return m * 60 + sec;
    }
    const raw = parseInt(s, 10);
    return isNaN(raw) ? null : raw;
  };

  const commit = () => {
    setEditing(false);
    const parsed = parseMMSS(draft);
    if (parsed !== null && parsed >= 0) onSave(parsed);
  };

  if (!editing) return (
    <div
      className={className}
      style={{ cursor: 'text' }}
      title="Click to set time"
      onClick={() => { setDraft(formatClock(seconds)); setEditing(true); }}
    >
      {formatClock(seconds)}
    </div>
  );
  return (
    <input
      ref={inputRef}
      className={className}
      style={{ textAlign: 'center', background: '#eff6ff', border: '2px solid #1d4ed8', borderRadius: 10, color: '#1d4ed8', font: 'inherit', letterSpacing: 'inherit', padding: '8px 14px', width: '100%', boxSizing: 'border-box', outline: 'none' }}
      value={draft}
      placeholder="MM:SS"
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') setEditing(false); }}
    />
  );
}

/* ══════════════════════════════════════════════════════════
   LIVE SCOREBOARD TAB
══════════════════════════════════════════════════════════ */
function LiveScoreboardTab({ clubId, club, showToast }) {
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [selectedScoreId, setSelectedScoreId] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventForm, setEventForm] = useState({
    eventType: 'shot_made',
    teamSide: 'home',
    playerName: '',
    relatedPlayerName: '',
    points: 2,
    shotClock: 24,
  });
  const [conn, setConn] = useState('connecting');
  const [lastUpdated, setLastUpdated] = useState(null);
  const socket = useMemo(() => getSocket(), []);
  const [form, setForm] = useState({
    sport: 'cricket',
    matchTitle: '',
    homeTeam: '',
    awayTeam: '',
    venue: '',
    gameClock: '',
    teamScore: 0,
    opponentScore: 0,
    scoreData: { home: {}, away: {} },
    stats: { home: {}, away: {} },
    homePlayers: [],
    awayPlayers: [],
    timeRemainingSeconds: SPORT_TIMER_SECONDS.cricket,
  });

  /* ── Event auto-fill state ── */
  const [sportEvents, setSportEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [eventFixtures, setEventFixtures] = useState([]);
  const [eventTeamsList, setEventTeamsList] = useState([]);
  const [gamedayOptions, setGamedayOptions] = useState([]);
  const [selectedGameday, setSelectedGameday] = useState('');
  const [gamedayMatches, setGamedayMatches] = useState([]);
  const [selectedMatchId, setSelectedMatchId] = useState('');
  const [loadingEventData, setLoadingEventData] = useState(false);
  const [linkedFixtureId, setLinkedFixtureId] = useState(null);
  const [endingScoreId, setEndingScoreId] = useState(null);
  const [mvpData,       setMvpData]       = useState({});   /* scoreId → mvp object */
  const [mvpUploading,  setMvpUploading]  = useState(null); /* scoreId uploading photo */

  const load = useCallback(async () => {
    try {
      const data = await api.get(`/clubs/${clubId}/live-scores`);
      const scores = data.scores || [];
      setScores(scores);
      /* Pre-load MVPs for any already-ended scoreboards */
      scores.filter(sc => sc.status === 'ended').forEach(sc => {
        api.get(`/clubs/${clubId}/live-scores/${sc.id}/mvp`)
          .then(({ mvp }) => { if (mvp) setMvpData(prev => ({ ...prev, [sc.id]: mvp })); })
          .catch(() => {});
      });
    } catch {
      setScores([]);
    }
    setLoading(false);
  }, [clubId]);

  useEffect(() => { load(); }, [load]);

  /* Fetch all events for this club so coordinator can auto-fill the scoreboard form */
  useEffect(() => {
    api.get(`/events?clubId=${clubId}&limit=100`)
      .then(data => setSportEvents(data.events || []))
      .catch(() => {});
  }, [clubId]);

  useEffect(() => {
    const onConnect = () => setConn('connected');
    const onDisconnect = () => setConn('disconnected');
    const onUpdate = ({ score }) => {
      if (!score) return;
      setScores(ss => ss.map(x => x.id === score.id ? score : x));
      setLastUpdated(new Date().toISOString());
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('basketball:score:update', onUpdate);
    setConn(socket.connected ? 'connected' : 'connecting');
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('basketball:score:update', onUpdate);
    };
  }, [socket]);

  useEffect(() => {
    if (!selectedScoreId) return;
    socket.emit('basketball:join', { scoreId: selectedScoreId });
    return () => socket.emit('basketball:leave', { scoreId: selectedScoreId });
  }, [socket, selectedScoreId]);

  useEffect(() => {
    const t = setInterval(() => {
      setScores(ss => ss.map(sc => {
        if (!sc.timerRunning || Number(sc.timeRemainingSeconds || 0) <= 0) return sc;
        const next = Number(sc.timeRemainingSeconds || 0) - 1;
        if (next > 0) return { ...sc, timeRemainingSeconds: next };
        /* Set timer just ran out — for volleyball, declare whoever has more points the set
           winner (same as clicking ahead to the next set), reset the clock for the next set,
           and pause so the coordinator has to press ▶ again once it's ready. */
        if (sc.sport === 'volleyball') {
          const result = finalizeVolleyballSet(sc.scoreData, Number(sc.teamScore || 0), Number(sc.opponentScore || 0));
          if (result) {
            const updated = {
              ...sc,
              teamScore: result.teamScore,
              opponentScore: result.opponentScore,
              scoreData: result.scoreData,
              timeRemainingSeconds: SPORT_TIMER_SECONDS.volleyball || 0,
              timerRunning: false,
            };
            api.patch(`/clubs/${clubId}/live-scores/${sc.id}`, {
              teamScore: updated.teamScore, opponentScore: updated.opponentScore, scoreData: updated.scoreData,
              timeRemainingSeconds: updated.timeRemainingSeconds, timerRunning: false,
            }).catch(() => {});
            return updated;
          }
        }
        return { ...sc, timeRemainingSeconds: 0 };
      }));
    }, 1000);
    return () => clearInterval(t);
  }, [clubId]);

  const blankPlayer = (sport) => {
    const stats = {};
    (PLAYER_STAT_FIELDS[sport] || []).forEach(k => { stats[k] = ''; });
    return { name: '', number: '', stats };
  };

  const setSport = (sport) => {
    setForm({
      sport,
      matchTitle: '',
      homeTeam: '',
      awayTeam: '',
      venue: '',
      gameClock: '',
      teamScore: 0,
      opponentScore: 0,
      scoreData: sport === 'volleyball'
        ? { home: { setsWon: 0, set: 1 }, away: { setsWon: 0, set: 1 }, pointsToWin: VOLLEYBALL_DEFAULT_POINTS_TO_WIN, sets: [] }
        : { home: {}, away: {} },
      stats: { home: {}, away: {} },
      homePlayers: [blankPlayer(sport)],
      awayPlayers: [blankPlayer(sport)],
      timeRemainingSeconds: SPORT_TIMER_SECONDS[sport] || 3600,
    });
  };

  const updateField = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const updateNested = (bucket, k, v) => setForm(f => ({ ...f, [bucket]: { ...(f[bucket] || {}), [k]: v } }));

  const addPlayer = (side) => {
    const key = side === 'home' ? 'homePlayers' : 'awayPlayers';
    setForm(f => ({ ...f, [key]: [...(f[key] || []), { name: '', number: '', stats: {} }] }));
  };
  const removePlayer = (side, idx) => {
    const key = side === 'home' ? 'homePlayers' : 'awayPlayers';
    setForm(f => ({ ...f, [key]: f[key].filter((_, i) => i !== idx) }));
  };
  const updatePlayer = (side, idx, field, value) => {
    const key = side === 'home' ? 'homePlayers' : 'awayPlayers';
    setForm(f => ({ ...f, [key]: f[key].map((p, i) => i === idx ? { ...p, [field]: value } : p) }));
  };

  /* ── Event auto-fill handlers ── */
  const applyFixtureToForm = (fixture, teams, evTitle) => {
    const roundPart = fixture.round ? ` – ${fixture.round}` : '';
    const matchTitle = evTitle
      ? `${evTitle}${roundPart}: ${fixture.teamA} vs ${fixture.teamB}`
      : `${fixture.teamA} vs ${fixture.teamB}`;
    const homeObj = teams.find(t => t.name === fixture.teamA);
    const awayObj = teams.find(t => t.name === fixture.teamB);
    const toPlayers = (obj) => (obj?.members || []).map(m => ({ name: m.name, number: m.enrollmentNo || '', stats: {} }));
    setLinkedFixtureId(fixture.id || null);
    setForm(f => ({
      ...f,
      matchTitle,
      homeTeam: fixture.teamA || '',
      awayTeam: fixture.teamB || '',
      venue: fixture.venue || f.venue,
      homePlayers: toPlayers(homeObj),
      awayPlayers: toPlayers(awayObj),
    }));
  };

  const handleEventSelect = async (eventId) => {
    setSelectedEventId(eventId);
    setSelectedGameday('');
    setGamedayMatches([]);
    setSelectedMatchId('');
    setGamedayOptions([]);
    setEventFixtures([]);
    setEventTeamsList([]);
    setLinkedFixtureId(null);
    if (!eventId) return;
    setLoadingEventData(true);
    try {
      const [fixtureData, teamData] = await Promise.all([
        api.get(`/events/${eventId}/fixtures`),
        api.get(`/events/${eventId}/teams`),
      ]);
      const fixtures = fixtureData.fixtures || [];
      const teams = teamData.teams || [];
      setEventFixtures(fixtures);
      setEventTeamsList(teams);
      const dates = [...new Set(fixtures.filter(f => f.date).map(f => f.date))].sort();
      setGamedayOptions(dates);
      if (!dates.length) showToast('No fixtures with dates found for this event.');
    } catch {
      showToast('Could not load event data.');
    } finally {
      setLoadingEventData(false);
    }
  };

  const handleGamedaySelect = (date, teams, fixtures) => {
    const teamsToUse = teams || eventTeamsList;
    const fixturesToUse = fixtures || eventFixtures;
    setSelectedGameday(date);
    setSelectedMatchId('');
    if (!date) { setGamedayMatches([]); return; }
    const matches = fixturesToUse.filter(f => f.date === date);
    setGamedayMatches(matches);
    if (matches.length === 1) {
      const ev = sportEvents.find(e => String(e.id) === selectedEventId);
      applyFixtureToForm(matches[0], teamsToUse, ev?.title || '');
    }
  };

  const handleMatchSelect = (matchId) => {
    setSelectedMatchId(matchId);
    const match = gamedayMatches.find(m => m.id === matchId);
    if (!match) return;
    const ev = sportEvents.find(e => String(e.id) === selectedEventId);
    applyFixtureToForm(match, eventTeamsList, ev?.title || '');
  };

  const createBoard = async () => {
    if (!form.matchTitle.trim()) return showToast('Add game title first.');
    if (!form.homeTeam.trim() || !form.awayTeam.trim()) return showToast('Enter both team names.');
    setCreating(true);
    try {
      const { score } = await api.post(`/clubs/${clubId}/live-scores`, {
        ...form,
        opponentName: form.awayTeam,
        fixtureId: linkedFixtureId || null,
        eventId:   selectedEventId || null,
      });
      setScores(ss => [score, ...ss]);
      if (score.sport === 'basketball') setSelectedScoreId(score.id);
      showToast('Scoreboard created.');
    } catch (e) {
      showToast(e.message || 'Failed to create scoreboard.');
    } finally {
      setCreating(false);
    }
  };

  const patchScore = async (scoreId, payload) => {
    setUpdatingId(scoreId);
    try {
      const { score } = await api.patch(`/clubs/${clubId}/live-scores/${scoreId}`, payload);
      setScores(ss => ss.map(x => x.id === scoreId ? score : x));
    } catch (e) {
      showToast(e.message || 'Update failed.');
    } finally {
      setUpdatingId(null);
    }
  };

  const selectedScore = scores.find(x => x.id === selectedScoreId) || null;
  const rosterForSide = (side) => {
    if (!selectedScore) return [];
    const src = side === 'home' ? (selectedScore.homePlayers || []) : (selectedScore.awayPlayers || []);
    return src.map(p => p.name).filter(Boolean);
  };

  const loadEvents = useCallback(async (scoreId) => {
    if (!scoreId) return;
    try {
      const data = await api.get(`/clubs/${clubId}/live-scores/${scoreId}/events`);
      setEvents(data.events || []);
    } catch {
      setEvents([]);
    }
  }, [clubId]);

  useEffect(() => {
    if (!selectedScoreId) return;
    loadEvents(selectedScoreId);
  }, [selectedScoreId, loadEvents]);

  const logEvent = async (override = {}) => {
    if (!selectedScoreId) return;
    const payload = {
      ...eventForm,
      ...override,
      gameClock: selectedScore?.gameClock || '',
      quarter: selectedScore?.scoreData?.quarter || 'Q1',
      shotClock: Number(selectedScore?.scoreData?.shotClock ?? eventForm.shotClock ?? 24),
      clientEventId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    };
    try {
      const { score, event } = await api.post(`/clubs/${clubId}/live-scores/${selectedScoreId}/events`, payload);
      setScores(ss => ss.map(x => x.id === score.id ? score : x));
      setEvents(ev => [event, ...ev]);
      setLastUpdated(new Date().toISOString());
    } catch (e) {
      showToast(e.message || 'Could not log event.');
    }
  };

  const undoLast = async () => {
    if (!selectedScoreId) return;
    try {
      const { score } = await api.post(`/clubs/${clubId}/live-scores/${selectedScoreId}/undo`);
      setScores(ss => ss.map(x => x.id === score.id ? score : x));
      loadEvents(selectedScoreId);
    } catch (e) { showToast(e.message || 'Nothing to undo.'); }
  };

  const redoLast = async () => {
    if (!selectedScoreId) return;
    try {
      const { score } = await api.post(`/clubs/${clubId}/live-scores/${selectedScoreId}/redo`);
      setScores(ss => ss.map(x => x.id === score.id ? score : x));
      loadEvents(selectedScoreId);
    } catch (e) { showToast(e.message || 'Nothing to redo.'); }
  };

  const tweakEventPoints = async (eventId, current, delta) => {
    if (!selectedScoreId) return;
    try {
      await api.patch(`/clubs/${clubId}/live-scores/${selectedScoreId}/events/${eventId}`, { points: Math.max(0, Number(current || 0) + delta) });
      loadEvents(selectedScoreId);
    } catch (e) {
      showToast(e.message || 'Could not edit event.');
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (!selectedScoreId) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === '1') { e.preventDefault(); logEvent({ eventType: 'shot_made', points: 1 }); }
      if (e.key === '2') { e.preventDefault(); logEvent({ eventType: 'shot_made', points: 2 }); }
      if (e.key === '3') { e.preventDefault(); logEvent({ eventType: 'shot_made', points: 3 }); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoLast(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redoLast(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const timerAction = async (scoreId, action, payload = {}) => {
    setUpdatingId(scoreId);
    try {
      const { score } = await api.post(`/clubs/${clubId}/live-scores/${scoreId}/timer/${action}`, payload);
      setScores(ss => ss.map(x => x.id === scoreId ? score : x));
    } catch (e) {
      showToast(e.message || 'Timer update failed.');
    } finally {
      setUpdatingId(null);
    }
  };

  const markLive = async (scoreId) => {
    setUpdatingId(scoreId);
    try {
      const { score } = await api.post(`/clubs/${clubId}/live-scores/${scoreId}/start`);
      setScores(ss => ss.map(x => x.id === scoreId ? score : x));
      showToast('Game started and listed as ongoing in Events/Games.');
    } catch (e) {
      showToast(e.message || 'Could not start game.');
    } finally {
      setUpdatingId(null);
    }
  };

  const markEnded = async (scoreId, winnerName) => {
    setEndingScoreId(null);
    setUpdatingId(scoreId);
    try {
      const { score } = await api.post(`/clubs/${clubId}/live-scores/${scoreId}/end`, { winnerName: winnerName || null });
      setScores(ss => ss.map(x => x.id === scoreId ? score : x));
      showToast(winnerName ? `Game ended — ${winnerName} wins!` : 'Game ended.');
      /* Fetch auto-generated MVP */
      try {
        const { mvp } = await api.get(`/clubs/${clubId}/live-scores/${scoreId}/mvp`);
        if (mvp) setMvpData(prev => ({ ...prev, [scoreId]: mvp }));
      } catch { /* silent */ }
    } catch (e) {
      showToast(e.message || 'Could not end game.');
    } finally {
      setUpdatingId(null);
    }
  };

  const uploadMvpPhoto = async (scoreId, file) => {
    if (!file) return;
    setMvpUploading(scoreId);
    try {
      const fd = new FormData();
      fd.append('photo', file);
      const token = localStorage.getItem('soac_token') || sessionStorage.getItem('soac_token') || '';
      const res = await fetch(`/api/clubs/${clubId}/live-scores/${scoreId}/mvp/photo`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Upload failed');
      setMvpData(prev => ({ ...prev, [scoreId]: data.mvp }));
      showToast('MVP photo updated!');
    } catch (e) {
      showToast(e.message || 'Photo upload failed.');
    } finally {
      setMvpUploading(null);
    }
  };

  /* ── Quick-action helpers: optimistic local update + fire-and-forget patch ── */
  const adjustScore = (scoreId, side, delta) => {
    setScores(ss => {
      const next = ss.map(x => {
        if (x.id !== scoreId) return x;
        let newHome = side === 'home' ? Math.max(0, Number(x.teamScore || 0) + delta) : Number(x.teamScore || 0);
        let newAway = side === 'away' ? Math.max(0, Number(x.opponentScore || 0) + delta) : Number(x.opponentScore || 0);
        let scoreData = x.scoreData;
        /* Volleyball's set-completion check has to run here too — these quick +1/− buttons
           write teamScore/opponentScore directly, same as the per-player PT button does. */
        if (x.sport === 'volleyball') {
          const result = applyVolleyballSetResult(x.scoreData, newHome, newAway);
          newHome = result.teamScore;
          newAway = result.opponentScore;
          scoreData = result.scoreData;
        }
        return { ...x, teamScore: newHome, opponentScore: newAway, scoreData };
      });
      const sc = next.find(x => x.id === scoreId);
      if (sc) api.patch(`/clubs/${clubId}/live-scores/${scoreId}`, {
        teamScore: sc.teamScore, opponentScore: sc.opponentScore, scoreData: sc.scoreData,
      }).catch(() => {});
      return next;
    });
  };

  const adjustFouls = (scoreId, side, delta) => {
    setScores(ss => {
      const next = ss.map(x => {
        if (x.id !== scoreId) return x;
        const cur = Number(x.scoreData?.[side]?.fouls ?? 0);
        return { ...x, scoreData: { ...(x.scoreData || {}), [side]: { ...(x.scoreData?.[side] || {}), fouls: Math.max(0, cur + delta) } } };
      });
      const sc = next.find(x => x.id === scoreId);
      if (sc) api.patch(`/clubs/${clubId}/live-scores/${scoreId}`, { scoreData: sc.scoreData }).catch(() => {});
      return next;
    });
  };

  const adjustTimeouts = (scoreId, side, delta) => {
    setScores(ss => {
      const next = ss.map(x => {
        if (x.id !== scoreId) return x;
        const cur = Number(x.scoreData?.[side]?.timeouts ?? 0);
        return { ...x, scoreData: { ...(x.scoreData || {}), [side]: { ...(x.scoreData?.[side] || {}), timeouts: Math.max(0, cur + delta) } } };
      });
      const sc = next.find(x => x.id === scoreId);
      if (sc) api.patch(`/clubs/${clubId}/live-scores/${scoreId}`, { scoreData: sc.scoreData }).catch(() => {});
      return next;
    });
  };

  const adjustPlayerStat = (scoreId, side, playerIdx, stat, delta) => {
    setScores(ss => {
      const next = ss.map(x => {
        if (x.id !== scoreId) return x;
        const key = side === 'home' ? 'homePlayers' : 'awayPlayers';
        const players = (x[key] || []).map((p, i) => {
          if (i !== playerIdx) return p;
          const cur = Number(p.stats?.[stat] ?? 0);
          return { ...p, stats: { ...(p.stats || {}), [stat]: Math.max(0, cur + delta) } };
        });
        return { ...x, [key]: players };
      });
      const sc = next.find(x => x.id === scoreId);
      if (sc) api.patch(`/clubs/${clubId}/live-scores/${scoreId}`, {
        homePlayers: sc.homePlayers,
        awayPlayers: sc.awayPlayers,
      }).catch(() => {});
      return next;
    });
  };

  /* Coordinator-editable target score for the current/upcoming volleyball set — e.g. 25 for
     sets 1-4, dropped to 15 before the deciding 5th set. Only affects sets not yet completed. */
  const updateVolleyballPointsToWin = (scoreId, value) => {
    const pointsToWin = Math.max(1, Number(value) || VOLLEYBALL_DEFAULT_POINTS_TO_WIN);
    setScores(ss => {
      const next = ss.map(x => x.id === scoreId ? { ...x, scoreData: { ...(x.scoreData || {}), pointsToWin } } : x);
      const sc = next.find(x => x.id === scoreId);
      if (sc) api.patch(`/clubs/${clubId}/live-scores/${scoreId}`, { scoreData: sc.scoreData }).catch(() => {});
      return next;
    });
  };

  /* Ends the current volleyball set right now (whoever has more points wins it) and starts
     recording the next set — triggered by clicking the next set's cell in the set grid, or
     automatically when that set's timer runs out (see the countdown effect below). */
  const advanceVolleyballSet = (scoreId, sc) => {
    const result = finalizeVolleyballSet(sc.scoreData, Number(sc.teamScore || 0), Number(sc.opponentScore || 0));
    if (!result) { showToast('Scores are tied — cannot end the set yet.'); return; }
    setScores(ss => ss.map(x => x.id === scoreId ? {
      ...x,
      teamScore: result.teamScore,
      opponentScore: result.opponentScore,
      scoreData: result.scoreData,
      timeRemainingSeconds: SPORT_TIMER_SECONDS.volleyball || 0,
      timerRunning: false,
    } : x));
    api.patch(`/clubs/${clubId}/live-scores/${scoreId}`, {
      teamScore: result.teamScore, opponentScore: result.opponentScore, scoreData: result.scoreData,
      timeRemainingSeconds: SPORT_TIMER_SECONDS.volleyball || 0, timerRunning: false,
    }).catch(() => {});
  };

  /* Score points for a player AND update the team total simultaneously. `statKey` lets a
     single sport have several scoring buttons (volleyball's PT/ATK/BLK each win a rally)
     that all add to the team score while crediting a different player stat; other sports
     keep passing no statKey and fall back to their one SPORT_SCORE_STAT as before. */
  const scorePlayerPoints = (scoreId, side, playerIdx, value, statKey) => {
    setScores(ss => {
      const next = ss.map(x => {
        if (x.id !== scoreId) return x;
        const stat = statKey || SPORT_SCORE_STAT[x.sport] || 'points';
        const key = side === 'home' ? 'homePlayers' : 'awayPlayers';
        const players = (x[key] || []).map((p, i) => {
          if (i !== playerIdx) return p;
          const cur = Number(p.stats?.[stat] ?? 0);
          return { ...p, stats: { ...(p.stats || {}), [stat]: cur + value } };
        });
        let newHome = side === 'home' ? Math.max(0, Number(x.teamScore || 0) + value) : Number(x.teamScore || 0);
        let newAway = side === 'away' ? Math.max(0, Number(x.opponentScore || 0) + value) : Number(x.opponentScore || 0);
        let scoreData = x.scoreData;
        if (x.sport === 'volleyball') {
          const result = applyVolleyballSetResult(x.scoreData, newHome, newAway);
          newHome = result.teamScore;
          newAway = result.opponentScore;
          scoreData = result.scoreData;
        }
        return { ...x, [key]: players, teamScore: newHome, opponentScore: newAway, scoreData };
      });
      const sc = next.find(x => x.id === scoreId);
      if (sc) api.patch(`/clubs/${clubId}/live-scores/${scoreId}`, {
        teamScore: sc.teamScore, opponentScore: sc.opponentScore,
        homePlayers: sc.homePlayers, awayPlayers: sc.awayPlayers,
        scoreData: sc.scoreData,
      }).catch(() => {});
      return next;
    });
  };

  /* Undo last scoring point for a player (−1 from both player tally and team score).
     Does not un-complete a set that already finished — a rare edge case coordinators
     can correct manually, same limitation the pre-existing undo always had. */
  const undoPlayerPoint = (scoreId, side, playerIdx, statKey) => {
    setScores(ss => {
      const next = ss.map(x => {
        if (x.id !== scoreId) return x;
        const stat = statKey || SPORT_SCORE_STAT[x.sport] || 'points';
        const key = side === 'home' ? 'homePlayers' : 'awayPlayers';
        const target = (x[key] || [])[playerIdx];
        const curPts = Number(target?.stats?.[stat] ?? 0);
        if (curPts <= 0) return x;
        const players = (x[key] || []).map((p, i) => {
          if (i !== playerIdx) return p;
          return { ...p, stats: { ...(p.stats || {}), [stat]: curPts - 1 } };
        });
        const newHome = side === 'home' ? Math.max(0, Number(x.teamScore || 0) - 1) : Number(x.teamScore || 0);
        const newAway = side === 'away' ? Math.max(0, Number(x.opponentScore || 0) - 1) : Number(x.opponentScore || 0);
        return { ...x, [key]: players, teamScore: newHome, opponentScore: newAway };
      });
      const sc = next.find(x => x.id === scoreId);
      if (sc) api.patch(`/clubs/${clubId}/live-scores/${scoreId}`, {
        teamScore: sc.teamScore, opponentScore: sc.opponentScore,
        homePlayers: sc.homePlayers, awayPlayers: sc.awayPlayers,
      }).catch(() => {});
      return next;
    });
  };

  const adjustName = (scoreId, field, value) => {
    setScores(ss => ss.map(x => x.id === scoreId ? { ...x, [field]: value } : x));
    api.patch(`/clubs/${clubId}/live-scores/${scoreId}`, { [field]: value }).catch(() => {});
  };

  const adjustTimer = (scoreId, newSeconds) => {
    setScores(ss => ss.map(x => x.id === scoreId
      ? { ...x, timeRemainingSeconds: newSeconds, timerRunning: false }
      : x
    ));
    api.patch(`/clubs/${clubId}/live-scores/${scoreId}`, { timeRemainingSeconds: newSeconds, timerRunning: false }).catch(() => {});
  };

  const setQuarter = (scoreId, sc, q) => {
    const resetSecs = QUARTER_TIMER[q] ?? 600;
    setScores(ss => ss.map(x => x.id === scoreId
      ? { ...x, scoreData: { ...(x.scoreData || {}), quarter: q }, timeRemainingSeconds: resetSecs, timerRunning: false }
      : x
    ));
    api.patch(`/clubs/${clubId}/live-scores/${scoreId}`, {
      scoreData: { ...(sc.scoreData || {}), quarter: q },
      timeRemainingSeconds: resetSecs,
      timerRunning: false,
    }).catch(() => {});
  };

  const deleteBoard = async (scoreId) => {
    if (!window.confirm('Delete this scoreboard permanently?')) return;
    setUpdatingId(scoreId);
    try {
      await api.delete(`/clubs/${clubId}/live-scores/${scoreId}`);
      setScores(ss => ss.filter(x => x.id !== scoreId));
      if (selectedScoreId === scoreId) { setSelectedScoreId(null); setEvents([]); }
      showToast('Scoreboard deleted.');
    } catch (e) {
      showToast(e.message || 'Could not delete scoreboard.');
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) return <div className={s.loading}><div className={s.spinner} /></div>;

  return (
    <>
      <div className={s.card}>
        <div className={s.cardHead}>
          <div>
            <p className={s.cardTitle}>Create Match Entry (Team vs Team)</p>
            <p className={s.cardSub}>Title at top, then evenly divided team entries for score, stats, and rosters.</p>
          </div>
        </div>
        <div className={s.sportsRow}>
          {LIVE_SPORTS.map(sp => (
            <button key={sp} className={`${s.sportChip} ${form.sport === sp ? s.sportChipOn : ''}`} onClick={() => setSport(sp)}>
              {sp}
            </button>
          ))}
        </div>
        {/* ── Auto-fill from fixture ── */}
        <div className={s.field}>
          <label>
            Load from Sport Event
            {loadingEventData && <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: 6 }}>Loading…</span>}
          </label>
          <select value={selectedEventId} onChange={e => handleEventSelect(e.target.value)}>
            <option value="">— Select an event to auto-fill —</option>
            {sportEvents.map(ev => (
              <option key={ev.id} value={String(ev.id)}>{ev.title}</option>
            ))}
          </select>
        </div>

        {selectedEventId && gamedayOptions.length > 0 && (
          <div className={s.field}>
            <label>Gameday</label>
            <select value={selectedGameday} onChange={e => handleGamedaySelect(e.target.value)}>
              <option value="">— Select a gameday —</option>
              {gamedayOptions.map(d => (
                <option key={d} value={d}>
                  {new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                </option>
              ))}
            </select>
          </div>
        )}

        {gamedayMatches.length > 1 && (
          <div className={s.field}>
            <label>Select Match</label>
            <select value={selectedMatchId} onChange={e => handleMatchSelect(e.target.value)}>
              <option value="">— Select a match —</option>
              {gamedayMatches.map(m => (
                <option key={m.id} value={m.id}>
                  {m.teamA} vs {m.teamB}{m.round ? ` (${m.round})` : ''}{m.time ? ` @ ${m.time}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className={s.field}>
          <label>Game Title</label>
          <input value={form.matchTitle} onChange={e => updateField('matchTitle', e.target.value)} placeholder="Inter-College Final / Semi Final / League Match" />
        </div>
        <div className={s.grid2}>
          <div className={s.field}><label>Team A (Home)</label><input value={form.homeTeam} onChange={e => updateField('homeTeam', e.target.value)} placeholder="Home team name" /></div>
          <div className={s.field}><label>Team B (Away)</label><input value={form.awayTeam} onChange={e => updateField('awayTeam', e.target.value)} placeholder="Away team name" /></div>
          <div className={s.field}><label>Venue</label><input value={form.venue} onChange={e => updateField('venue', e.target.value)} placeholder="Ground / court" /></div>
        </div>
        {/* ── Player rosters ── */}
        <div className={s.rosterFormGrid}>
          {[
            { side: 'home', label: form.homeTeam || 'Home', key: 'homePlayers' },
            { side: 'away', label: form.awayTeam || 'Away', key: 'awayPlayers' },
          ].map(({ side, label, key }) => (
            <div key={side} className={s.rosterFormCol}>
              <div className={s.rosterFormHead}>
                <span>{label} Players</span>
                <button type="button" className={`${s.btn} ${s.btnSmall} ${s.btnOutline}`} onClick={() => addPlayer(side)}>+ Add Player</button>
              </div>
              {(form[key] || []).map((p, idx) => (
                <div key={idx} className={s.rosterFormRow}>
                  <input
                    className={s.rosterNumInput}
                    value={p.number}
                    onChange={e => updatePlayer(side, idx, 'number', e.target.value)}
                    placeholder="#"
                    maxLength={3}
                  />
                  <input
                    className={s.rosterNameInput}
                    value={p.name}
                    onChange={e => updatePlayer(side, idx, 'name', e.target.value)}
                    placeholder="Player name"
                  />
                  <button type="button" className={s.rosterRemoveBtn} onClick={() => removePlayer(side, idx)}>✕</button>
                </div>
              ))}
              {(form[key] || []).length === 0 && (
                <div className={s.rosterEmpty}>Click "+ Add Player" to add players</div>
              )}
            </div>
          ))}
        </div>

        <div className={s.btnRow}>
          <button className={`${s.btn} ${s.btnPrimary}`} onClick={createBoard} disabled={creating}>{creating ? 'Creating…' : 'Create Scoreboard'}</button>
        </div>
      </div>

      <div className={s.card}>
        <div className={s.cardHead}>
          <div>
            <p className={s.cardTitle}>Match Control</p>
            <p className={s.cardSub}>Live matches show as ongoing events in Events/Games page.</p>
          </div>
        </div>
        {scores.length === 0 ? (
          <div className={s.empty}><div className={s.emptyIco}>🏟️</div>Create your first scoreboard above.</div>
        ) : (
          <div className={s.liveList}>
            {scores.map(sc => (
              <div key={sc.id} className={s.mcCard}>

                {/* ── Header ── */}
                <div className={s.mcHeader}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <InlineEdit
                      value={sc.matchTitle}
                      placeholder="Match Title"
                      className={s.mcTitle}
                      onSave={v => adjustName(sc.id, 'matchTitle', v)}
                    />
                    <div className={s.mcMeta} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span style={{ flexShrink: 0 }}>{sc.sport} ·</span>
                      <InlineEdit
                        value={sc.venue}
                        placeholder="Venue TBA"
                        className={s.mcMetaEdit}
                        onSave={v => adjustName(sc.id, 'venue', v)}
                        style={{ color: '#9ca3af', fontSize: '.72rem' }}
                      />
                    </div>
                  </div>
                  <span className={`${s.liveBadge} ${sc.status === 'live' ? s.liveOn : sc.status === 'ended' ? s.liveEnded : s.liveDraft}`}>
                    {sc.status === 'live' ? 'LIVE' : sc.status}
                  </span>
                </div>

                {/* ── Score + Timer ── */}
                <div className={s.mcScoreArea}>
                  {/* Home team */}
                  <div className={s.mcTeamCol}>
                    <InlineEdit
                      value={sc.homeTeam}
                      placeholder="Home Team"
                      className={s.mcTeamLbl}
                      onSave={v => adjustName(sc.id, 'homeTeam', v)}
                      style={{ color: '#6b7280', cursor: 'text' }}
                    />
                    <div className={s.mcBigScore}>{String(Number(sc.teamScore ?? 0)).padStart(2, '0')}</div>
                    <div className={s.mcScoreBtns}>
                      <button className={`${s.mcScoreBtn} ${s.mcScoreBtnSub}`} onClick={() => adjustScore(sc.id, 'home', -1)}>−</button>
                      <button className={s.mcScoreBtn} onClick={() => adjustScore(sc.id, 'home', 1)}>+1</button>
                      {sc.sport !== 'volleyball' && <button className={s.mcScoreBtn} onClick={() => adjustScore(sc.id, 'home', 2)}>+2</button>}
                      {sc.sport === 'basketball' && <button className={s.mcScoreBtn} onClick={() => adjustScore(sc.id, 'home', 3)}>+3</button>}
                    </div>
                    {/* Foul indicator */}
                    {(() => { const f = Number(sc.scoreData?.home?.fouls ?? 0); return f > 0 && (
                      <div className={s.mcFoulRow}>
                        <span className={s.mcFoulLabel}>FOULS</span>
                        <div className={s.mcFoulDots}>
                          {Array.from({ length: Math.min(f, 8) }).map((_, i) => (
                            <span key={i} className={`${s.mcFoulDot} ${i < f ? s.mcFoulDotOn : ''} ${f >= 7 ? s.mcFoulDotBonus : ''}`} />
                          ))}
                        </div>
                        <span className={s.mcFoulCount}>{f}</span>
                      </div>
                    ); })()}
                  </div>

                  {/* Center: volleyball shows the 5-set scoreboard instead of a game clock
                     (volleyball is rally-scored, not timed); every other sport keeps the timer. */}
                  {sc.sport === 'volleyball' ? (
                    <div className={s.mcTimerCol}>
                      <TimerInlineEdit
                        seconds={sc.timeRemainingSeconds}
                        className={s.mcTimerDisplay}
                        onSave={secs => adjustTimer(sc.id, secs)}
                      />
                      <div className={s.mcTimerBtns}>
                        <button className={`${s.mcTimerBtn} ${s.mcTimerBtnGreen}`} disabled={updatingId === sc.id} onClick={() => timerAction(sc.id, 'start')} title="Start / Resume set timer">▶</button>
                        <button className={s.mcTimerBtn} disabled={updatingId === sc.id} onClick={() => timerAction(sc.id, 'stop')} title="Pause">⏸</button>
                        <button className={s.mcTimerBtn} disabled={updatingId === sc.id} onClick={() => timerAction(sc.id, 'reset', { timeRemainingSeconds: SPORT_TIMER_SECONDS.volleyball || 0 })} title="Reset set timer">⟳</button>
                      </div>
                      <div className={s.mcVbSetsGrid}>
                        {Array.from({ length: VOLLEYBALL_MAX_SETS }).map((_, i) => {
                          const setNum = i + 1;
                          const completed = (sc.scoreData?.sets || []).find(st => st.set === setNum);
                          const currentSetNum = Number(sc.scoreData?.home?.set ?? 1);
                          const matchDecided = Number(sc.scoreData?.home?.setsWon ?? 0) >= VOLLEYBALL_SETS_TO_WIN_MATCH
                                             || Number(sc.scoreData?.away?.setsWon ?? 0) >= VOLLEYBALL_SETS_TO_WIN_MATCH;
                          const isCurrent = !completed && !matchDecided && setNum === currentSetNum;
                          /* Clicking the next set ends the current one now (higher points wins)
                             and starts recording this one — only the immediate next set is
                             reachable, sets can't be skipped ahead of. */
                          const isClickableNext = !completed && !matchDecided && setNum === currentSetNum + 1 && setNum <= VOLLEYBALL_MAX_SETS;
                          const homeVal = completed ? completed.home : isCurrent ? Number(sc.teamScore ?? 0) : null;
                          const awayVal = completed ? completed.away : isCurrent ? Number(sc.opponentScore ?? 0) : null;
                          return (
                            <div
                              key={setNum}
                              className={`${s.mcVbSetCol} ${isCurrent ? s.mcVbSetColActive : ''} ${isClickableNext ? s.mcVbSetColClickable : ''}`}
                              title={isClickableNext ? 'Click to end the current set now and start recording this one' : undefined}
                              onClick={isClickableNext ? () => advanceVolleyballSet(sc.id, sc) : undefined}
                            >
                              <div className={s.mcVbSetLabel}>Set {setNum}</div>
                              <div className={`${s.mcVbSetPts} ${completed?.winner === 'home' ? s.mcVbSetPtsWon : ''}`}>
                                {homeVal ?? '–'}
                              </div>
                              <div className={`${s.mcVbSetPts} ${completed?.winner === 'away' ? s.mcVbSetPtsWon : ''}`}>
                                {awayVal ?? '–'}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className={s.mcVbPointsToWinRow}>
                        <span className={s.mcRowLbl}>PTS TO WIN SET</span>
                        <input
                          type="number" min="1"
                          className={s.mcVbPointsInput}
                          value={Number(sc.scoreData?.pointsToWin ?? VOLLEYBALL_DEFAULT_POINTS_TO_WIN)}
                          onChange={e => updateVolleyballPointsToWin(sc.id, e.target.value)}
                          title="Editable — e.g. drop to 15 before the deciding 5th set" />
                      </div>
                    </div>
                  ) : (
                    <div className={s.mcTimerCol}>
                      <TimerInlineEdit
                        seconds={sc.timeRemainingSeconds}
                        className={s.mcTimerDisplay}
                        onSave={secs => adjustTimer(sc.id, secs)}
                      />
                      <div className={s.mcTimerBtns}>
                        <button className={`${s.mcTimerBtn} ${s.mcTimerBtnGreen}`} disabled={updatingId === sc.id} onClick={() => timerAction(sc.id, 'start')} title="Start / Resume">▶</button>
                        <button className={s.mcTimerBtn} disabled={updatingId === sc.id} onClick={() => timerAction(sc.id, 'stop')} title="Pause">⏸</button>
                        <button className={s.mcTimerBtn} disabled={updatingId === sc.id} onClick={() => timerAction(sc.id, 'reset', { timeRemainingSeconds: SPORT_TIMER_SECONDS[sc.sport] || 3600 })} title="Reset full game">⟳</button>
                      </div>
                      {sc.sport === 'basketball' && (
                        <div className={s.mcQtrRow}>
                          {['Q1','Q2','Q3','Q4','OT'].map(q => (
                            <button
                              key={q}
                              className={`${s.mcQtrBtn} ${sc.scoreData?.quarter === q ? s.mcQtrBtnOn : ''}`}
                              title={`Set ${q} · resets clock to ${q === 'OT' ? '5:00' : '10:00'}`}
                              onClick={() => setQuarter(sc.id, sc, q)}
                            >{q}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Away team */}
                  <div className={s.mcTeamCol}>
                    <InlineEdit
                      value={sc.opponentName}
                      placeholder="Away Team"
                      className={s.mcTeamLbl}
                      onSave={v => adjustName(sc.id, 'opponentName', v)}
                      style={{ color: '#6b7280', cursor: 'text' }}
                    />
                    <div className={s.mcBigScore}>{String(Number(sc.opponentScore ?? 0)).padStart(2, '0')}</div>
                    <div className={s.mcScoreBtns}>
                      <button className={`${s.mcScoreBtn} ${s.mcScoreBtnSub}`} onClick={() => adjustScore(sc.id, 'away', -1)}>−</button>
                      <button className={s.mcScoreBtn} onClick={() => adjustScore(sc.id, 'away', 1)}>+1</button>
                      {sc.sport !== 'volleyball' && <button className={s.mcScoreBtn} onClick={() => adjustScore(sc.id, 'away', 2)}>+2</button>}
                      {sc.sport === 'basketball' && <button className={s.mcScoreBtn} onClick={() => adjustScore(sc.id, 'away', 3)}>+3</button>}
                    </div>
                    {/* Foul indicator */}
                    {(() => { const f = Number(sc.scoreData?.away?.fouls ?? 0); return f > 0 && (
                      <div className={s.mcFoulRow}>
                        <span className={s.mcFoulLabel}>FOULS</span>
                        <div className={s.mcFoulDots}>
                          {Array.from({ length: Math.min(f, 8) }).map((_, i) => (
                            <span key={i} className={`${s.mcFoulDot} ${i < f ? s.mcFoulDotOn : ''} ${f >= 7 ? s.mcFoulDotBonus : ''}`} />
                          ))}
                        </div>
                        <span className={s.mcFoulCount}>{f}</span>
                      </div>
                    ); })()}
                  </div>
                </div>

                {/* ── Fouls + Timeouts (not applicable to volleyball) ── */}
                {sc.sport !== 'volleyball' && (
                  <div className={s.mcCounters}>
                    <div className={s.mcCountersRow}>
                      <span className={s.mcRowLbl} />
                      <span className={s.mcTeamColLbl}>{sc.homeTeam || 'Team A'}</span>
                      <span className={s.mcTeamColLbl}>{sc.opponentName || 'Team B'}</span>
                    </div>
                    <div className={s.mcCountersRow}>
                      <span className={s.mcRowLbl}>FOULS</span>
                      <div className={s.mcCounterWidget}>
                        <button className={s.mcCounterBtn} onClick={() => adjustFouls(sc.id, 'home', -1)}>−</button>
                        <span className={s.mcCounterNum}>{Number(sc.scoreData?.home?.fouls ?? 0)}</span>
                        <button className={s.mcCounterBtn} onClick={() => adjustFouls(sc.id, 'home', 1)}>+</button>
                      </div>
                      <div className={s.mcCounterWidget}>
                        <button className={s.mcCounterBtn} onClick={() => adjustFouls(sc.id, 'away', -1)}>−</button>
                        <span className={s.mcCounterNum}>{Number(sc.scoreData?.away?.fouls ?? 0)}</span>
                        <button className={s.mcCounterBtn} onClick={() => adjustFouls(sc.id, 'away', 1)}>+</button>
                      </div>
                    </div>
                    <div className={s.mcCountersRow}>
                      <span className={s.mcRowLbl}>TIMEOUTS</span>
                      <div className={s.mcCounterWidget}>
                        <button className={s.mcCounterBtn} onClick={() => adjustTimeouts(sc.id, 'home', -1)}>−</button>
                        <span className={s.mcCounterNum}>{Number(sc.scoreData?.home?.timeouts ?? 0)}</span>
                        <button className={s.mcCounterBtn} onClick={() => adjustTimeouts(sc.id, 'home', 1)}>+</button>
                      </div>
                      <div className={s.mcCounterWidget}>
                        <button className={s.mcCounterBtn} onClick={() => adjustTimeouts(sc.id, 'away', -1)}>−</button>
                        <span className={s.mcCounterNum}>{Number(sc.scoreData?.away?.timeouts ?? 0)}</span>
                        <button className={s.mcCounterBtn} onClick={() => adjustTimeouts(sc.id, 'away', 1)}>+</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Volleyball: sets-won tally — per-set points now live in the set grid above ── */}
                {sc.sport === 'volleyball' && (
                  <div className={s.mcCounters}>
                    <div className={s.mcCountersRow}>
                      <span className={s.mcRowLbl} />
                      <span className={s.mcTeamColLbl}>{sc.homeTeam || 'Team A'}</span>
                      <span className={s.mcTeamColLbl}>{sc.opponentName || 'Team B'}</span>
                    </div>
                    <div className={s.mcCountersRow}>
                      <span className={s.mcRowLbl}>SETS WON</span>
                      <span className={s.mcTeamColLbl}>{Number(sc.scoreData?.home?.setsWon ?? 0)}</span>
                      <span className={s.mcTeamColLbl}>{Number(sc.scoreData?.away?.setsWon ?? 0)}</span>
                    </div>
                  </div>
                )}

                {/* ── Player Statistics ── */}
                {((sc.homePlayers?.length > 0) || (sc.awayPlayers?.length > 0)) && (
                  <div className={s.mcRosterSection}>
                    <div className={s.mcRosterGrid}>
                      {[
                        { side: 'home', label: sc.homeTeam || 'Home', players: sc.homePlayers || [] },
                        { side: 'away', label: sc.opponentName || 'Away', players: sc.awayPlayers || [] },
                      ].map(({ side, label, players }) => {
                        const statFields  = PLAYER_STAT_FIELDS[sc.sport] || ['points'];
                        const scoreStat   = SPORT_SCORE_STAT[sc.sport] || 'points';
                        const isVolleyball = sc.sport === 'volleyball';
                        /* Volleyball's PT/ATK/BLK are all primary scoring buttons below (each wins a
                           rally and adds to the team score), so none of them get a secondary +/- counter. */
                        const otherStats  = isVolleyball ? [] : statFields.filter(f => f !== scoreStat);
                        const scoreBtns   = SPORT_SCORE_BUTTONS[sc.sport] || SPORT_SCORE_BUTTONS.general;
                        return (
                          <div key={side} className={s.mcRosterCol}>
                            <div className={s.mcRosterHead}>
                              <span className={s.mcRosterTeamLbl}>{label}</span>
                              <div className={s.mcRosterStatLabels}>
                                {otherStats.map(st => (
                                  <span key={st}>{st.replace(/_/g,' ').replace(/(?:^|\s)\S/g,c=>c.toUpperCase()).slice(0,3)}</span>
                                ))}
                              </div>
                            </div>
                            {players.map((p, idx) => {
                              const scorePts = Number(p.stats?.[scoreStat] ?? 0);
                              return (
                                <div key={idx} className={s.mcRosterRow}>
                                  {/* Player name (left, truncates) */}
                                  <div className={s.mcRosterName}>
                                    {p.number && <span className={s.mcRosterNum}>#{p.number}</span>}
                                    <span className={s.mcRosterPlayerName}>{p.name || '—'}</span>
                                  </div>

                                  {/* Score category buttons — right of name. Volleyball has three
                                     (PT/ATK/BLK): PT credits the player and adds to the team's set
                                     score; ATK/BLK (btn.scores === false) are MVP stats only and
                                     never touch the scoreboard. Other sports keep their single
                                     always-scoring stat. */}
                                  {scoreBtns.map(btn => {
                                    const addsToScore = btn.scores !== false;
                                    return (
                                    <span key={btn.label} className={isVolleyball ? s.mcVbScoreGroup : undefined}>
                                      <button
                                        className={s.mcScoreValueBtn}
                                        style={{ background: btn.color, borderColor: btn.color }}
                                        title={btn.title || btn.label}
                                        onClick={() => addsToScore
                                          ? scorePlayerPoints(sc.id, side, idx, btn.value, btn.stat)
                                          : adjustPlayerStat(sc.id, side, idx, btn.stat, btn.value)}>
                                        {btn.label}
                                      </button>
                                      {isVolleyball && (
                                        <span className={s.mcVbStatMini} title={`${btn.stat}: ${Number(p.stats?.[btn.stat] ?? 0)}`}>
                                          {Number(p.stats?.[btn.stat] ?? 0)}
                                        </span>
                                      )}
                                      {isVolleyball && Number(p.stats?.[btn.stat] ?? 0) > 0 && (
                                        <button
                                          className={s.mcScoreValueBtnUndo}
                                          title={`Undo −1 ${btn.label}`}
                                          onClick={() => addsToScore
                                            ? undoPlayerPoint(sc.id, side, idx, btn.stat)
                                            : adjustPlayerStat(sc.id, side, idx, btn.stat, -1)}>
                                          ↩
                                        </button>
                                      )}
                                    </span>
                                    );
                                  })}

                                  {/* Running score badge */}
                                  <span className={s.mcPlayerScoreBadge} title={`${scoreStat}: ${scorePts}`}>
                                    {scorePts}
                                  </span>

                                  {/* Undo last point (non-volleyball — volleyball gets a per-button undo above) */}
                                  {!isVolleyball && scorePts > 0 && (
                                    <button
                                      className={s.mcScoreValueBtnUndo}
                                      title="Undo −1 point"
                                      onClick={() => undoPlayerPoint(sc.id, side, idx)}>
                                      ↩
                                    </button>
                                  )}

                                  {/* Other tracking stats (rebounds, assists, etc.) */}
                                  {otherStats.map(st => (
                                    <div key={st} className={s.mcRosterStatCell}>
                                      <button className={s.mcStatBtn} onClick={() => adjustPlayerStat(sc.id, side, idx, st, -1)}>−</button>
                                      <span className={s.mcStatNum}>{Number(p.stats?.[st] ?? 0)}</span>
                                      <button className={s.mcStatBtn} onClick={() => adjustPlayerStat(sc.id, side, idx, st, 1)}>+</button>
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                            {players.length === 0 && (
                              <div className={s.mcRosterEmpty}>No players added</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Game status + delete ── */}
                <div className={s.mcActions}>
                  {sc.status !== 'live' && (
                    <button className={`${s.btn} ${s.btnPrimary} ${s.btnSmall}`} disabled={updatingId === sc.id} onClick={() => markLive(sc.id)}>
                      ▶ Start Game
                    </button>
                  )}
                  {sc.status === 'live' && endingScoreId !== sc.id && (
                    <button className={`${s.btn} ${s.btnDanger} ${s.btnSmall}`} disabled={updatingId === sc.id} onClick={() => {
                      /* Volleyball's match winner is whoever has more sets, not raw points —
                         team_score/opponent_score only reflect the current/last set in progress. */
                      const home = sc.sport === 'volleyball' ? Number(sc.scoreData?.home?.setsWon ?? 0) : (sc.teamScore ?? 0);
                      const away = sc.sport === 'volleyball' ? Number(sc.scoreData?.away?.setsWon ?? 0) : (sc.opponentScore ?? 0);
                      if (home > away) markEnded(sc.id, sc.homeTeam || 'Home');
                      else if (away > home) markEnded(sc.id, sc.opponentName || 'Away');
                      else setEndingScoreId(sc.id); /* tied — manual pick */
                    }}>
                      ⏹ End Game
                    </button>
                  )}
                  {sc.status === 'live' && endingScoreId === sc.id && (
                    <div className={s.winnerPick}>
                      <span className={s.winnerPickLabel}>Who won?</span>
                      <button className={`${s.btn} ${s.btnSmall} ${s.btnSuccess}`}
                        disabled={updatingId === sc.id}
                        onClick={() => markEnded(sc.id, sc.homeTeam || 'Home')}>
                        {sc.homeTeam || 'Home'}
                      </button>
                      <button className={`${s.btn} ${s.btnSmall} ${s.btnOutline}`}
                        disabled={updatingId === sc.id}
                        onClick={() => markEnded(sc.id, null)}>
                        No Result
                      </button>
                      <button className={`${s.btn} ${s.btnSmall} ${s.btnSuccess}`}
                        disabled={updatingId === sc.id}
                        onClick={() => markEnded(sc.id, sc.opponentName)}>
                        {sc.opponentName || 'Away'}
                      </button>
                      <button className={`${s.btn} ${s.btnSmall}`}
                        style={{ color: '#6b7280' }}
                        onClick={() => setEndingScoreId(null)}>
                        Cancel
                      </button>
                    </div>
                  )}
                  <button className={`${s.btn} ${s.btnDanger} ${s.btnSmall}`} disabled={updatingId === sc.id} onClick={() => deleteBoard(sc.id)}>
                    Delete
                  </button>
                </div>

                {/* ── MVP Card (shown for ended games) ── */}
                {sc.status === 'ended' && mvpData[sc.id] && (() => {
                  const mvp = mvpData[sc.id];
                  const STAT_ORDER = ['PTS','ATK','AST','REB','GLS','RUNS','WKTS','TKLS','RAIDS','WIN','BLK'];
                  const statEntries = Object.entries(mvp.stats || {}).sort(([a],[b]) => {
                    const ai = STAT_ORDER.indexOf(a); const bi = STAT_ORDER.indexOf(b);
                    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
                  });
                  const homeScore = Number(mvp.home_score ?? sc.teamScore ?? 0);
                  const awayScore = Number(mvp.away_score ?? sc.opponentScore ?? 0);
                  const homeFaded = homeScore < awayScore;
                  const awayFaded = awayScore < homeScore;
                  return (
                    <div className={s.mvpCard}>
                      {/* Full-bleed background photo */}
                      {mvp.player_photo
                        ? <img src={mvp.player_photo} alt={mvp.player_name} className={s.mvpBgPhoto} />
                        : <div className={s.mvpBgFallback} />
                      }

                      {/* Photo upload — absolute top-right */}
                      <label className={s.mvpPhotoBtn}>
                        {mvpUploading === sc.id ? '…' : '📷 Add Photo'}
                        <input type="file" accept="image/*" style={{display:'none'}}
                          onChange={e => uploadMvpPhoto(sc.id, e.target.files?.[0])} />
                      </label>

                      {/* Gradient overlay + content */}
                      <div className={s.mvpOverlay}>
                        {/* Top-left: player name */}
                        <span className={s.mvpPlayerName}>
                          {(mvp.player_name || '').split(' ').map((word, i) => (
                            <span key={i} style={{display:'block'}}>{word}</span>
                          ))}
                        </span>

                        {/* Below name: player stats */}
                        <div className={s.mvpStatsLeft}>
                          {statEntries.map(([label, val]) => (
                            <div key={label} className={s.mvpStat}>
                              <span className={s.mvpStatVal}>{val}</span>
                              <span className={s.mvpStatLbl}>{label}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Score bar — single row: name · [21 FINAL 24] · name */}
                      <div className={s.mvpScoreBar}>
                        <span className={s.mvpTeamLbl}>{mvp.home_team}</span>
                        <div className={s.mvpScoreCenter}>
                          <span className={s.mvpScoreNum} style={homeFaded ? {opacity:.35} : undefined}>{homeScore}</span>
                          <span className={s.mvpFinalLbl}>FINAL</span>
                          <span className={s.mvpScoreNum} style={awayFaded ? {opacity:.35} : undefined}>{awayScore}</span>
                        </div>
                        <span className={s.mvpTeamLbl} style={{textAlign:'right'}}>{mvp.opponent_name}</span>
                      </div>
                    </div>
                  );
                })()}

              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
