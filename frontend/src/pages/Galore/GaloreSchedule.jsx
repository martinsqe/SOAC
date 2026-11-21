import { useState, useEffect, useMemo, useCallback } from 'react';
import { galoreApi } from '../../utils/galoreApi';
import { getSocket } from '../../realtime/socket';
import { Empty, Table } from './GaloreUI';
import FitWidth from '../../components/FitWidth/FitWidth';
import s from './Galore.module.css';

/* Galore schedule — the same clear view on every dashboard, and the overall
   Galore coordinator's match maker.
     ScheduleView  every activity and every match, day by day (time · what ·
                   where), with "my activities" highlighted / filterable
     FixtureMaker  overall coordinator: pick an activity, pick two of the teams
                   its club formed, set the date, time and venue */

/* "14:30" (a time input) → "2:30 PM"; anything typed by hand stays as typed */
function fmtTime(t) {
  const v = String(t || '').trim();
  const m = v.match(/^(\d{2}):(\d{2})$/);
  if (!m) return v;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}
/* minutes after midnight, for ordering a day ("10am", "10:30 AM", "14:00") — unknown last */
function toMin(t) {
  const m = String(t || '').trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/);
  if (!m) return 9999;
  let h = Number(m[1]);
  const pm = m[3]?.startsWith('p'), am = m[3]?.startsWith('a');
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  return h * 60 + Number(m[2] || 0);
}
/* a duration in minutes: "2 hours", "1.5 hrs", "90 min", "1 hr 30 min", "90" — null if unreadable */
function durationMin(d) {
  const t = String(d || '').trim().toLowerCase();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const h = t.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  const m = t.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/);
  if (!h && !m) return null;
  return Math.round((h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0));
}
const shortDay = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const divLabel = (act, d) => (act?.genderSplit ? (d === 'girls' ? 'Girls' : 'Boys') : '');
const resultOf = (f) => (f.scoreA != null && f.scoreB != null
  ? `${f.scoreA}–${f.scoreB}${f.winner ? ` · ${f.winner} won` : ''}`
  : f.winner ? `${f.winner} won` : '');

/* ── Duration: how a match / activity is measured — time, points or overs ──
   stored as one short text: "40 min", "21 points", "10 overs" */
const DUR_UNITS = [['min', 'Time (minutes)'], ['points', 'Points'], ['overs', 'Overs']];
/* the usual measure for a sport, from its name */
const unitFor = (title) => {
  const t = String(title || '').toLowerCase();
  if (/cricket/.test(t)) return 'overs';
  if (/volley|badminton|table tennis|tennis|kabaddi|throwball|squash/.test(t)) return 'points';
  return 'min';
};
/* "21 points" → { n: '21', unit: 'points' }; older free text ("2 hours") is read as time */
function splitDuration(d, fallbackUnit = 'min') {
  const t = String(d || '').trim().toLowerCase();
  if (!t) return { n: '', unit: fallbackUnit };
  const num = t.match(/\d+(?:\.\d+)?/)?.[0] || '';
  if (/over/.test(t)) return { n: num, unit: 'overs' };
  if (/point|pts/.test(t)) return { n: num, unit: 'points' };
  const mins = durationMin(t);
  return { n: mins != null ? String(mins) : num, unit: 'min' };
}
const joinDuration = (n, unit) => (String(n || '').trim() ? `${String(n).trim()} ${unit}` : '');
/* how it reads in the schedule: "40 min", "21 points", "10 overs" */
const durationText = (d) => {
  const { n, unit } = splitDuration(d);
  if (!n) return String(d || '');
  return unit === 'min' ? `${n} min` : `${n} ${unit}`;
};

