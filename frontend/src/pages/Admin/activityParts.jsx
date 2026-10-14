import { useEffect } from 'react';
import api from '../../api/client';
import s from '../Coordinator/CoordSubPage.module.css';
import a from './AdminActivity.module.css';
import { activityLevel, cap, fmtDate, plural } from './activityUtils';

/* Zero reads as a faint numeral so real activity stands out. */
export const Num = ({ value }) => <span className={value ? '' : a.zero}>{value}</span>;

export function Activity({ date }) {
  const lvl = activityLevel(date);
  return (
    <div>
      <span className={`${a.lvl} ${lvl.cls}`}>{lvl.label}</span>
      {date && <div className={a.cellEmail} style={{ marginTop: 3 }}>Last {fmtDate(date)}</div>}
    </div>
  );
}

/* Expanded view of one person — every figure collected about them across the
   portal. `clubId` (when opened from a club) marks what belongs to that club. */
export function PersonDetail({ personId, clubId, cache, setCache }) {
  const detail = cache[personId];

  useEffect(() => {
    if (detail) return;
    let live = true;
    api.get(`/activity-monitor/members/${personId}`)
      .then(d => live && setCache(c => ({ ...c, [personId]: d })))
      .catch(err => live && setCache(c => ({ ...c, [personId]: { error: err.message || 'Failed to load details.' } })));
    return () => { live = false; };
  }, [personId, detail, setCache]);

  if (!detail) return <div className={a.detail}><span className={a.detailEmpty}>Loading…</span></div>;
  if (detail.error) return <div className={a.detail}><div className={s.errBox}>{detail.error}</div></div>;

  const { clubs, coordinated = [], events, volunteering = [], achievements } = detail;
  const attended = events.filter(e => e.presentSessions > 0).length;
  const here = (id) => clubId && String(id) === String(clubId);

  return (
    <div className={a.detail}>
      <div className={a.tiles}>
        {[
          ['Clubs', clubs.length + coordinated.filter(c => !clubs.some(m => m.id === c.id)).length],
          ['Events registered', events.filter(e => e.registered).length],
          ['Events attended', attended],
          ['Volunteered', volunteering.length],
          ['Achievements', achievements.length],
        ].map(([label, value]) => (
          <div key={label} className={a.tile}>
            <div className={a.tileNum}><Num value={value} /></div>
            <div className={a.tileLabel}>{label}</div>
          </div>
        ))}
      </div>

      <div className={a.detailGrid}>
        {coordinated.length > 0 && (
          <section className={a.panel}>
            <h4 className={a.detailTitle}>Clubs they run</h4>
            <table className={a.miniTable}>
              <thead>
                <tr><th>Club</th><th>Events proposed</th><th>Approved</th><th>Sessions held</th><th>Reports</th><th>Announcements</th><th>Tasks set</th></tr>
              </thead>
              <tbody>
                {coordinated.map(c => (
                  <tr key={c.id} className={here(c.id) ? a.hereRow : ''}>
                    <td>{c.name}</td>
                    <td><Num value={c.eventsProposed} /></td>
                    <td><Num value={c.eventsApproved} /></td>
                    <td><Num value={c.sessionsHeld} /></td>
                    <td>{c.reportsSubmitted} submitted / {c.reportsMade} made</td>
                    <td><Num value={c.announcements} /></td>
                    <td><Num value={c.tasksAssigned} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className={a.panel}>
          <h4 className={a.detailTitle}>Club membership</h4>
          {clubs.length === 0 ? (
            <span className={a.detailEmpty}>Not a member of any club.</span>
          ) : (
            <table className={a.miniTable}>
              <thead>
                <tr><th>Club</th><th>Role</th><th>Joined</th><th>Sessions</th><th>Attendance</th><th>Tasks done</th></tr>
              </thead>
              <tbody>
                {clubs.map(c => (
                  <tr key={c.id} className={here(c.id) ? a.hereRow : ''}>
                    <td>{c.name}</td>
                    <td>{c.role || 'Member'}</td>
                    <td>{fmtDate(c.joinedAt)}</td>
                    <td>{c.sessionsAttended} of {c.totalSessions}</td>
                    <td>
                      {c.attendancePct === null ? <span className={a.muted}>—</span> : (
                        <span className={a.bar}><span className={a.barTrack}><span className={a.barFill} style={{ width: `${c.attendancePct}%` }} /></span>{c.attendancePct}%</span>
                      )}
                    </td>
                    <td><Num value={c.tasksCompleted} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className={a.panel}>
          <h4 className={a.detailTitle}>Events participated ({events.length})</h4>
          {events.length === 0 ? (
            <span className={a.detailEmpty}>No event registrations or attendance.</span>
          ) : (
            <div className={a.scroll}>
              {events.map((e, i) => (
                <div key={`${e.eventId}-${i}`} className={a.listItem}>
                  <div className={a.listHead}>
                    <span>{e.title}</span>
                    {here(e.clubId) && <span className={a.hereTag}>This club</span>}
                  </div>
                  <div className={a.listSub}>
                    {cap(e.category)}{e.clubName ? ` · ${e.clubName}` : ''} · {fmtDate(e.date)}
                  </div>
                  <div className={a.listSub}>
                    {e.registered ? 'Registered' : 'Not registered'} · {
                      e.totalSessions === 0
                        ? 'No attendance taken'
                        : `Present at ${e.presentSessions} of ${plural(e.totalSessions, 'session')}`
                    }
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={a.panel}>
          <h4 className={a.detailTitle}>Volunteering ({volunteering.length})</h4>
          {volunteering.length === 0 ? (
            <span className={a.detailEmpty}>Has not volunteered at an event.</span>
          ) : (
            <div className={a.scroll}>
              {volunteering.map((v, i) => (
                <div key={`${v.eventId}-${i}`} className={a.listItem}>
                  <div className={a.listHead}>
                    <span>{v.role || 'Volunteer'}</span>
                    {here(v.clubId) && <span className={a.hereTag}>This club</span>}
                  </div>
                  <div className={a.listSub}>{v.title}{v.clubName ? ` · ${v.clubName}` : ''} · {fmtDate(v.date)}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={a.panel}>
          <h4 className={a.detailTitle}>Achievements ({achievements.length})</h4>
          {achievements.length === 0 ? (
            <span className={a.detailEmpty}>No achievements recorded.</span>
          ) : (
            <div className={a.scroll}>
              {achievements.map((x, i) => (
                <div key={i} className={a.listItem}>
                  {x.title}
                  <div className={a.listSub}>
                    {x.type}{x.detail ? ` · ${x.detail}` : ''}{x.clubName ? ` · ${x.clubName}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
