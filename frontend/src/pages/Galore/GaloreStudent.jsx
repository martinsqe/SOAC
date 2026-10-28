import { useState } from 'react';
import { galoreApi } from '../../utils/galoreApi';
import {
  EventHeader, Notice, Table, InfoRow, Person, TBA, FileLink, FixtureList,
} from './GaloreUI';
import { useSections, whenOf, typeLabel, findClashes } from './galoreHelpers';
import s from './Galore.module.css';

/* Student — one Galore event: only the activities they registered for, and
   everything about them.
     Timetable      their activities by date, with any clash flagged
     My activities  each one's details, who's in charge, guidelines, team, fixtures */
export default function GaloreStudent({ data }) {
  const { event, activities, department } = data;
  const [section, tabs] = useSections([['timetable', 'Timetable'], ['activities', `My activities (${activities.length})`]]);
  const timetable = [...activities].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.time.localeCompare(b.time));
  const clashes = findClashes(activities);

  return (
    <div className={s.card}>
      <EventHeader role="Student" event={event} sub={department ? `Your department: ${department}` : ''}
        description={event.description} actions={<FileLink file={event.rules} label="General guidelines" />} />
      {tabs}

      {section === 'timetable' && (
        <>
          {clashes.length > 0 && (
            <Notice tone="warn">
              Two of your activities are at the same time — tell their coordinators so they can help you take part in both:
              <ul>{clashes.map(c => <li key={`${c.a.id}-${c.b.id}`}><strong>{c.a.title}</strong> and <strong>{c.b.title}</strong> — {c.when}</li>)}</ul>
            </Notice>
          )}
          <Table head={['Activity', 'Date', 'Time', 'Venue']}>
            {timetable.map(a => (
              <tr key={a.id}>
                <td><strong>{a.title}</strong></td><td>{a.dateLabel || <TBA />}</td><td>{a.time || <TBA />}</td><td>{a.venue || <TBA />}</td>
              </tr>
            ))}
          </Table>
        </>
      )}

      {section === 'activities' && (
        <div className={s.grid}>
          {activities.map(a => <StudentActivity key={a.id} a={a} />)}
        </div>
      )}
    </div>
  );
}

function StudentActivity({ a }) {
  const [fixtures, setFixtures] = useState(null);
  const [team,     setTeam]     = useState(null);
  const [open,     setOpen]     = useState(false);
  const toggle = () => {
    setOpen(o => !o);
    if (fixtures === null) {
      galoreApi.get(`/activities/${a.id}/fixtures`)
        .then(d => { setFixtures(d.fixtures || []); setTeam(d.team || null); })
        .catch(() => setFixtures([]));
    }
  };
  return (
    <div className={s.activity}>
      <div className={s.activityHead}>
        <h3 className={s.activityTitle}>{a.title}</h3>
        <span className={s.pill}>{a.categoryName}</span>
      </div>
      <div className={s.info}>
        <InfoRow label="Type">{typeLabel(a)}</InfoRow>
        <InfoRow label="Date">{whenOf(a)}</InfoRow>
        <InfoRow label="Venue">{a.venue || <TBA />}</InfoRow>
        <InfoRow label="Coordinator"><Person p={a.coordinator} /></InfoRow>
        <InfoRow label="Dept. coord."><Person p={a.deptCoordinator} /></InfoRow>
        {a.clubName && <InfoRow label="Run by">{a.clubName}</InfoRow>}
        {a.participationType === 'team' && (
          <InfoRow label="Your team">
            {a.team ? <>
              {a.team.name}{a.team.division && a.team.division !== 'open' ? ` (${a.team.division})` : ''}
              {a.team.members?.length ? <div className={s.muted} style={{ fontWeight: 500 }}>{a.team.members.join(', ')}</div> : null}
            </> : <TBA />}
          </InfoRow>
        )}
      </div>
      <div className={s.actions}>
        {a.rules ? <FileLink file={a.rules} label="Guidelines" /> : <span className={s.muted} style={{ fontSize: '.78rem' }}>Guidelines not uploaded yet</span>}
        <button className={s.smallBtn} onClick={toggle}>{open ? 'Hide fixtures' : 'Fixtures'}</button>
      </div>
      {open && <div className={s.fixtures}><FixtureList fixtures={fixtures} team={team} /></div>}
    </div>
  );
}

