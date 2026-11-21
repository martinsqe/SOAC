import { useState } from 'react';
import FitWidth from '../../components/FitWidth/FitWidth';
import { downloadGaloreCsv } from '../../utils/galoreCsv';
import GaloreTeamManager from './GaloreTeamManager';
import s from './Galore.module.css';

/* Building blocks shared by every Galore dashboard (student, department
   coordinator, activity coordinator, overall Galore coordinator), so they all
   look and behave the same. No icons — words only. */

/* Activity dates, times and venues are set later — until then "To be announced" */
export const TBA = () => <span className={s.tba}>To be announced</span>;
export const InfoRow = ({ label, children }) => (
  <div className={s.infoRow}><span className={s.infoLabel}>{label}</span><span className={s.infoValue}>{children || '—'}</span></div>
);
export const Empty = ({ children }) => <div className={s.empty}>{children}</div>;
export const Notice = ({ tone = 'info', children }) => (
  <div className={`${s.notice} ${tone === 'warn' ? s.noticeWarn : tone === 'ok' ? s.noticeOk : s.noticeInfo}`}>{children}</div>
);
export const Label = ({ children }) => <div className={s.sectionLabel}>{children}</div>;

/* Every event card starts the same way: title, the festival's own dates.
   No role badge — the role switch above already says who you are. */
export function EventHeader({ event, title, sub, actions, description }) {
  const t = title ?? event.title;
  return (
    <>
      <div className={s.eventHead}>
        <div>
          <h2 className={s.cardTitle}>{t}</h2>
          <div className={s.muted}>
            <strong style={{ color: '#374151' }}>Galore:</strong> {[event.date, event.time, event.venue].filter(Boolean).join(' · ') || 'To be announced'}
          </div>
          {sub && <div className={s.muted}>{sub}</div>}
        </div>
        {actions}
      </div>
      {description && <p className={s.eventDesc}>{description}</p>}
    </>
  );
}

export const Stats = ({ items }) => (
  <div className={s.stats} style={{ '--stat-cols': items.length || 1 }}>
    {items.map(([value, label]) => (
      <div key={label} className={s.stat}><div className={s.statValue}>{value}</div><div className={s.statLabel}>{label}</div></div>
    ))}
  </div>
);

/* minWidth: the width the table is laid out at; narrower screens get the same
   table shrunk to fit (FitWidth), never a sideways scroll */
export const Table = ({ head, children, minWidth = 560 }) => (
  <FitWidth minWidth={minWidth}>
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  </FitWidth>
);

export const FileLink = ({ file, label }) => (file ? <a className={s.smallBtn} href={file.url} target="_blank" rel="noreferrer">{label || file.name}</a> : null);


/* The teams the club's student coordinators formed from the registrations —
   one card each: name, division / department, how many players and who.
   splitDivisions: the activity runs Boys and Girls separately (else "Open"). */
/* the teams (read-only), the same rows as the team editor: ▸ name … n members;
   open one for its players */
export function TeamList({ teams, splitDivisions = false }) {
  if (teams === null) return <span className={s.muted}>Loading…</span>;
  if (!teams.length) return <Empty>Not declared yet.</Empty>;
  return (
    <div className={s.teamRows}>
      {teams.map(t => <TeamRowView key={t.id} t={t} splitDivisions={splitDivisions} />)}
    </div>
  );
}

function TeamRowView({ t, splitDivisions }) {
  const [open, setOpen] = useState(false);
  const meta = [splitDivisions ? (t.division === 'girls' ? 'Girls' : 'Boys') : '', t.dept].filter(Boolean).join(' · ');
  const n = t.members.length;
  return (
    <div className={`${s.teamRow} ${open ? s.teamRowOpen : ''}`}>
      <div className={s.teamRowHead} role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}>
        <span className={s.teamRowArrow} aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className={s.teamRowName}>{t.name}{meta && <span className={s.teamRowDept}>{meta}</span>}</span>
        <span className={s.teamRowPill}>{n} member{n === 1 ? '' : 's'}</span>
      </div>
      {open && (
        <div className={s.teamRowBody}>
          {n
            ? <ol className={s.teamMembers}>{t.members.map((m, i) => <li key={i}>{m.name}{m.enrollmentNo ? <span className={s.muted}> · {m.enrollmentNo}</span> : null}</li>)}</ol>
            : <div className={s.muted}>No players added yet</div>}
        </div>
      )}
    </div>
  );
}

