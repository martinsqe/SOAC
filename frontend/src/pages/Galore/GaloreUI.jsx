import { useState } from 'react';
import s from './Galore.module.css';

/* Building blocks shared by every Galore dashboard (student, department
   coordinator, activity coordinator, overall Galore coordinator), so they all
   look and behave the same. No icons — words only. */

/* Activity dates, times and venues are set later — until then "To be announced" */
export const TBA = () => <span className={s.tba}>To be announced</span>;
export const InfoRow = ({ label, children }) => (
  <div className={s.infoRow}><span className={s.infoLabel}>{label}</span><span className={s.infoValue}>{children || '—'}</span></div>
);
export const Person = ({ p }) => (p?.email ? <>{p.name} · <a href={`mailto:${p.email}`}>{p.email}</a></> : null);
export const Empty = ({ children }) => <div className={s.empty}>{children}</div>;
export const Notice = ({ tone = 'info', children }) => (
  <div className={`${s.notice} ${tone === 'warn' ? s.noticeWarn : tone === 'ok' ? s.noticeOk : s.noticeInfo}`}>{children}</div>
);
export const Label = ({ children }) => <div className={s.sectionLabel}>{children}</div>;

/* Every event card starts the same way: role, title, the festival's own dates */
export function EventHeader({ role, event, title, sub, actions, description }) {
  const t = title ?? event.title;
  return (
    <>
      <div className={s.eventHead}>
        <div>
          <div className={s.roleTag}>{role}</div>
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
  <div className={s.stats}>
    {items.map(([value, label]) => (
      <div key={label} className={s.stat}><div className={s.statValue}>{value}</div><div className={s.statLabel}>{label}</div></div>
    ))}
  </div>
);

export const Table = ({ head, children, minWidth }) => (
  <div className={s.tableWrap}>
    <table className={s.table} style={minWidth ? { minWidth } : undefined}>
      <thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);

export const FileLink = ({ file, label }) => (file ? <a className={s.smallBtn} href={file.url} target="_blank" rel="noreferrer">{label || file.name}</a> : null);

/* ── Fixtures and teams, the same list everywhere ── */
export function FixtureList({ fixtures, team }) {
  if (fixtures === null) return <span className={s.muted}>Loading…</span>;
  if (!fixtures.length) return <span className={s.muted}>{team ? `No matches announced for ${team} yet.` : 'No fixtures announced yet.'}</span>;
  return (
    <>
      {team && <div className={s.muted} style={{ marginBottom: 4 }}>Matches for your team, {team}:</div>}
      {fixtures.map((f, i) => (
        <div key={i} className={s.fixture}>
          <span><strong>{f.teamA}</strong> vs <strong>{f.teamB}</strong>{f.round ? <span className={s.muted}> · {f.round}</span> : null}{f.division && f.division !== 'open' ? <span className={s.muted}> · {f.division}</span> : null}</span>
          <span className={s.muted}>
            {f.scoreA != null && f.scoreB != null ? `${f.scoreA}–${f.scoreB}${f.winner ? ` · ${f.winner} won` : ''}`
              : (f.date || f.time) ? [f.date, f.time, f.venue].filter(Boolean).join(' · ')
              : <><TBA />{f.venue ? ` · ${f.venue}` : ''}</>}
          </span>
        </div>
      ))}
    </>
  );
}

export function TeamList({ teams, clubName }) {
  if (teams === null) return <span className={s.muted}>Loading…</span>;
  if (!teams.length) return <span className={s.muted}>No teams yet — {clubName || 'the club running it'} makes them from the registrations.</span>;
  return teams.map(t => (
    <div key={t.id} className={s.fixture} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
      <span><strong>{t.name}</strong>{t.division && t.division !== 'open' ? <span className={s.muted}> · {t.division}</span> : null}{t.dept ? <span className={s.muted}> · {t.dept}</span> : null}</span>
      <span className={s.muted}>{t.members.length ? t.members.map(m => m.name).join(', ') : 'No members yet'}</span>
    </div>
  ));
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
        <div className={`${s.result} ${s.resultNo}`}>Not registered: {checked} isn't registered for {scope}. Don't let them play until this is sorted out.</div>
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
