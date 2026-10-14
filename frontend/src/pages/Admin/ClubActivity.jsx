import { Fragment, useEffect, useState } from 'react';
import api from '../../api/client';
import s from '../Coordinator/CoordSubPage.module.css';
import a from './AdminActivity.module.css';
import { Activity, Num, PersonDetail } from './activityParts';
import { ROLE_LABEL, contributionItems, fmtDate } from './activityUtils';

const REPORT_LABEL = { submitted: 'Submitted', draft: 'Draft', none: 'No report' };

/* One club opened from the club table: everyone in it (Faculty Advisors, Student
   Coordinators, members) with their activity, and the club's events.
     club: the row from the club table (shown straight away while people load) */
export default function ClubActivity({ club, search, onBack }) {
  const [data, setData]   = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [cache, setCache]   = useState({});

  useEffect(() => {
    let live = true;
    api.get(`/activity-monitor/clubs/${club.id}`)
      .then(d => live && setData(d))
      .catch(err => live && setError(err.message || 'Failed to load the club.'));
    return () => { live = false; };
  }, [club.id]);

  const term = search.trim().toLowerCase();
  const people = (data?.people || []).filter(p =>
    !term || p.name.toLowerCase().includes(term) || (p.email || '').toLowerCase().includes(term));

  return (
    <div>
      <div className={a.clubHead}>
        <button className={a.backBtn} onClick={onBack}>All clubs</button>
        <div>
          <h2 className={a.clubTitle}>{club.name}</h2>
          <div className={a.clubMeta}>
            <span className={a.category}>{club.category}</span>
            {' · '}Faculty advisor: {club.facultyAdvisor || 'not assigned'}
            {' · '}Student coordinator: {club.studentCoordinator || 'not assigned'}
          </div>
        </div>
      </div>

      <div className={a.tiles} style={{ marginBottom: 18 }}>
        {[
          ['Members', club.members],
          ['Events conducted', club.eventsConducted],
          ['Upcoming events', club.eventsUpcoming],
          ['Participants', club.participants],
          ['Reports submitted', `${club.reportsSubmitted} / ${club.reportsGenerated}`],
        ].map(([label, value]) => (
          <div key={label} className={a.tile}>
            <div className={a.tileNum}>{value}</div>
            <div className={a.tileLabel}>{label}</div>
          </div>
        ))}
        <div className={a.tile}>
          <Activity date={club.lastActivity} />
          <div className={a.tileLabel}>Club activity</div>
        </div>
      </div>

      {error && <div className={s.errBox} style={{ marginBottom: 14 }}>{error}</div>}

      {!data && !error ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3, 4].map(i => <div key={i} className={s.shimmer} style={{ height: 52, borderRadius: 10 }} />)}
        </div>
      ) : data && (
        <>
          <h3 className={a.sectionTitle}>People ({people.length})</h3>
          {people.length === 0 ? (
            <div className={s.empty}><p>{term ? 'Nobody in this club matches this search' : 'Nobody has joined this club yet'}</p></div>
          ) : (
            <div className={s.tableCard} style={{ marginBottom: 24 }}>
              <table className={`${s.table} ${a.peopleTable} ${a.centered}`}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Activity</th>
                    <th className={a.num}>Events participated</th>
                    <th className={a.num}>Clubs</th>
                    <th>Contribution to the club</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {people.map(p => {
                    const open = openId === p.id;
                    const items = contributionItems(p);
                    return (
                      <Fragment key={p.id}>
                        <tr className={`${a.clickRow} ${open ? a.rowOpen : ''}`} onClick={() => setOpenId(open ? null : p.id)}>
                          <td>
                            <div className={a.cellName}>{p.name}</div>
                            <div className={a.cellEmail}>{p.email}</div>
                            {(p.dept || p.year) && (
                              <div className={a.cellEmail}>{[p.dept, p.year, p.enrollmentNo].filter(Boolean).join(' · ')}</div>
                            )}
                          </td>
                          <td>
                            <span className={`${a.role} ${a[`role_${p.kind}`]}`}>{ROLE_LABEL[p.kind]}</span>
                            {p.role && <div className={a.cellEmail} style={{ marginTop: 3 }}>{p.role}</div>}
                          </td>
                          <td><Activity date={p.lastActiveAt} /></td>
                          <td className={a.num}>
                            <div><Num value={p.events.participated} /></div>
                            <div className={a.cellEmail}>{p.events.attended} attended · {p.events.inClub} here</div>
                          </td>
                          <td className={a.num}><Num value={p.clubsCount} /></td>
                          <td>
                            {items.length === 0 ? <span className={a.muted}>Nothing yet</span> : (
                              <div className={a.chips}>
                                {items.map(([label, value]) => (
                                  <span key={label} className={a.chip}><b>{value}</b> {label}</span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td>
                            <button className={a.viewBtn} onClick={(e) => { e.stopPropagation(); setOpenId(open ? null : p.id); }}>
                              {open ? 'Hide' : 'Details'}
                            </button>
                          </td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={7} className={a.detailCell}>
                              <PersonDetail personId={p.id} clubId={club.id} cache={cache} setCache={setCache} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <h3 className={a.sectionTitle}>Events ({data.events.length})</h3>
          {data.events.length === 0 ? (
            <div className={s.empty}><p>This club has no events yet</p></div>
          ) : (
            <div className={s.tableCard}>
              <table className={`${s.table} ${a.mid} ${a.centered}`}>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th className={a.num}>Registered</th>
                    <th className={a.num}>Attended</th>
                    <th className={a.num}>Volunteers</th>
                    <th>Report</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map(e => (
                    <tr key={e.id}>
                      <td><div className={a.cellName}>{e.title}</div></td>
                      <td>{e.date ? fmtDate(e.date) : (e.dateLabel || '—')}</td>
                      <td className={a.category}>{e.isReportOnly ? 'Held earlier' : e.status}</td>
                      <td className={a.num}><Num value={e.registrations} /></td>
                      <td className={a.num}><Num value={e.attended} /></td>
                      <td className={a.num}><Num value={e.volunteers} /></td>
                      <td><span className={`${a.rep} ${a[`rep_${e.reportStatus}`]}`}>{REPORT_LABEL[e.reportStatus]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