/* ── Player validation: is this enrollment / admission number registered here? ── */
export function VerifyParticipant({ registrations, teams = {}, scope }) {
  const [q, setQ] = useState('');
  const [checked, setChecked] = useState('');
  const key = (v) => String(v || '').replace(/\s+/g, '').toUpperCase();
  const run = (e) => { e.preventDefault(); setChecked(key(q)); };
  const hits = checked ? (registrations || []).filter(r => (r.numbers?.length ? r.numbers : [r.enrollmentNo]).some(n => key(n) === checked)) : [];
  const teamOf = (r) => (teams[r.eventId] || []).find(t => t.members.some(m => (m.enrollmentNo && (r.numbers || [r.enrollmentNo]).some(n => key(n) === key(m.enrollmentNo))) || m.name === r.name));
  return (
    <>
      <p className={s.muted} style={{ margin: '0 0 12px' }}>
        Check a participant before they play: enter the enrollment or admission number from their ID card. Only students registered for {scope} are found.
      </p>
      <form className={s.verifyRow} onSubmit={run}>
        <input className={s.select} style={{ flex: '1 1 240px' }} value={q} onChange={e => setQ(e.target.value)}
          placeholder="Enrollment or admission number" autoComplete="off" />
        <button type="submit" className={s.primaryBtn} disabled={!q.trim()}>Check</button>
      </form>
      {registrations === null && <span className={s.muted}>Loading…</span>}
      {checked && registrations && (hits.length === 0 ? (
        <div className={`${s.result} ${s.resultNo}`}>Not registered: {checked} isn't registered for {scope}.</div>
      ) : (
        <div className={`${s.result} ${s.resultYes}`}>
          <p className={s.resultTitle}>Registered — {hits[0].name}</p>
          <InfoRow label="Number">{hits[0].enrollmentNo}</InfoRow>
          <InfoRow label="Department">{hits[0].dept}</InfoRow>
          <InfoRow label="Course">{hits[0].course}</InfoRow>
          <InfoRow label="Gender">{hits[0].gender === 'F' ? 'Female' : hits[0].gender === 'M' ? 'Male' : ''}</InfoRow>
          {hits.map(r => {
            const t = teamOf(r);
            return <InfoRow key={r.registrationId} label="Registered">{r.eventTitle}{t ? ` — team ${t.name}` : ''}</InfoRow>;
          })}
        </div>
      ))}
    </>
  );
}

/* ── One department's registrations, every activity in one table: the same
   columns all the way down, each activity's name a centred row under the
   headers with its students listed beneath it. order: activity id → position. ── */
/* teamsOf(activityId) → 'Teams' | 'Duos' | null (individual): the activity's row
   then gets that word with an arrow; onTeams(activityId) opens its team manager */
