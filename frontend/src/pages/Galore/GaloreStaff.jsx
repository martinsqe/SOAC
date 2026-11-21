import { useState, useEffect } from 'react';
import { galoreApi } from '../../utils/galoreApi';
import useTeamsLive from '../../realtime/useTeamsLive';
import { ScheduleView } from './GaloreSchedule';
import { unitOf, selectedLabel } from './galoreHelpers';
import {
  EventHeader, Label, TeamList, VerifyParticipant, Empty, DeptRegistrations,
} from './GaloreUI';
import s from './Galore.module.css';

/* Department coordinator and/or activity coordinator — one Galore event, only
   what they look after:
     • activity coordinator  — their activities: registrations from every
                               department, teams, fixtures, checking participants
     • department coordinator — their department: its students in every activity
   Activity coordinator: Overview · Departments · Schedule · Verify participant
   Department coordinator: Overview · Registrations · Schedule */
export default function GaloreStaff({ data, section = 'overview' }) {
  const { event, activities, departments } = data;
  const isAct = activities.length > 0, isDept = departments.length > 0;
  const role = isAct && isDept ? 'Activity & department coordinator' : isAct ? 'Activity coordinator' : 'Department coordinator';

  const [regs,  setRegs]  = useState(null);
  const [error, setError] = useState('');
  const [teams, setTeams] = useState(null); // { [activityId]: teams[] }
  const [deptNames, setDeptNames] = useState(null); // every department in the event
  const [pick, setPick] = useState('');
  const [verify, setVerify] = useState(false); // Departments page: the participant check in place
  const [actInfo, setActInfo] = useState(null); // department coordinator: activity id → { isTeam, clubName, genderSplit }


  useEffect(() => {
    galoreApi.get(`/events/${event.id}/registrations`).then(d => setRegs(d.registrations || [])).catch(err => setError(err.message));
  }, [event.id]);
  /* teams changed anywhere: fetched again when next needed */
  useTeamsLive(isAct ? activities.map(a => a.id) : [], () => setTeams(null));
  /* teams only when a section needs them */
  useEffect(() => {
    if (!isAct || teams !== null || section !== 'departments') return;
    Promise.all(activities.map(a => galoreApi.get(`/activities/${a.id}/teams`).then(d => [a.id, d.teams || []]).catch(() => [a.id, []])))
      .then(pairs => setTeams(Object.fromEntries(pairs)));
  }, [isAct, teams, section, activities]);
  /* department coordinator: which activities have teams (for "Teams ▾" in their table) */
  useEffect(() => {
    if (!isDept || actInfo !== null || section !== 'registrations') return;
    galoreApi.get(`/events/${event.id}/schedule`)
      .then(d => setActInfo(Object.fromEntries((d.activities || []).map(a => [String(a.id), a]))))
      .catch(() => setActInfo({}));
  }, [isDept, actInfo, section, event.id]);
  const deptTeamsOf = (id) => {
    const a = actInfo?.[id];
    return a ? selectedLabel(a.teamUnit || 'individual') : null;
  };

  /* every department of the event, so ones with nobody registered yet still get a tab */
  useEffect(() => {
    if (!isAct || deptNames !== null || section !== 'departments') return;
    galoreApi.get(`/events/${event.id}/coordinators`)
      .then(d => setDeptNames((d.departments || []).map(x => x.name)))
      .catch(() => setDeptNames([]));
  }, [isAct, deptNames, section, event.id]);

  const actIds = new Set(activities.map(a => a.id));
  const deptSet = new Set(departments.map(d => d.name.toLowerCase()));
  const myActRegs  = (regs || []).filter(r => actIds.has(r.eventId));
  const myDeptRegs = (regs || []).filter(r => deptSet.has(String(r.dept || '').toLowerCase()));
  const deptLabel = departments.map(d => d.name).join(', ');
  /* activities in the order the server lists them (by category, then name) */
  const deptActOrder = new Map([...new Set(myDeptRegs.map(r => r.eventId))].map((id, i) => [String(id), i]));

  return (
    <div className={s.card}>
      <EventHeader role={role} event={event} />
      <div className={s.pageGap} />
      {error && <div className={s.error}>{error}</div>}

      {/* department coordinator: every registration from their department, activity by activity */}
      {section === 'registrations' && isDept && (
        regs === null ? (!error && <div className={s.muted}>Loading…</div>) : (
          <DeptRegistrations deptName={deptLabel} rows={myDeptRegs} order={deptActOrder} fileBase={event.title}
            emptyText={`No students from ${deptLabel} have registered yet.`} teamsOf={deptTeamsOf}
            teamDept={departments.length === 1 ? departments[0].name : ''} />
        )
      )}

      {section === 'departments' && isAct && verify && (
        <div className={s.deptBar}>
          <div className={s.muted}>Check a participant by their ID card number.</div>
          <button type="button" className={s.primaryBtn} onClick={() => setVerify(false)}>← Back to departments</button>
        </div>
      )}
      {section === 'departments' && isAct && verify && (
        <VerifyParticipant registrations={regs ? myActRegs : null} teams={teams || {}}
          scope={activities.length === 1 ? activities[0].title : 'your activities'} />
      )}
      {section === 'departments' && isAct && !verify && (
        <ActivityDepartments event={event} activities={activities} regs={regs === null ? null : myActRegs}
          deptNames={deptNames} pick={pick} onPick={setPick} onVerify={() => setVerify(true)} />
      )}

      {section === 'schedule' && (
        <ScheduleView eventId={event.id} mine={isAct ? new Set(activities.map(a => a.id)) : null} mineLabel="Only the activities I coordinate" />
      )}

    </div>
  );
}