/* ── Days of the event: Day 1 is the Galore event's start date ── */
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayNumber = (start, iso) => {
  if (!start || !iso) return 0;
  const n = Math.round((new Date(`${iso}T00:00:00`) - new Date(`${start}T00:00:00`)) / 86400000) + 1;
  return n >= 1 ? n : 0;
};
/* a date picker by event day ("Day 2 · 4 Nov 2026"), with any other date still possible */
function DayField({ start, value, onChange, label = 'Day' }) {
  const [other, setOther] = useState(false);
  if (!start || other) {
    return (
      <div className={s.field}>
        <label>{label}{start && <button type="button" className={s.linkBtn} style={{ marginLeft: 8, fontSize: '.72rem' }} onClick={() => setOther(false)}>pick a day</button>}</label>
        <input type="date" className={s.select} value={value} onChange={e => onChange(e.target.value)} />
      </div>
    );
  }
  const days = Array.from({ length: 10 }, (_, i) => addDays(start, i));
  const known = !value || days.includes(value);
  return (
    <div className={s.field}>
      <label>{label}</label>
      <select className={s.select} value={value} onChange={e => (e.target.value === '__other' ? setOther(true) : onChange(e.target.value))}>
        <option value="">Choose the day…</option>
        {days.map((d, i) => <option key={d} value={d}>Day {i + 1} · {shortDay(d)}</option>)}
        {!known && <option value={value}>{shortDay(value)}</option>}
        <option value="__other">Another date…</option>
      </select>
    </div>
  );
}
/* duration: a number and what it counts — time, points or overs */
function DurationField({ value, onChange, fallbackUnit }) {
  const { n, unit } = splitDuration(value, fallbackUnit);
  return (
    <div className={s.field}>
      <label>Duration</label>
      <div className={s.durRow}>
        <input className={s.select} type="number" min="0" step="any" inputMode="decimal"
          placeholder={unit === 'min' ? 'e.g. 40' : unit === 'points' ? 'e.g. 21' : 'e.g. 10'}
          value={n} onChange={e => onChange(joinDuration(e.target.value, unit))} />
        <select className={s.select} value={unit} onChange={e => onChange(joinDuration(n, e.target.value))} aria-label="Measured in">
          {DUR_UNITS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
    </div>
  );
}

/* ── Everyone: the whole Galore schedule ──
   Category (Sports, Cultural, …) → each activity (per gender: "BASKETBALL · BOYS")
   with its own table, its own column headers, dates first and written once for
   the rows that share them:
     matches   Date | Match | Team | Reporting time | Duration | Venue
     sessions  Date | Stage | Reporting time | Duration | Venue
   Only what has a reporting time is listed; showHidden: the main coordinator is
   told how much is still waiting for one. mine: the viewer's activities, shaded,
   with an "only mine" filter. */
/* load: () => Promise<schedule> — default the Galore portal's; the admin passes its own */
/* asStudent: the student dashboard — exactly what students may see (nothing until
   it's declared), even for someone who is also a coordinator. The page follows
   changes live: declared / taken back, matches, sessions. */
export function ScheduleView({ eventId, mine = null, mineLabel = 'My activities only', showHidden = false, note = '', intro = true, load = null, asStudent = false }) {
  const [data,   setData]   = useState(null);
  const [error,  setError]  = useState('');
  const [actId,  setActId]  = useState('');
  const [onlyMine, setOnlyMine] = useState(false);

  const fetchIt = useCallback(() => {
    (load ? load() : galoreApi.get(`/events/${eventId}/schedule${asStudent ? '?view=student' : ''}`))
      .then(d => { setData(d); setError(''); }).catch(err => setError(err.message));
  }, [eventId, load, asStudent]);
  useEffect(() => { fetchIt(); }, [fetchIt]);
  useEffect(() => {
    let t = null;
    const later = () => { clearTimeout(t); t = setTimeout(fetchIt, 250); };
    const onChange = (p) => { if (!p?.eventId || String(p.eventId) === String(eventId)) later(); };
    const onVisible = () => { if (document.visibilityState === 'visible') later(); };
    const socket = getSocket();
    socket.on('galore:schedule:changed', onChange);
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimeout(t); socket.off('galore:schedule:changed', onChange); document.removeEventListener('visibilitychange', onVisible); };
  }, [eventId, fetchIt]);

  const { groups, hidden } = useMemo(() => {
    if (!data) return { groups: [], hidden: 0 };
    let hidden = 0;
    const keep = (id) => (!actId || id === actId) && (!onlyMine || !mine || mine.has(id));
    const byDate = (x, y) => (x.date || '9999').localeCompare(y.date || '9999') || toMin(x.reporting) - toMin(y.reporting);
    const byCat = new Map();
    for (const a of data.activities) {
      if (!keep(a.id)) continue;
      const fx = data.fixtures.filter(f => f.activityId === a.id);
      const ss = (data.sessions || []).filter(x => x.activityId === a.id);
      const matches = fx.filter(f => f.reportingTime).map(f => ({
        key: `f${f.id}`, kind: 'match', f, div: f.division === 'girls' ? 'girls' : 'boys',
        reporting: f.reportingTime, date: f.date || a.date, duration: f.duration || a.duration, venue: f.venue || a.venue,
      }));
      const sessions = ss.filter(x => x.reportingTime).map(x => ({
        key: `s${x.id}`, kind: 'session', label: x.label, div: x.division,
        reporting: x.reportingTime, date: x.date, duration: x.duration, venue: x.venue,
      }));
      hidden += (fx.length - matches.length) + (ss.length - sessions.length);
      /* set up earlier as the activity's own single day (before sessions) */
      const own = !matches.length && !sessions.length && a.reportingTime
        ? [{ key: `a${a.id}`, kind: 'session', label: '', div: '', reporting: a.reportingTime, date: a.date, duration: a.duration, venue: a.venue }]
        : [];
      const rows = [...matches, ...sessions, ...own];
      if (!rows.length) { hidden++; continue; }
      /* one block per gender when the activity is split (sessions for both: their own block) */
      const divs = a.genderSplit ? [['', ''], ['boys', 'Boys'], ['girls', 'Girls']] : [['*', '']];
      const blocks = divs.map(([d, label]) => ({
        label, rows: rows.filter(r => d === '*' || (r.div || '') === d).sort(byDate),
      })).filter(b => b.rows.length);
      const cat = a.categoryName || 'Other activities';
      if (!byCat.has(cat)) byCat.set(cat, { cat, order: a.categoryOrder ?? 999, acts: [] });
      byCat.get(cat).acts.push({ a, blocks, first: rows.map(r => r.date).filter(Boolean).sort()[0] || '9999' });
    }
    const groups = [...byCat.values()]
      .sort((x, y) => x.order - y.order || x.cat.localeCompare(y.cat))
      .map(g => ({ cat: g.cat, acts: g.acts.sort((x, y) => x.first.localeCompare(y.first) || x.a.title.localeCompare(y.a.title)) }));
    return { groups, hidden };
  }, [data, actId, onlyMine, mine]);

  if (error) return <div className={s.error}>{error}</div>;
  if (!data) return <div className={s.muted}>Loading the schedule…</div>;
  if (!data.activities.length && data.declared && !data.declared.schedule) return <Empty>The schedule is not declared yet.</Empty>;
  if (!data.activities.length) return <Empty>No activities yet — the schedule appears here once the main Galore coordinator adds them.</Empty>;

  const cats = [...new Set(data.activities.map(a => a.categoryName || 'Other activities'))];
  const tba = <span className={s.tba}>TBA</span>;

  return (
    <>
      {/* intro={false}: the page says this itself (the student's "You registered for …" line) */}
      {intro && note && <p className={s.muted} style={{ margin: '0 0 12px' }}>{note}</p>}
      <div className={s.schedFilters}>
        <select className={s.select} value={actId} onChange={e => setActId(e.target.value)} aria-label="Activity">
          <option value="">All activities</option>
          {cats.map(c => (
            <optgroup key={c} label={c}>
              {data.activities.filter(a => (a.categoryName || 'Other activities') === c).map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
            </optgroup>
          ))}
        </select>
        {mine && mine.size > 0 && (
          <label className={s.schedCheck}>
            <input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} /> {mineLabel}
          </label>
        )}
      </div>

      {showHidden && hidden > 0 && (
        <div className={`${s.notice} ${s.noticeWarn}`}>
          {hidden} {hidden === 1 ? 'activity, session or match is' : 'activities, sessions and matches are'} not shown to anyone yet because {hidden === 1 ? 'it has' : 'they have'} no
          reporting time. Add one under <strong>Dates, venues &amp; Fixtures</strong>.
        </div>
      )}
      {groups.length === 0 && <Empty>Nothing scheduled for this selection yet.</Empty>}

      {groups.map(g => (
        <section key={g.cat} className={s.catBlock}>
          <h3 className={s.catTitle}>{g.cat}</h3>
          {g.acts.flatMap(({ a, blocks }) => blocks.map(b => (
            <ScheduleBlock key={`${a.id}-${b.label}`} a={a} label={b.label} rows={b.rows} start={data.eventStart}
              mineHere={!!mine?.has(a.id)} tba={tba} />
          )))}
        </section>
      ))}
    </>
  );
}

