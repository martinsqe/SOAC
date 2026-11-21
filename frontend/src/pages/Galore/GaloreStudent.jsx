import { useState } from 'react';
import { Notice, FileLink } from './GaloreUI';
import GaloreActivitySelection from './GaloreActivitySelection';
import { findClashes } from './galoreHelpers';
import { ScheduleView } from './GaloreSchedule';
import GaloreStudentActivities from './GaloreStudentActivities';
import s from './Galore.module.css';

/* Student — one Galore event: the whole Galore schedule (every activity and
   match), theirs highlighted, with any clash between their own activities
   flagged. Above it, one line naming what they registered for. */

/* ["Football", "Basketball", "Chess"] → "Football, Basketball and Chess" */
const listOf = (names) => (names.length < 2 ? names.join('')
  : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

const SELECTION_TABS = [['activities', 'Activity selection'], ['registrations', 'Registrations']];

export default function GaloreStudent({ data, section = 'schedule', onRegistered }) {
  const [tab, setTab] = useState(SELECTION_TABS[0][0]);
  const { event, activities } = data;
  const clashes = findClashes(activities);
  const names = activities.map(a => a.title);

  /* Event selection: choose activities (their verified details + the checklist),
     and Registrations — everyone in the activities they entered, and the selections */
  if (section === 'selection') {
    return (
      <div className={s.card}>
        <h2 className={s.cardTitle} style={{ textAlign: 'center', marginBottom: 10 }}>Event selection</h2>
        {/* the same tabs as the main coordinator's Manage event: evenly spaced, an arrow on each (the open one points up) */}
        <div className={s.deptTabs} role="tablist" aria-label="Event selection">
          {SELECTION_TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} aria-expanded={tab === k}
              className={`${s.deptTab} ${s.manageTab} ${tab === k ? s.deptTabOn : ''}`} onClick={() => setTab(k)}>
              {label}
              <svg className={`${s.roleArrow} ${tab === k ? s.roleArrowUp : ''}`} viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </div>
        {tab === 'activities'
          ? <GaloreActivitySelection eventId={event.id} onRegistered={onRegistered} />
          : activities.length === 0
            ? <div className={s.muted} style={{ textAlign: 'center', padding: '18px 0' }}>Your registrations show here once you confirm your activities under Activity selection.</div>
            : <GaloreStudentActivities eventId={event.id} />}
      </div>
    );
  }

  return (
    <div className={s.card}>
      <div className={s.eventHead}>
        <div>
          <h2 className={s.cardTitle}>{event.title}</h2>
          <div className={s.registeredLine}>
            {names.length
              ? <>You registered for <strong>{listOf(names)}</strong>. Be at the venue by the reporting time.</>
              : 'You haven’t registered for any activities yet.'}
          </div>
        </div>
        <FileLink file={event.rules} label="General guidelines" />
      </div>
      <div className={s.pageGap} />

      {clashes.length > 0 && (
        <Notice tone="warn">
          Two of your activities are at the same time — tell their coordinators so they can help you take part in both:
          <ul>{clashes.map(c => <li key={`${c.a.id}-${c.b.id}`}><strong>{c.a.title}</strong> and <strong>{c.b.title}</strong> — {c.when}</li>)}</ul>
        </Notice>
      )}
      <ScheduleView eventId={event.id} mine={new Set(activities.map(a => a.id))} mineLabel="Only my activities" intro={false} asStudent />
    </div>
  );
}