export function DeptRegistrationsTable({ rows, order = new Map(), teamsOf, onTeams }) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.eventId)) groups.set(r.eventId, { id: r.eventId, title: r.eventTitle, rows: [] });
    groups.get(r.eventId).rows.push(r);
  }
  const list = [...groups.values()].sort((x, y) =>
    (order.get(String(x.id)) ?? 1e9) - (order.get(String(y.id)) ?? 1e9) || String(x.title).localeCompare(String(y.title)));
  return (
    <FitWidth minWidth={820}>
      <div className={s.tableWrap}>
        <table className={`${s.table} ${s.deptRegTable}`}>
          <thead><tr><th>#</th><th>Name</th><th>Enrollment No.</th><th>Gender</th><th>Course</th><th>Mobile</th><th>Email</th></tr></thead>
          <tbody>
            {list.flatMap(g => {
              const word = teamsOf?.(String(g.id));
              return [
                <tr key={`g-${g.id}`} className={s.actGroup}>
                  <td colSpan={7}>
                    {g.title} <span>({g.rows.length})</span>
                    {word && onTeams && (
                      <button type="button" className={s.teamsToggle} onClick={() => onTeams(String(g.id), g.title)}>
                        {word}
                        <svg className={s.roleArrow} viewBox="0 0 12 12" aria-hidden="true">
                          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}
                  </td>
                </tr>,
                ...g.rows.map((r, i) => (
                  <tr key={r.registrationId}>
                    <td>{i + 1}</td><td><strong>{r.name || '—'}</strong></td><td>{r.enrollmentNo || '—'}</td>
                    <td>{r.gender || '—'}</td><td>{r.course || '—'}</td><td>{r.phone || '—'}</td>
                    <td>{r.email ? <a href={`mailto:${r.email}`} style={{ color: '#b91c1c' }}>{r.email}</a> : '—'}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
    </FitWidth>
  );
}


/* ── One department's registrations with search + filters: one row holding the
   search box, All / Girls / Boys, the activity picker, the count and Download,
   then the table (each activity centred under the headers). Used by the main
   coordinator's Departments, the department coordinator's Registrations and
   the activity coordinator's Departments. Give it key={deptName} so the
   activity filter resets when the department changes. ── */
/* actOptions: [[id, title]] for the activity picker (default: those in rows);
   allLabel: its "everything" option (default "All activities") */
/* extra: more buttons on the row, left of Download (e.g. Verify participant);
   teamsOf: see DeptRegistrationsTable. Opening an activity's Teams / Duos hides
   the registrations and shows only that activity's team manager (as on the
   admin's Manage Event), for this department: teamDept ('' = every department). */
export function DeptRegistrations({ deptName, rows, order, fileBase, emptyText, actOptions, allLabel = 'All activities', extra = null, teamsOf, teamDept = '' }) {
  const [teamsFor, setTeamsFor] = useState(null); // { id, title, word } while its teams are open
  const [q,      setQ]      = useState('');
  const [gender, setGender] = useState('all'); // all | girls | boys
  const [actF,   setActF]   = useState('');    // '' = all activities
  const lc = (v) => String(v || '').trim().toLowerCase();
  const needle = lc(q);
  const shown = rows.filter(r =>
    (gender === 'all' || (gender === 'girls' ? /^f/i.test(String(r.gender || '').trim()) : /^m/i.test(String(r.gender || '').trim())))
    && (!actF || String(r.eventId) === actF)
    && (!needle || [r.name, r.enrollmentNo, r.course, r.phone, r.email].some(v => lc(v).includes(needle))));
  const filtered = !!(needle || gender !== 'all' || actF);
  const actCount = new Set(shown.map(r => r.eventId)).size;
  /* the activities this department has registrations in, in table order */
  const acts = actOptions || [...new Map(rows.map(r => [String(r.eventId), r.eventTitle])).entries()]
    .sort(([a, x], [b, y]) => (order?.get(a) ?? 1e9) - (order?.get(b) ?? 1e9) || String(x).localeCompare(String(y)));

  if (teamsFor) {
    return (
      <>
        <div className={s.teamsBar}>
          <button type="button" className={s.backBtn} onClick={() => setTeamsFor(null)}>← Registrations</button>
          <div className={s.teamsBarTitle}>{teamsFor.word} · {teamsFor.title}{teamDept ? ` · ${teamDept}` : ''}</div>
          <span style={{ width: 120 }} aria-hidden="true" />
        </div>
        <GaloreTeamManager activityId={teamsFor.id} dept={teamDept} />
      </>
    );
  }

  return (
    <>
      <div className={s.deptTools}>
        <div className={s.deptToolsLeft}>
          <input className={s.select} type="search" value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search name, enrollment, course, mobile, email" aria-label="Search students" />
          <select className={s.select} value={gender} onChange={e => setGender(e.target.value)} aria-label="Gender">
            <option value="all">All</option>
            <option value="girls">Girls</option>
            <option value="boys">Boys</option>
          </select>
          <select className={s.select} value={actF} onChange={e => setActF(e.target.value)} aria-label="Activity">
            <option value="">{allLabel}</option>
            {acts.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
          </select>
        </div>
        <div className={s.deptToolsCount}>
          <strong>{deptName}</strong>: {shown.length}{filtered ? ` of ${rows.length}` : ''} registration{shown.length === 1 ? '' : 's'}
          {shown.length > 0 && <> in {actCount} activit{actCount === 1 ? 'y' : 'ies'}</>}
        </div>
        <div className={s.deptToolsRight}>
          {extra}
          <button className={s.smallBtn} disabled={!shown.length}
            onClick={() => downloadGaloreCsv(`${fileBase} ${deptName}${filtered ? ' filtered' : ''}`, shown)}>
            Download {deptName} (CSV)
          </button>
        </div>
      </div>
      {rows.length === 0 ? <Empty>{emptyText || `No registrations from ${deptName} yet.`}</Empty>
        : shown.length === 0 ? <Empty>No {deptName} registrations match the search and filters.</Empty>
        : <DeptRegistrationsTable rows={shown} order={order} teamsOf={teamsOf}
            onTeams={(id, title) => setTeamsFor({ id, title, word: teamsOf(id) })} />}
    </>
  );
}

/* ── An activity's teams, the same everywhere: under "Boys (n)" and "Girls (n)"
   when the activity is split by gender, otherwise one list ── */
export function TeamsByDivision({ teams, clubName, genderSplit }) {
  if (!genderSplit) return <TeamList teams={teams} clubName={clubName} />;
  return [['boys', 'Boys'], ['girls', 'Girls']].map(([k, label]) => {
    const list = teams.filter(t => (k === 'girls' ? t.division === 'girls' : t.division !== 'girls'));
    return (
      <div key={k} style={{ marginBottom: 18 }}>
        <div className={s.sectionLabel}>{label} ({list.length})</div>
        {list.length ? <TeamList teams={list} clubName={clubName} />
          : <Empty>Not declared yet.</Empty>}
      </div>
    );
  });
}