/* one activity (one gender): its own heading, headers and rows, dates first */
function ScheduleBlock({ a, label, rows, start, mineHere, tba }) {
  const hasMatches = rows.some(r => r.kind === 'match');
  const head = hasMatches
    ? ['Date', 'Match', 'Team', 'Reporting time', 'Duration', 'Venue']
    : ['Date', 'Stage', 'Reporting time', 'Duration', 'Venue'];
  /* each date written once for the rows that share it (rows are in date order) */
  const daySpan = rows.map((r, i) => {
    if (i > 0 && (rows[i - 1].date || '') === (r.date || '')) return 0;
    let n = 1;
    while (i + n < rows.length && (rows[i + n].date || '') === (r.date || '')) n++;
    return n;
  });
  let matchNo = 0;
  return (
    <div className={`${s.schedBlock} ${mineHere ? s.schedMine : ''}`}>
      <div className={s.schedBlockTitle}>
        {a.title}{label && <span className={s.schedBlockDiv}>{label}</span>}
      </div>
      <FitWidth minWidth={hasMatches ? 820 : 700}><div className={s.tableWrap}>
        <table className={`${s.table} ${s.schedTable}`}>
          <thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const no = r.kind === 'match' ? ++matchNo : 0;
              const dn = dayNumber(start, r.date);
              return (
                <tr key={r.key}>
                  {daySpan[i] > 0 && (
                    <td rowSpan={daySpan[i]} className={`${s.nowrap} ${s.schedDay}`}>
                      {r.date ? <>{dn > 0 && <div className={s.schedDayNo}>Day {dn}</div>}{shortDay(r.date)}</> : tba}
                    </td>
                  )}
                  {r.kind === 'match' ? (
                    <>
                      <td className={s.nowrap}>
                        <strong>Match {no}</strong> <span className={s.muted}>(M{no})</span>
                        {r.f.round && <div className={s.slotSub}>{r.f.round}</div>}
                      </td>
                      <td>
                        <strong>{r.f.teamA}</strong><span className={s.vs}>VS</span><strong>{r.f.teamB}</strong>
                        {resultOf(r.f) && <span className={s.slotResult}>{resultOf(r.f)}</span>}
                      </td>
                    </>
                  ) : hasMatches ? (
                    <><td><strong>{r.label || '—'}</strong></td><td>—</td></>
                  ) : (
                    <td><strong>{r.label || (a.isTeam ? 'Team event' : 'Individual event')}</strong></td>
                  )}
                  <td className={`${s.nowrap} ${s.reportCell}`}>{fmtTime(r.reporting)}</td>
                  <td className={s.nowrap}>{r.duration ? durationText(r.duration) : tba}</td>
                  <td>{r.venue || tba}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div></FitWidth>
    </div>
  );
}

/* ── Main coordinator: "Dates, venues & Fixtures" — pick an activity, set its
   own day / times / duration / venue, and (for team, duo or individual
   selections) which entry plays which, each match on its own day and time ── */
/* initialActId: open on this activity */
export function FixtureMaker({ eventId, flash, initialActId = '' }) {
  const [data,  setData]  = useState(null);  // { activities, fixtures, eventStart }
  const [teams, setTeams] = useState(null);  // { [activityId]: team[] }
  const [error, setError] = useState('');
  const [actId, setActId] = useState(initialActId);

  useEffect(() => {
    Promise.all([galoreApi.get(`/events/${eventId}/schedule`), galoreApi.get(`/head/events/${eventId}/teams`)])
      .then(([sched, t]) => { setData(sched); setTeams(t.teams || {}); })
      .catch(err => setError(err.message));
  }, [eventId]);

  if (error && !data) return <div className={s.error}>{error}</div>;
  if (!data || !teams) return <div className={s.muted}>Loading activities and teams…</div>;
  if (!data.activities.length) return <Empty>No activities yet — add them on Manage event → Galore form.</Empty>;

  /* activities in the order of their day (Day 1 first), then by name */
  const ordered = data.activities.slice().sort((x, y) => (x.date || '9999').localeCompare(y.date || '9999') || x.title.localeCompare(y.title));
  const act = ordered.find(a => a.id === actId) || ordered[0];
  const actTeams = teams[act.id] || [];
  const actFixtures = data.fixtures.filter(f => f.activityId === act.id);
  const actSessions = (data.sessions || []).filter(x => x.activityId === act.id);
  const countOf = (id) => data.fixtures.filter(f => f.activityId === id).length;
  const put = (f) => setData(d => ({ ...d, fixtures: d.fixtures.some(x => x.id === f.id) ? d.fixtures.map(x => (x.id === f.id ? f : x)) : [...d.fixtures, f] }));
  const drop = (id) => setData(d => ({ ...d, fixtures: d.fixtures.filter(x => x.id !== id) }));
  const scheduled = new Set(actFixtures.flatMap(f => [`${f.division}|${f.teamA}`, `${f.division}|${f.teamB}`]));
  const waiting = actTeams.filter(t => !scheduled.has(`${t.division}|${t.name}`));
  const dayOf = (iso) => { const n = dayNumber(data.eventStart, iso); return iso ? `${n > 0 ? `Day ${n} · ` : ''}${shortDay(iso)}` : 'not set'; };

  return (
    <>
      <div className={s.fixHead}>
        <p className={s.muted} style={{ margin: 0 }}>
          Pick an activity and add its matches — each with its day, reporting time and venue. Individual activities (singing, chess…)
          get sessions instead (Elimination, Final, Round 1…). Anything appears on everyone’s Schedule once it has a reporting time.
        </p>
        <DeclareButton eventId={eventId} flash={flash} />
      </div>
      <div className={s.schedFilters}>
        <select className={s.select} style={{ flex: '1 1 260px' }} value={act.id} onChange={e => setActId(e.target.value)} aria-label="Activity">
          {ordered.map(a => {
            const m = countOf(a.id), n = (data.sessions || []).filter(x => x.activityId === a.id).length;
            return <option key={a.id} value={a.id}>{a.title}{a.categoryName ? ` (${a.categoryName})` : ''}{n ? ` · ${n} session${n === 1 ? '' : 's'}` : ''}{m ? ` · ${m} match${m === 1 ? '' : 'es'}` : ''}</option>;
          })}
        </select>
      </div>

      {/* individual activities (singing, chess, rangoli…): their sessions, each on its own day.
          Team and duo activities are scheduled by their matches only. */}
      {!act.isTeam && (
        <>
          <div className={s.sectionLabel}>{act.title}: sessions ({actSessions.length}){act.clubName ? ` · run by ${act.clubName}` : ''}</div>
          <Sessions key={act.id} act={act} list={actSessions} start={data.eventStart} eventId={eventId} flash={flash}
            onChange={(fn) => setData(d => ({ ...d, sessions: fn(d.sessions || []) }))} />
        </>
      )}

      {/* its matches */}
      <div className={s.sectionLabel}>Matches — {act.title} ({actFixtures.length})</div>
      {actTeams.length < 2 ? (
        <Empty>
          {actTeams.length === 0 ? 'Nothing selected yet' : 'Only one selected so far'} — once the teams, duos or individuals are selected
          (Manage event → Activities), they can be put into matches here.
        </Empty>
      ) : (
        <>
          <MatchForm key={act.id} act={act} teams={actTeams} start={data.eventStart} submitLabel="Add match"
            onSubmit={async (body) => {
              const r = await galoreApi.post(`/head/events/${eventId}/fixtures`, { ...body, activityId: act.id });
              put(r.fixture);
              flash?.(`Match added: ${r.fixture.teamA} vs ${r.fixture.teamB}.`);
            }} />
          {waiting.length > 0 && (
            <>
              <div className={s.muted}>Without a match yet ({waiting.length}):</div>
              <div className={s.chips}>{waiting.map(t => <span key={t.id} className={s.chip}>{t.name}{divLabel(act, t.division) ? ` · ${divLabel(act, t.division)}` : ''}</span>)}</div>
            </>
          )}
        </>
      )}

      {actFixtures.length > 0 && (
        <Table head={['#', 'Match', 'Round', 'Day', 'Reporting', 'Duration', 'Venue', 'Result', '']} minWidth={940}>
          {/* day by day: a heading row for each date, its matches in time order */}
          {(() => {
            const sorted = actFixtures.slice().sort((x, y) => (x.date || '9999').localeCompare(y.date || '9999') || toMin(x.time) - toMin(y.time));
            const days = [...new Set(sorted.map(f => f.date || ''))];
            let n = 0;
            return days.flatMap(day => {
              const list = sorted.filter(f => (f.date || '') === day);
              return [
                <tr key={`day-${day}`} className={s.dayRow}>
                  <td colSpan={9}>{day ? dayOf(day) : 'Day not set yet'} · {list.length} match{list.length === 1 ? '' : 'es'}</td>
                </tr>,
                ...list.map(f => <FixtureRow key={f.id} n={++n} f={f} act={act} teams={actTeams} start={data.eventStart} eventId={eventId} onSaved={put} onRemoved={drop} flash={flash} />),
              ];
            });
          })()}
        </Table>
      )}
    </>
  );
}

/* an activity's sessions — its stages / rounds (Elimination, Final, Round 1…),
   each on its own day with reporting time, duration and venue; Boys / Girls
   when the activity is split */
function Sessions({ act, list, start, eventId, onChange, flash }) {
  const [editing, setEditing] = useState(null); // session id being changed
  const [busy, setBusy] = useState('');
  const sorted = list.slice().sort((x, y) => (x.date || '9999').localeCompare(y.date || '9999') || toMin(x.reportingTime) - toMin(y.reportingTime));
  const remove = async (x) => {
    if (!window.confirm(`Remove ${x.label || 'this session'}${x.date ? ` on ${shortDay(x.date)}` : ''}?`)) return;
    setBusy(x.id);
    try { await galoreApi.del(`/head/events/${eventId}/sessions/${x.id}`); onChange(l => l.filter(y => y.id !== x.id)); flash?.('Session removed.'); }
    catch (ex) { window.alert(ex.message); }
    finally { setBusy(''); }
  };
  const genderOf = (d) => (d === 'girls' ? 'Girls' : d === 'boys' ? 'Boys' : act.genderSplit ? 'Boys & girls' : '—');
  return (
    <>
      <SessionForm key={`new-${act.id}`} act={act} start={start} submitLabel="Add session"
        onSubmit={async (body) => {
          const r = await galoreApi.post(`/head/events/${eventId}/sessions`, { ...body, activityId: act.id });
          onChange(l => [...l, r.session]);
          flash?.(`${act.title}: session added.`);
        }} />
      {sorted.length > 0 && (
        <Table head={['Day', 'Stage', ...(act.genderSplit ? ['Gender'] : []), 'Reporting', 'Duration', 'Venue', '']} minWidth={760}>
          {sorted.map(x => (editing === x.id ? (
            <tr key={x.id}><td colSpan={act.genderSplit ? 7 : 6} style={{ padding: 10 }}>
              <SessionForm act={act} start={start} initial={x} submitLabel="Save session" onCancel={() => setEditing(null)}
                onSubmit={async (body) => {
                  const r = await galoreApi.patch(`/head/events/${eventId}/sessions/${x.id}`, body);
                  onChange(l => l.map(y => (y.id === x.id ? r.session : y)));
                  setEditing(null); flash?.('Session updated.');
                }} />
            </td></tr>
          ) : (
            <tr key={x.id}>
              <td className={s.nowrap}>{x.date ? <>{dayNumber(start, x.date) > 0 && <strong>Day {dayNumber(start, x.date)} </strong>}{shortDay(x.date)}</> : '—'}</td>
              <td><strong>{x.label || '—'}</strong></td>
              {act.genderSplit && <td>{genderOf(x.division)}</td>}
              <td className={s.nowrap}>{fmtTime(x.reportingTime)}</td>
              <td className={s.nowrap}>{x.duration ? durationText(x.duration) : '—'}</td>
              <td>{x.venue || '—'}</td>
              <td>
                <span className={s.rowActions}>
                  <button type="button" className={s.smallBtn} onClick={() => setEditing(x.id)}>Edit</button>
                  <button type="button" className={s.smallBtn} disabled={busy === x.id} onClick={() => remove(x)}>{busy === x.id ? '…' : 'Remove'}</button>
                </span>
              </td>
            </tr>
          )))}
        </Table>
      )}
    </>
  );
}

function SessionForm({ act, start, initial, submitLabel, onSubmit, onCancel }) {
  const hhmm = (t) => (/^\d{2}:\d{2}$/.test(String(t || '')) ? t : '');
  const [v, setV] = useState(() => ({
    label: initial?.label || '', division: initial?.division || '', date: initial?.date || act.date || '',
    reportingTime: hhmm(initial?.reportingTime), duration: initial?.duration || act.duration || '', venue: initial?.venue || act.venue || '',
  }));
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const setVal = (k) => (val) => setV(p => ({ ...p, [k]: val }));
  const submit = async (e) => {
    e.preventDefault();
    if (!v.reportingTime) return setErr('Add the reporting time: a session only appears on the schedule once it has one.');
    setBusy(true); setErr('');
    try {
      await onSubmit(v);
      if (!initial) setV(p => ({ ...p, label: '', reportingTime: '' })); // keep day / duration / venue for the next one
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };
  return (
    <form className={s.matchForm} onSubmit={submit}>
      <div className={s.field}><label>Stage</label>
        <input className={s.select} maxLength={100} placeholder="e.g. Elimination, Final, Round 1" value={v.label} onChange={e => setVal('label')(e.target.value)} />
      </div>
      {act.genderSplit && (
        <div className={s.field}><label>Gender</label>
          <select className={s.select} value={v.division} onChange={e => setVal('division')(e.target.value)}>
            <option value="">Boys &amp; girls</option>
            <option value="boys">Boys</option>
            <option value="girls">Girls</option>
          </select>
        </div>
      )}
      <DayField start={start} value={v.date} onChange={setVal('date')} />
      <div className={s.field}><label>Reporting time *</label><input type="time" className={s.select} value={v.reportingTime} onChange={e => setVal('reportingTime')(e.target.value)} /></div>
      <DurationField value={v.duration} onChange={setVal('duration')} fallbackUnit={unitFor(act.title)} />
      <div className={s.field}><label>Venue</label><input className={s.select} maxLength={255} placeholder="e.g. SOE seminar hall" value={v.venue} onChange={e => setVal('venue')(e.target.value)} /></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <button type="submit" className={s.primaryBtn} disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" className={s.smallBtn} onClick={onCancel}>Cancel</button>}
      </div>
      {err && <div className={s.error} style={{ gridColumn: '1 / -1', margin: 0 }}>{err}</div>}
    </form>
  );
}

/* Team A / Team B dropdowns (Team B only offers ones of Team A's division),
   day, times, duration (time / points / overs), venue, round. */
function MatchForm({ act, teams, start, initial, submitLabel, onSubmit, onCancel, lockTeams = false }) {
  const [v, setV] = useState(() => initial || { teamAId: '', teamBId: '', date: act.date || '', reportingTime: '', time: '', duration: act.duration || '', venue: act.venue || '', round: '' });
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const set = (k) => (e) => setV(p => ({ ...p, [k]: e.target.value, ...(k === 'teamAId' ? { teamBId: '' } : {}) }));
  const setVal = (k) => (val) => setV(p => ({ ...p, [k]: val }));
  const teamA = teams.find(t => t.id === v.teamAId);
  const divisions = [...new Set(teams.map(t => t.division))];
  const options = (list) => (act.genderSplit && divisions.length > 1
    ? divisions.map(d => (
      <optgroup key={d} label={divLabel(act, d)}>
        {list.filter(t => t.division === d).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </optgroup>))
    : list.map(t => <option key={t.id} value={t.id}>{t.name}</option>));
  const submit = async (e) => {
    e.preventDefault();
    if (!v.teamAId || !v.teamBId) return setErr('Choose both sides.');
    if (!v.date) return setErr('Choose the day of the match.');
    if (!v.reportingTime) return setErr('Add the reporting time: the match only appears on the schedule once it has one.');
    if (!String(v.venue || '').trim()) return setErr('Add the venue.');
    setBusy(true); setErr('');
    try {
      await onSubmit(v);
      if (!initial) setV(p => ({ ...p, teamAId: '', teamBId: '', round: '' })); // keep day / time / venue for the next match
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };
  return (
    <form className={s.matchForm} onSubmit={submit}>
      <div className={s.field}>
        <label>Team A</label>
        <select className={s.select} value={v.teamAId} onChange={set('teamAId')} disabled={lockTeams}>
          <option value="">Choose…</option>
          {options(teams)}
        </select>
      </div>
      <div className={s.field}>
        <label>Team B</label>
        <select className={s.select} value={v.teamBId} onChange={set('teamBId')} disabled={lockTeams || !teamA}>
          <option value="">{teamA ? 'Choose the opponent…' : 'Pick Team A first'}</option>
          {teamA && options(teams.filter(t => t.id !== teamA.id && t.division === teamA.division))}
        </select>
      </div>
      <DayField start={start} value={v.date} onChange={setVal('date')} label="Day *" />
      <div className={s.field}><label>Reporting time *</label><input type="time" className={s.select} value={v.reportingTime} onChange={set('reportingTime')} required /></div>
      <DurationField value={v.duration} onChange={setVal('duration')} fallbackUnit={unitFor(act.title)} />
      <div className={s.field}><label>Venue *</label><input className={s.select} maxLength={255} placeholder="e.g. Main Ground" value={v.venue} onChange={set('venue')} required /></div>
      <div className={s.field}><label>Round (optional)</label><input className={s.select} maxLength={100} placeholder="e.g. Quarter-final" value={v.round} onChange={set('round')} /></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <button type="submit" className={s.primaryBtn} disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" className={s.smallBtn} onClick={onCancel}>Cancel</button>}
      </div>
      {lockTeams && <div className={s.muted} style={{ gridColumn: '1 / -1', fontSize: '.78rem' }}>This match has a score, so its sides stay as they are.</div>}
      {err && <div className={s.error} style={{ gridColumn: '1 / -1', margin: 0 }}>{err}</div>}
    </form>
  );
}

function FixtureRow({ n, f, act, teams, start, eventId, onSaved, onRemoved, flash }) {
  const [editing, setEditing] = useState(false);
  const [busy,    setBusy]    = useState(false);
  const idOf = (name) => teams.find(t => t.name === name && t.division === f.division)?.id || '';
  const started = f.scoreA != null || !!f.winner;

  if (editing) {
    return (
      <tr><td colSpan={9} style={{ padding: 10 }}>
        <MatchForm act={act} teams={teams} start={start} submitLabel="Save match" lockTeams={started}
          initial={{ teamAId: idOf(f.teamA), teamBId: idOf(f.teamB), date: f.date, reportingTime: /^\d{2}:\d{2}$/.test(f.reportingTime) ? f.reportingTime : '', time: /^\d{2}:\d{2}$/.test(f.time) ? f.time : '', duration: f.duration, venue: f.venue, round: f.round }}
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            const r = await galoreApi.patch(`/head/events/${eventId}/fixtures/${f.id}`, started ? { ...body, teamAId: '', teamBId: '' } : body);
            onSaved(r.fixture); setEditing(false); flash?.('Match updated.');
          }} />
      </td></tr>
    );
  }
  const remove = async () => {
    if (!window.confirm(`Remove ${f.teamA} vs ${f.teamB}?${started ? ' It already has a score — that will be removed too.' : ''}`)) return;
    setBusy(true);
    try { await galoreApi.del(`/head/events/${eventId}/fixtures/${f.id}`); onRemoved(f.id); flash?.('Match removed.'); }
    catch (ex) { window.alert(ex.message); }
    finally { setBusy(false); }
  };
  const tba = <span className={s.tba}>To be announced</span>;
  const dn = dayNumber(start, f.date);
  return (
    <tr>
      <td>{n}</td>
      <td><strong>{f.teamA}</strong><span className={s.vs}>VS</span><strong>{f.teamB}</strong>{divLabel(act, f.division) && <div className={s.muted}>{divLabel(act, f.division)}</div>}</td>
      <td>{f.round || '—'}</td>
      <td className={s.nowrap}>{f.date ? <>{dn > 0 && <strong>Day {dn} </strong>}{shortDay(f.date)}</> : tba}</td>
      <td>{f.reportingTime ? fmtTime(f.reportingTime) : <span className={`${s.flag} ${s.flagLow}`}>Not set: hidden</span>}</td>
      <td className={s.nowrap}>{f.duration ? durationText(f.duration) : tba}</td>
      <td>{f.venue || tba}</td>
      <td>{resultOf(f) || <span className={s.muted}>—</span>}</td>
      <td>
        <span className={s.rowActions}>
          <button type="button" className={s.smallBtn} onClick={() => setEditing(true)}>Edit</button>
          <button type="button" className={s.smallBtn} disabled={busy} onClick={remove}>{busy ? '…' : 'Remove'}</button>
        </span>
      </td>
    </tr>
  );
}

/* ── Main coordinator: one button that declares the schedule and its fixtures
   to students (or takes them back). Until then students see "not declared yet";
   coordinators always see everything. ── */
/* load / save: () => Promise — default the Galore portal's (main coordinator);
   the admin passes its own. Once declared it reads "Already declared"; clicking
   it then offers to take the declaration back. */
export function DeclareButton({ eventId, flash, load = null, save = null }) {
  const [flags, setFlags] = useState(null); // { schedule, fixtures }
  const [busy,  setBusy]  = useState(false);
  useEffect(() => {
    (load ? load() : galoreApi.get(`/events/${eventId}/schedule`))
      .then(d => setFlags(d.declared || { schedule: false, fixtures: false })).catch(() => {});
  }, [eventId, load]);
  if (!flags) return null;
  const declared = flags.schedule && flags.fixtures;
  const toggle = async () => {
    if (declared && !window.confirm('The schedule is already declared. Take it back? Students will no longer see the schedule or fixtures.')) return;
    setBusy(true);
    try {
      const body = { schedule: !declared, fixtures: !declared };
      const r = await (save ? save(body) : galoreApi.patch(`/head/events/${eventId}/declare`, body));
      setFlags(r);
      flash?.(r.schedule ? 'Schedule and fixtures declared: students can see them now, and have been emailed.' : 'Schedule and fixtures taken back: hidden from students.');
    } catch (ex) { flash?.(ex.message); }
    finally { setBusy(false); }
  };
  return (
    <button type="button" className={declared ? s.declaredBtn : s.primaryBtn} style={declared ? undefined : { width: 'auto' }}
      disabled={busy} onClick={toggle}
      title={declared ? 'Students can see the schedule and fixtures. Click to take it back.' : 'Students can’t see the schedule or fixtures yet'}>
      {busy ? 'Saving…' : declared ? '✓ Already declared' : 'Declare schedule & fixtures'}
    </button>
  );
}
