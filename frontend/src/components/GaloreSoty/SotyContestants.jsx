import { useState, Fragment } from 'react';
import s from './GaloreSoty.module.css';

/* Student of the Year — every contestant with all their details, for the admin
   and the main Galore coordinator. Click a name to read their answers and open
   their documents. onDelete (admin only) removes an entry. */
const fmt = (n) => (n == null ? '—' : String(Number(n)));
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export default function SotyContestants({ contest, entries, onDelete, actions }) {
  const [open, setOpen] = useState(null);
  return (
    <>
      <div className={s.listHead}>
        <div>
          <h2 className={s.listTitle}>Contestants{entries ? ` (${entries.length})` : ''}</h2>
          <p className={s.muted}>
            {contest.title} · {!contest.opened ? 'registration not open yet' : contest.deadlinePassed ? 'registration closed' : 'registration open'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {actions}
          {entries?.length > 0 && <button type="button" className={s.btn} onClick={() => downloadCsv(contest.title, entries)}>Download CSV</button>}
        </div>
      </div>

      {!entries ? <div className={s.empty}>Loading…</div>
        : entries.length === 0 ? <div className={s.empty}>No one has entered yet.</div>
        : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>#</th><th>Name</th><th>Enrollment No</th><th>Branch</th><th>Sem</th><th>Gender</th><th>School</th>
                  <th className={s.num}>Even att.</th><th className={s.num}>Odd att.</th>
                  <th className={s.num}>Even CGPA/%</th><th className={s.num}>Odd CGPA/%</th>
                  <th>Mobile</th><th>Email</th><th>Documents</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <Fragment key={e.id}>
                    <tr>
                      <td>{i + 1}</td>
                      <td>
                        <button type="button" className={s.rowBtn} aria-expanded={open === e.id} onClick={() => setOpen(o => (o === e.id ? null : e.id))}>
                          <span className={`${s.chev} ${open === e.id ? s.chevOpen : ''}`} aria-hidden="true">›</span>{e.name || e.email}
                        </button>
                      </td>
                      <td className={s.nowrap}>{e.enrollmentNo || '—'}</td>
                      <td>{e.branch || '—'}</td>
                      <td>{e.semester || '—'}</td>
                      <td>{e.gender || '—'}</td>
                      <td>{e.school || '—'}</td>
                      <td className={s.num}>{fmt(e.evenAttendance)}</td>
                      <td className={s.num}>{fmt(e.oddAttendance)}</td>
                      <td className={s.num}>{fmt(e.evenScore)}</td>
                      <td className={s.num}>{fmt(e.oddScore)}</td>
                      <td className={s.nowrap}>{e.mobile ? <a className={s.link} href={`tel:${e.mobile}`}>{e.mobile}</a> : '—'}</td>
                      <td>{e.contactEmail ? <a className={s.link} href={`mailto:${e.contactEmail}`}>{e.contactEmail}</a> : '—'}</td>
                      <td className={s.nowrap}>{e.document ? <a className={s.link} href={e.document.url} target="_blank" rel="noreferrer">Open PDF</a> : '—'}</td>
                    </tr>
                    {open === e.id && (
                      <tr className={s.details}>
                        <td />
                        <td colSpan={13}>
                          <div className={s.detailGrid}>
                            <div>
                              <div className={s.detailLabel}>Co-curricular activities / special achievements</div>
                              <div className={s.detailText}>{e.achievements}</div>
                            </div>
                            <div>
                              <div className={s.detailLabel}>Why they are the right contestant</div>
                              <div className={s.detailText}>{e.reason}</div>
                            </div>
                          </div>
                          <p className={s.muted} style={{ marginTop: 10, fontSize: '.78rem' }}>
                            Logged in as {e.email} · entered {when(e.submittedAt)}
                            {e.updatedAt && e.updatedAt !== e.submittedAt ? ` · last changed ${when(e.updatedAt)}` : ''}
                          </p>
                          {onDelete && (
                            <button type="button" className={`${s.btn} ${s.btnDanger}`} style={{ marginTop: 10 }} onClick={() => onDelete(e)}>
                              Remove contestant
                            </button>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
    cell(e.contactEmail), cell(e.email), cell(e.achievements), cell(e.reason), cell(when(e.submittedAt))]);
  const csv = [head.map(cell), ...rows].map(r => r.join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(title || 'Student of the year').replace(/[^a-z0-9]+/gi, '_')}_contestants.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
