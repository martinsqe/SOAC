import { useState, useEffect, useCallback } from 'react';
import { galoreApi } from '../../utils/galoreApi';
import useTeamsLive from '../../realtime/useTeamsLive';
import FitWidth from '../../components/FitWidth/FitWidth';
import { Empty, TeamsByDivision } from './GaloreUI';
import { selectedLabel } from './galoreHelpers';
import s from './Galore.module.css';

/* Student → My activities: for only the activities this student registered
   for, everyone registered from every department (one table, each activity
   centred under the headers), and beside each activity its "Selected teams /
   duos / individuals ▾" — read-only. No other student's mobile or email. */
export default function GaloreStudentActivities({ eventId }) {
  const [data,   setData]   = useState(null);
  const [error,  setError]  = useState('');
  const [q,      setQ]      = useState('');
  const [gender, setGender] = useState('all');
  const [actF,   setActF]   = useState('');
  const [open,   setOpen]   = useState(null); // activity whose selection is showing

  const load = useCallback(() => {
    galoreApi.get(`/events/${eventId}/my-activities`).then(setData).catch(err => setError(err.message));
  }, [eventId]);
  useEffect(() => { load(); }, [load]);
  useTeamsLive(null, load); // a selection declared or changed: shown without reloading

  if (error) return <div className={s.error}>{error}</div>;
  if (!data) return <div className={s.muted}>Loading…</div>;
  if (!data.activities.length) return <Empty>You haven’t registered for any activities yet.</Empty>;

  if (open) {
    const word = selectedLabel(open.unit);
    const list = data.teams.filter(t => t.activityId === open.id);
    return (
      <>
        <div className={s.teamsBar}>
          <button type="button" className={s.backBtn} onClick={() => setOpen(null)}>← Registrations</button>
          <div className={s.teamsBarTitle}>{word} · {open.title}</div>
          <span style={{ width: 120 }} aria-hidden="true" />
        </div>
        {!open.declared ? <Empty>Not declared yet.</Empty>
          : open.unit === 'individual'
          ? <SelectedIndividuals list={list} genderSplit={open.genderSplit} />
          : <TeamsByDivision teams={list} clubName={open.clubName} genderSplit={open.genderSplit} />}
      </>
    );
  }

  const lc = (v) => String(v || '').trim().toLowerCase();
  const needle = lc(q);
  const shown = data.registrations.filter(r =>
    (gender === 'all' || (gender === 'girls' ? /^f/i.test(r.gender) : /^m/i.test(r.gender)))
    && (!actF || r.eventId === actF)
    && (!needle || [r.name, r.enrollmentNo, r.dept, r.course].some(v => lc(v).includes(needle))));
  const order = new Map(data.activities.map((a, i) => [a.id, i]));
  const groups = data.activities
    .map(a => ({ a, rows: shown.filter(r => r.eventId === a.id) }))
    .filter(g => g.rows.length)
    .sort((x, y) => order.get(x.a.id) - order.get(y.a.id));
  const filtered = !!(needle || gender !== 'all' || actF);

  return (
    <>
      <p className={s.muted} style={{ margin: '0 0 12px', textAlign: 'center' }}>
        Everyone registered for your activities, from every department.
      </p>
      <div className={s.deptTools}>
        <div className={s.deptToolsLeft}>
          <input className={s.select} type="search" value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search name, enrollment, department, course" aria-label="Search students" />
          <select className={s.select} value={gender} onChange={e => setGender(e.target.value)} aria-label="Gender">
            <option value="all">All</option>
            <option value="girls">Girls</option>
            <option value="boys">Boys</option>
          </select>
          <select className={s.select} value={actF} onChange={e => setActF(e.target.value)} aria-label="Activity">
            <option value="">My activities</option>
            {data.activities.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </div>
        <div className={s.deptToolsCount}>
          {shown.length}{filtered ? ` of ${data.registrations.length}` : ''} registration{shown.length === 1 ? '' : 's'}
        </div>
        <span />
      </div>

      {groups.length === 0 ? <Empty>No registrations match the search and filters.</Empty> : (
        <FitWidth minWidth={760}>
          <div className={s.tableWrap}>
            <table className={`${s.table} ${s.deptRegTable}`}>
              <thead><tr><th>#</th><th>Name</th><th>Enrollment No.</th><th>Department</th><th>Gender</th><th>Course</th></tr></thead>
              <tbody>
                {groups.flatMap(({ a, rows }) => [
                  <tr key={`g-${a.id}`} className={s.actGroup}>
                    <td colSpan={6}>
                      {a.title} <span>({rows.length})</span>
                      <button type="button" className={s.teamsToggle} onClick={() => setOpen(a)}>
                        {selectedLabel(a.unit)}
                        <svg className={s.roleArrow} viewBox="0 0 12 12" aria-hidden="true">
                          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </td>
                  </tr>,
                  ...rows.map((r, i) => (
                    <tr key={r.registrationId}>
                      <td>{i + 1}</td><td><strong>{r.name || '—'}</strong></td><td>{r.enrollmentNo || '—'}</td>
                      <td>{r.dept || '—'}</td><td>{r.gender || '—'}</td><td>{r.course || '—'}</td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        </FitWidth>
      )}
    </>
  );
}

/* individual activities: the selected students, Boys / Girls when split */
function SelectedIndividuals({ list, genderSplit }) {
  const divisions = genderSplit ? [['boys', 'Boys'], ['girls', 'Girls']] : [['all', '']];
  return divisions.map(([div, label]) => {
    const chosen = list.filter(t => !genderSplit || (div === 'girls' ? t.division === 'girls' : t.division !== 'girls'));
    return (
      <div key={div} style={{ marginBottom: 18 }}>
        <div className={s.sectionLabel}>Selected {label ? `${label.toLowerCase()} ` : ''}individuals ({chosen.length})</div>
        {chosen.length === 0 ? <Empty>Not declared yet.</Empty> : (
          <div className={s.pickList}>
            {chosen.map(t => {
              const m = t.members[0];
              return (
                <div key={t.id} className={s.pickRow}>
                  <span><strong>{m?.name || t.name}</strong>{m?.enrollmentNo ? <span className={s.muted}> · {m.enrollmentNo}</span> : null}</span>
                  <span className={s.muted}>{t.dept || ''}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  });
}