/* ── Activity coordinator: Departments — every department in one row; the
   picked one shows its registrations for this coordinator's activities (one
   table, each activity centred under the headers) and the teams the club's
   coordinators formed for that department. ── */
function ActivityDepartments({ event, activities, regs, deptNames, pick, onPick, onVerify }) {
  if (regs === null || deptNames === null) return <div className={s.muted}>Loading…</div>;
  const lc = (v) => String(v || '').trim().toLowerCase();

  /* the event's departments (even with nobody yet), plus any a student typed that isn't one */
  const depts = deptNames.map(name => ({ key: lc(name), name, rows: [] }));
  const byKey = new Map(depts.map(d => [d.key, d]));
  for (const r of regs) {
    const k = lc(r.dept) || '—';
    if (!byKey.has(k)) { const d = { key: k, name: r.dept || 'No department', rows: [] }; byKey.set(k, d); depts.push(d); }
    byKey.get(k).rows.push(r);
  }
  if (depts.length === 0) return <Empty>No departments yet.</Empty>;
  const active = byKey.get(pick) || depts[0];
  const order = new Map(activities.map((a, i) => [String(a.id), i]));
  /* team activities: "Teams ▾" beside the name opens this department's teams */
  /* "Selected teams ▾" / "Selected duos ▾" / "Selected individuals ▾" beside each activity */
  const teamsOf = (id) => {
    const a = activities.find(x => String(x.id) === id);
    return a ? selectedLabel(unitOf(a)) : null;
  };

  return (
    <>
      <div className={s.deptTabs} role="tablist">
        {depts.map(d => (
          <button key={d.key} type="button" role="tab" aria-selected={active === d}
            className={`${s.deptTab} ${active === d ? s.deptTabOn : ''}`} onClick={() => onPick(d.key)}>
            {d.name} ({d.rows.length})
          </button>
        ))}
      </div>

      <Label>Registrations</Label>
      <DeptRegistrations key={active.key} deptName={active.name} rows={active.rows} order={order} fileBase={event.title}
        actOptions={activities.map(a => [String(a.id), a.title])} allLabel="My activities"
        extra={<button type="button" className={s.primaryBtn} style={{ width: 'auto' }} onClick={onVerify}>Verify participant</button>}
        teamsOf={teamsOf} teamDept={active.name} />
    </>
  );
}
