import { useState } from 'react';
import { downloadGaloreCsv } from '../../utils/galoreCsv';
import s from './Galore.module.css';

/* Registered students table — search, activity / department filters and a CSV
   of whatever is shown. Used by activity coordinators / FAs and by the overall
   Galore coordinator. */
export default function GaloreRegistrations({ registrations, error, fileBase }) {
  const [activity, setActivity] = useState('');
  const [dept,     setDept]     = useState('');
  const [q,        setQ]        = useState('');

  if (error) return <div className={s.error}>{error}</div>;
  if (registrations === null) return <div className={s.muted}>Loading…</div>;

  const actOptions  = [...new Set(registrations.map(r => r.eventTitle))].sort();
  const deptOptions = [...new Set(registrations.map(r => r.dept).filter(Boolean))].sort();
  const term = q.trim().toLowerCase();
  const shown = registrations.filter(r =>
    (!activity || r.eventTitle === activity) && (!dept || r.dept === dept)
    && (!term || [r.name, r.enrollmentNo, r.email, r.phone].some(v => String(v || '').toLowerCase().includes(term))));

  return (
    <>
      <div className={s.muted} style={{ marginBottom: 8 }}>
        {shown.length}{shown.length !== registrations.length ? ` of ${registrations.length}` : ''} registration{registrations.length === 1 ? '' : 's'}
      </div>
      <div className={s.filters}>
        <input className={s.select} style={{ flex: '1 1 200px' }} placeholder="Search name, enrollment, email…" value={q} onChange={e => setQ(e.target.value)} />
        {actOptions.length > 1 && (
          <select className={s.select} value={activity} onChange={e => setActivity(e.target.value)}>
            <option value="">All activities</option>
            {actOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {deptOptions.length > 1 && (
          <select className={s.select} value={dept} onChange={e => setDept(e.target.value)}>
            <option value="">All departments</option>
            {deptOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <button className={s.smallBtn} disabled={!shown.length}
          onClick={() => downloadGaloreCsv(`${fileBase} ${activity || 'all activities'} ${dept}`.trim(), shown)}>
          Download CSV
        </button>
      </div>
      {shown.length === 0 ? <div className={s.empty}>No registrations yet.</div> : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>#</th><th>Name</th><th>Enrollment / Admission</th><th>Dept</th><th>Course</th><th>Activity</th><th>Gender</th><th>Mobile</th><th>Email</th></tr></thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.registrationId}>
                  <td>{i + 1}</td><td><strong>{r.name}</strong></td><td>{r.enrollmentNo || '—'}</td><td>{r.dept || '—'}</td>
                  <td>{r.course || '—'}</td><td>{r.eventTitle}</td><td>{r.gender || '—'}</td><td>{r.phone || '—'}</td><td>{r.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
