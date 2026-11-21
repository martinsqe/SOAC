import { useState, useMemo } from 'react';
import { SotyDocumentView } from './SotyDocument';
import { docFromEntry, docFileName, semLabel } from '../../utils/sotyDoc';
import s from './GaloreSoty.module.css';

/* Student of the Year — every contestant's submitted file, for the admin and
   the main Galore coordinator, listed like the event reports. Download CSV has
   every detail. onDelete (admin only) removes an entry. */
const fmt = (n) => (n == null ? '—' : String(Number(n)));
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

const deptOf = (e) => (e.department || e.school || '').trim() || 'No department';
const genderOf = (e) => {
  const g = String(e.gender || '').trim().charAt(0).toUpperCase();
  return g === 'F' ? 'F' : g === 'M' ? 'M' : '';
};
const hay = (e) => [e.name, e.enrollmentNo, e.contactEmail, e.email, e.mobile, e.branch, deptOf(e)]
  .filter(Boolean).join(' ').toLowerCase();

export default function SotyContestants({ contest, entries, onDelete, actions }) {
  const [file, setFile] = useState(null); // the contestant whose submitted file is open
  /* search + filters; the list below is grouped by department, A → Z */
  const [q,      setQ]      = useState('');
  const [dept,   setDept]   = useState('');
  const [gender, setGender] = useState('');
  const [sem,    setSem]    = useState('');
  const all = useMemo(() => entries || [], [entries]);
  const depts = useMemo(() => [...new Set(all.map(deptOf))].sort((a, b) => a.localeCompare(b)), [all]);
  const sems  = useMemo(() => [...new Set(all.map(e => String(e.semester || '').trim()).filter(Boolean))]
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b)), [all]);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter(e => (!dept || deptOf(e) === dept)
      && (!gender || genderOf(e) === gender)
      && (!sem || String(e.semester || '').trim() === sem)
      && words.every(w => hay(e).includes(w)));
  }, [all, q, dept, gender, sem]);
  const groups = useMemo(() => {
    const m = new Map();
    for (const e of shown) { const d = deptOf(e); if (!m.has(d)) m.set(d, []); m.get(d).push(e); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([d, list]) => [d, [...list].sort((x, y) => String(x.name || '').localeCompare(String(y.name || '')))]);
  }, [shown]);
  const filtering = !!(q.trim() || dept || gender || sem);
  const clear = () => { setQ(''); setDept(''); setGender(''); setSem(''); };
  return (
    <>
      <div className={s.listHead}>
        <div>
          <h2 className={s.listTitle}>Submitted files{entries ? ` (${entries.length})` : ''}</h2>
          <p className={s.muted}>
            {contest.title} · {!contest.opened ? 'registration not open yet' : contest.deadlinePassed ? 'registration closed' : 'registration open'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {actions}
          {entries?.length > 0 && <button type="button" className={s.btn} onClick={() => downloadCsv(contest.title, filtering ? shown : entries)}
            title={filtering ? 'Only the contestants shown by the search and filters' : 'Every contestant'}>Download CSV</button>}
        </div>
      </div>

      {/* search and filters */}
      {entries?.length > 0 && (
        <div className={s.filters}>
          <input className={`${s.input} ${s.filterSearch}`} type="search" value={q} onChange={ev => setQ(ev.target.value)}
            placeholder="Search name, enrollment no., email, mobile…" aria-label="Search contestants" />
          <select className={s.input} value={dept} onChange={ev => setDept(ev.target.value)} aria-label="Department">
            <option value="">All departments</option>
            {depts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <div className={s.seg} role="group" aria-label="Gender">
            {[['', 'All'], ['F', 'Girls'], ['M', 'Boys']].map(([k, label]) => (
              <button key={k || 'all'} type="button" className={`${s.segBtn} ${gender === k ? s.segOn : ''}`}
                aria-pressed={gender === k} onClick={() => setGender(k)}>{label}</button>
            ))}
          </div>
          {sems.length > 1 && (
            <select className={s.input} value={sem} onChange={ev => setSem(ev.target.value)} aria-label="Semester">
              <option value="">All semesters</option>
              {sems.map(x => <option key={x} value={x}>{semLabel(x) || x}</option>)}
            </select>
          )}
          <span className={s.filterCount}>
            {filtering ? `${shown.length} of ${entries.length}` : `${entries.length} contestant${entries.length === 1 ? '' : 's'}`}
            {filtering && <button type="button" className={s.linkBtn} onClick={clear}>Clear</button>}
          </span>
        </div>
      )}

      {/* department by department (A → Z, names A → Z within each); one card per
          contestant, like the admin's event reports — their file opens under it */}
      {!entries ? <div className={s.empty}>Loading…</div>
        : entries.length === 0 ? <div className={s.empty}>No one has entered yet.</div>
        : shown.length === 0 ? <div className={s.empty}>No contestant matches — <button type="button" className={s.linkBtn} onClick={clear}>clear the search and filters</button>.</div>
        : groups.map(([d, list]) => (
          <section key={d} className={s.deptGroup}>
            <h3 className={s.deptHead}>{d} <span className={s.deptCount}>{list.length}</span></h3>
          <div className={s.files}>
            {list.map(e => {
              const isOpen = file === e.id;
              const toggle = () => setFile(isOpen ? null : e.id);
              const n = e.activities?.length || 0;
              return (
                <div key={e.id} className={s.fileCard}>
                  <div className={s.fileCardHeader} role="button" tabIndex={0} aria-expanded={isOpen} onClick={toggle}
                    onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } }}>
                    <div className={s.fileCardLeft}>
                      <div className={s.fileCardLine}>
                        <span className={s.fileCardTitle}>{e.name || '—'}</span>
                        <span className={s.fileCardMeta}>
                          {[e.department || e.school, semLabel(e.semester), e.mobile, e.contactEmail].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <div className={s.fileCardMeta}>Submitted {when(e.submittedAt)}</div>
                    </div>
                    <span className={s.filePill}>{n ? `${n} activit${n === 1 ? 'y' : 'ies'}` : 'PDF'}</span>
                    <span className={s.fileChevron}>{isOpen ? '▲' : '▼'}</span>
                  </div>
                  {isOpen && (
                    <div className={s.fileCardBody}>
                      {/* entered before activities: their one combined PDF */}
                      {!n && e.document && (
                        <p className={s.muted} style={{ margin: '0 0 8px' }}>
                          Entered with one combined file: <a className={s.link} href={e.document.url} target="_blank" rel="noreferrer">Open PDF</a>
                        </p>
                      )}
                      <SotyDocumentView doc={docFromEntry(contest, e)} fileName={docFileName(docFromEntry(contest, e))} />
                      {onDelete && (
                        <button type="button" className={`${s.btn} ${s.btnDanger}`} style={{ marginTop: 10 }} onClick={() => onDelete(e)}>
                          Remove contestant
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          </section>
        ))}
    </>
  );
}

const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
function downloadCsv(title, entries) {
  const head = ['#', 'Name', 'Enrollment No', 'Branch', 'Semester', 'Gender', 'School', 'Even Sem Attendance', 'Odd Sem Attendance',
    'Even Sem CGPA/Percentage', 'Odd Sem CGPA/Percentage', 'Mobile', 'Email', 'Login email', 'Co-curricular / achievements',
    'Why the right contestant', 'Entered at'];
  const rows = entries.map((e, i) => [i + 1, cell(e.name), cell(e.enrollmentNo), cell(e.branch), cell(e.semester), cell(e.gender),
    cell(e.school), fmt(e.evenAttendance), fmt(e.oddAttendance), fmt(e.evenScore), fmt(e.oddScore), cell(e.mobile),
    cell(e.contactEmail), cell(e.email),
    cell(e.activities?.length ? e.activities.map((a, n) => `${n + 1}. ${a.title}: ${a.description}`).join('\n') : e.achievements),
    cell(e.reason), cell(when(e.submittedAt))]);
  const csv = [head.map(cell), ...rows].map(r => r.join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(title || 'Student of the year').replace(/[^a-z0-9]+/gi, '_')}_contestants.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

