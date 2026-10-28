import { useState, useEffect } from 'react';
import { galoreApi } from '../../utils/galoreApi';
import GaloreRegistrations from './GaloreRegistrations';
import {
  EventHeader, Label, Stats, Table, TBA, FileLink, FixtureList, TeamList, VerifyParticipant, Empty, Notice,
} from './GaloreUI';
import { useSections, whenOf, findClashes } from './galoreHelpers';
import s from './Galore.module.css';

/* Department coordinator and/or activity coordinator — one Galore event, only
   what they look after:
     • activity coordinator  — their activities: registrations from every
                               department, teams, fixtures, checking participants
     • department coordinator — their department: its students in every activity
   Overview · Registrations · Teams & fixtures · Verify participant */
export default function GaloreStaff({ data }) {
  const { event, activities, departments } = data;
  const isAct = activities.length > 0, isDept = departments.length > 0;
  const role = isAct && isDept ? 'Activity & department coordinator' : isAct ? 'Activity coordinator' : 'Department coordinator';

  const [regs,  setRegs]  = useState(null);
  const [error, setError] = useState('');
  const [teams, setTeams] = useState(null); // { [activityId]: teams[] }
  const [fixtures, setFixtures] = useState({});

  const [section, tabs] = useSections([
    ['overview', 'Overview'],
    ['registrations', 'Registrations'],
    ...(isAct ? [['teams', 'Teams & fixtures'], ['verify', 'Verify participant']] : []),
  ]);

  useEffect(() => {
    galoreApi.get(`/events/${event.id}/registrations`).then(d => setRegs(d.registrations || [])).catch(err => setError(err.message));
  }, [event.id]);
  /* teams (and fixtures) only when a section needs them */
  useEffect(() => {
    if (!isAct || teams !== null || (section !== 'teams' && section !== 'verify')) return;
    Promise.all(activities.map(a => galoreApi.get(`/activities/${a.id}/teams`).then(d => [a.id, d.teams || []]).catch(() => [a.id, []])))
      .then(pairs => setTeams(Object.fromEntries(pairs)));
    activities.forEach(a => galoreApi.get(`/activities/${a.id}/fixtures`)
      .then(d => setFixtures(f => ({ ...f, [a.id]: d.fixtures || [] }))).catch(() => setFixtures(f => ({ ...f, [a.id]: [] }))));
  }, [isAct, teams, section, activities]);

  const actIds = new Set(activities.map(a => a.id));
  const deptSet = new Set(departments.map(d => d.name.toLowerCase()));
  const myActRegs  = (regs || []).filter(r => actIds.has(r.eventId));
  const myDeptRegs = (regs || []).filter(r => deptSet.has(String(r.dept || '').toLowerCase()));
  const countBy = (list, key) => list.reduce((m, r) => m.set(r[key] || '—', (m.get(r[key] || '—') || 0) + 1), new Map());
  const clashes = findClashes(activities, regs);

  return (
    <div className={s.card}>
      <EventHeader role={role} event={event} />
      {tabs}
      {error && <div className={s.error}>{error}</div>}

      {section === 'overview' && (
        <>
          <Stats items={[
            ...(isAct ? [[activities.length, 'activities you coordinate'], [regs ? myActRegs.length : '…', 'registrations in them']] : []),
            ...(isDept ? [[departments.map(d => d.name).join(', '), 'your department'], [regs ? myDeptRegs.length : '…', 'registrations from it']] : []),
          ]} />

          {isAct && (
            <>
              {clashes.length > 0 && (
                <Notice tone="warn">
                  Scheduling clash between your activities:
                  <ul>{clashes.map(c => <li key={`${c.a.id}-${c.b.id}`}><strong>{c.a.title}</strong> and <strong>{c.b.title}</strong> — {c.when}{c.shared ? ` (${c.shared} student${c.shared === 1 ? '' : 's'} in both)` : ''}</li>)}</ul>
                </Notice>
              )}
              <Label>Your activities</Label>
              <Table head={['Activity', 'Run by', 'Date & time', 'Venue', 'Registered', 'Teams', 'Guidelines']}>
                {activities.map(a => (
                  <tr key={a.id}>
                    <td><strong>{a.title}</strong><div className={s.muted}>{a.categoryName}</div></td>
                    <td>{a.clubName || '—'}</td><td>{whenOf(a)}</td><td>{a.venue || <TBA />}</td>
                    <td>{a.registrationCount}</td><td>{a.participationType === 'team' ? a.teamCount ?? 0 : '—'}</td>
                    <td>{a.rules ? <FileLink file={a.rules} label="Open" /> : <span className={s.muted}>None yet</span>}</td>
                  </tr>
                ))}
              </Table>
              <Label>Registrations by department</Label>
              <Table head={['Activity', 'Departments']}>
                {activities.map(a => {
                  const by = countBy(myActRegs.filter(r => r.eventId === a.id), 'dept');
                  return (
                    <tr key={a.id}>
                      <td><strong>{a.title}</strong></td>
                      <td>{regs === null ? '…' : by.size ? [...by].sort((x, y) => y[1] - x[1]).map(([d, n]) => `${d} ${n}`).join(' · ') : 'No registrations yet'}</td>
                    </tr>
                  );
                })}
              </Table>
            </>
          )}

          {isDept && (
            <>
              <Label>{departments.map(d => d.name).join(', ')} students by activity</Label>
              {regs === null ? <span className={s.muted}>Loading…</span> : (() => {
                const by = countBy(myDeptRegs, 'eventTitle');
                return by.size === 0 ? <Empty>No students from your department have registered yet.</Empty> : (
                  <Table head={['Activity', 'Students from your department']}>
                    {[...by].sort((x, y) => y[1] - x[1]).map(([t, n]) => <tr key={t}><td><strong>{t}</strong></td><td>{n}</td></tr>)}
                  </Table>
                );
              })()}
            </>
          )}
        </>
      )}

      {section === 'registrations' && <GaloreRegistrations registrations={regs} error={error} fileBase={event.title} />}

      {section === 'teams' && activities.map(a => (
        <div key={a.id} style={{ marginBottom: 18 }}>
          <Label>{a.title}{a.clubName ? ` — run by ${a.clubName}` : ''}</Label>
          <div className={s.grid}>
            <div className={s.activity}>
              <h3 className={s.activityTitle} style={{ fontSize: '.92rem' }}>Teams</h3>
              <div className={s.fixtures}><TeamList teams={teams ? teams[a.id] || [] : null} clubName={a.clubName} /></div>
            </div>
            <div className={s.activity}>
              <h3 className={s.activityTitle} style={{ fontSize: '.92rem' }}>Fixtures</h3>
              <div className={s.fixtures}><FixtureList fixtures={fixtures[a.id] ?? null} /></div>
            </div>
          </div>
        </div>
      ))}

      {section === 'verify' && (
        <VerifyParticipant registrations={regs ? myActRegs : null} teams={teams || {}}
          scope={activities.length === 1 ? activities[0].title : 'your activities'} />
      )}
    </div>
  );
}
