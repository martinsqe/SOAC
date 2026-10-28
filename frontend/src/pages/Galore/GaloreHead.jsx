import { useState, useEffect, useCallback } from 'react';
import { galoreApi } from '../../utils/galoreApi';
import { toBuilder, toPayload, builderProblems } from '../../utils/galoreForm';
import { downloadPeopleCsv } from '../../utils/galoreCsv';
import GaloreFormBuilder from '../Admin/GaloreFormBuilder';
import GaloreRegistrations from './GaloreRegistrations';
import {
  EventHeader, Label, Stats, Table, Notice, Empty, VerifyParticipant,
} from './GaloreUI';
import { useSections, findClashes } from './galoreHelpers';
import s from './Galore.module.css';

/* Overall Galore coordinator — runs one Galore event from the portal: everything
   the admin's Galore tab does for it except creating or deleting the event.
     Overview       totals, participation per activity (low / high flagged),
                    departments, open / close each activity's registration
     Schedule       every activity's date, time, venue and guidelines; clashes
     Registrations  every activity, every department, CSV
     Verify         check a participant's registration before they play
     People         everyone assigned: who, what, contact
     Galore form    departments + their coordinators, categories, activities +
                    their clubs and coordinators
     Event details  the event's own title, dates, venue, description */
const dayLabel = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function GaloreHead({ eventId }) {
  const [details, setDetails] = useState(null);
  const [form,    setForm]    = useState(null);   // server form (with who's assigned)
  const [regs,    setRegs]    = useState(null);
  const [error,   setError]   = useState('');
  const [toast,   setToast]   = useState('');
  const [section, tabs] = useSections([
    ['overview', 'Overview'], ['schedule', 'Schedule'], ['registrations', 'Registrations'], ['verify', 'Verify participant'],
    ['people', 'People'], ['form', 'Galore form'], ['details', 'Event details'],
  ]);

  const load = useCallback(() => {
    galoreApi.get(`/head/events/${eventId}`).then(d => { setDetails(d.details); setForm(d.form); }).catch(err => setError(err.message));
    galoreApi.get(`/head/events/${eventId}/registrations`).then(d => setRegs(d.registrations || [])).catch(err => setError(err.message));
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };
  const uploadGuidelines = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return galoreApi.postForm(`/head/events/${eventId}/guidelines-upload`, fd);
  };
  /* Every save goes through the same path as the admin's (validation + update emails) */
  const saveForm = async (builder, detailsChanged = false) => {
    const saved = await galoreApi.put(`/head/events/${eventId}/form`, { form: toPayload(builder), detailsChanged });
    setForm(saved);
    return saved;
  };

  if (error && !details) return <div className={s.card}><div className={s.error}>{error}</div></div>;
  if (!details || !form) return <div className={s.card}><div className={s.muted}>Loading…</div></div>;

  const activities = form.categories.flatMap(c => c.activities.map(a => ({ ...a, categoryName: c.name, dateLabel: dayLabel(a.scheduleDate) })));

  return (
    <div className={s.card}>
      <EventHeader role="Overall Galore coordinator" event={details} />
      {tabs}
      {toast && <div className={s.ok}>{toast}</div>}

      {section === 'overview' && <Overview details={details} form={form} activities={activities} regs={regs} eventId={eventId} onChanged={load} />}
      {section === 'schedule' && <Schedule form={form} activities={activities} regs={regs} onSave={saveForm} upload={uploadGuidelines} flash={flash} />}
      {section === 'registrations' && <GaloreRegistrations registrations={regs} error={error} fileBase={details.title} />}
      {section === 'verify' && <VerifyParticipant registrations={regs} scope={details.title} />}
      {section === 'people' && <People details={details} form={form} activities={activities} />}
      {section === 'form' && <FormEditor eventId={eventId} form={form} onSave={saveForm} upload={uploadGuidelines} flash={flash} />}
      {section === 'details' && <DetailsEditor eventId={eventId} details={details} form={form} onSaved={d => setDetails(d)} onSave={saveForm} flash={flash} />}
    </div>
  );
}

/* ── Overview: totals, participation per activity, departments, open / close ── */
function Overview({ details, form, activities, regs, eventId, onChanged }) {
  const [busyId, setBusyId] = useState(null);
  const byDept = new Map(form.departments.map(d => [d.name.toLowerCase(), { name: d.name, coord: d.coordName, coordEmail: d.coordEmail, count: 0 }]));
  for (const r of regs || []) {
    const k = String(r.dept || '').toLowerCase();
    if (!byDept.has(k)) byDept.set(k, { name: r.dept || 'Unspecified', coord: '', coordEmail: '', count: 0 });
    byDept.get(k).count++;
  }
  const toggle = async (a) => {
    setBusyId(a.id);
    try {
      await galoreApi.patch(`/head/events/${eventId}/activities/${a.id}/registration`, { closed: !a.registrationClosed });
      onChanged();
    } finally { setBusyId(null); }
  };
  /* Unequal participation: each activity against the average */
  const total = activities.reduce((n, a) => n + a.registrationCount, 0);
  const avg = activities.length ? total / activities.length : 0;
  const max = Math.max(1, ...activities.map(a => a.registrationCount));
  const level = (n) => (avg >= 2 && n < avg * 0.5 ? 'low' : avg >= 2 && n > avg * 1.5 ? 'high' : '');
  const low = activities.filter(a => level(a.registrationCount) === 'low');

  return (
    <>
      <Stats items={[
        [details.studentCount, 'students registered'],
        [details.registrationCount, 'activity registrations'],
        [activities.length, 'activities'],
        [form.departments.length, 'departments'],
      ]} />

      <Label>Participation by activity</Label>
      {low.length > 0 && (
        <Notice tone="warn">
          Low participation (under half the average of {avg.toFixed(1)} per activity): {low.map(a => a.title).join(', ')}.
          Consider promoting these, extending their registration, or merging divisions.
        </Notice>
      )}
      <Table head={['Activity', 'Run by', 'Activity coordinator', 'Registered', 'Share', 'Teams', 'Registration']} minWidth={760}>
        {[...activities].sort((x, y) => y.registrationCount - x.registrationCount).map(a => {
          const lv = level(a.registrationCount);
          return (
            <tr key={a.id}>
              <td><strong>{a.title}</strong><div className={s.muted}>{a.categoryName}</div></td>
              <td>{a.clubName || '—'}</td>
              <td>{a.coordinatorName || '—'}{a.coordinatorEmail && <div className={s.muted}>{a.coordinatorEmail}</div>}</td>
              <td>
                {a.registrationCount}{' '}
                {lv && <span className={`${s.flag} ${lv === 'low' ? s.flagLow : s.flagHigh}`}>{lv === 'low' ? 'Low' : 'High'}</span>}
              </td>
              <td style={{ width: 140 }}><div className={s.bar}><div className={s.barFill} style={{ width: `${(a.registrationCount / max) * 100}%` }} /></div></td>
              <td>{a.participationType === 'team' ? a.teamCount : '—'}</td>
              <td>
                <button className={s.smallBtn} disabled={busyId === a.id} onClick={() => toggle(a)}>
                  {busyId === a.id ? 'Saving…' : a.registrationClosed ? 'Closed — reopen' : 'Open — close'}
                </button>
              </td>
            </tr>
          );
        })}
      </Table>

      <Label>Departments</Label>
      <Table head={['Department', 'Department coordinator', 'Registrations']}>
        {[...byDept.values()].map(d => (
          <tr key={d.name}>
            <td><strong>{d.name}</strong></td>
            <td>{d.coord || '—'}{d.coordEmail && <div className={s.muted}>{d.coordEmail}</div>}</td>
            <td>{d.count}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

/* ── People: everyone assigned to this Galore event, in one list ── */
function People({ details, form, activities }) {
  const rows = [
    ...(form.head?.email ? [{ role: 'Overall Galore coordinator', name: form.head.name, email: form.head.email, of: details.title, club: '' }] : []),
    ...form.departments.map(d => ({ role: 'Department coordinator', name: d.coordName, email: d.coordEmail, of: d.name, club: '' })),
    ...activities.map(a => ({ role: 'Activity coordinator', name: a.coordinatorName, email: a.coordinatorEmail, of: a.title, club: a.clubName })),
  ];
  if (!rows.length) return <Empty>Nobody is assigned yet.</Empty>;
  return (
    <>
      <div className={s.filters}>
        <span className={s.muted}>{rows.length} assignment{rows.length === 1 ? '' : 's'} — everyone here has a Galore portal login.</span>
        <button className={s.smallBtn} onClick={() => downloadPeopleCsv(`${details.title} people`, rows)}>Download CSV</button>
      </div>
      <Table head={['Role', 'Responsible for', 'Club', 'Name', 'Email']}>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.role}</td><td><strong>{r.of}</strong></td><td>{r.club || '—'}</td><td>{r.name || '—'}</td>
            <td>{r.email ? <a href={`mailto:${r.email}`} style={{ color: '#b91c1c' }}>{r.email}</a> : '—'}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

/* ── Schedule: date / time / venue / guidelines of every activity ── */
function Schedule({ form, regs, onSave, upload, flash }) {
  const [b, setB] = useState(() => toBuilder(form));
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  useEffect(() => { setB(toBuilder(form)); }, [form]);
  const setAct = (catKey, actKey, patch) => setB(p => ({
    ...p, categories: p.categories.map(c => c.key !== catKey ? c : { ...c, activities: c.activities.map(a => a.key === actKey ? { ...a, ...patch } : a) }),
  }));
  const save = async () => {
    setBusy(true); setErr('');
    try { await onSave(b); flash('Schedule saved — everyone assigned has been emailed the update.'); }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };
  /* clashes in what's on screen now, so they show while editing */
  const clashes = findClashes(b.categories.flatMap(c => c.activities.map(a => ({ ...a, dateLabel: dayLabel(a.scheduleDate) }))), regs);
  return (
    <>
      <p className={s.muted} style={{ margin: '0 0 12px' }}>Leave anything blank until it's decided — students and staff see "To be announced".</p>
      {clashes.length > 0 ? (
        <Notice tone="warn">
          Scheduling clashes — activities on the same date at the same time:
          <ul>
            {clashes.map(c => (
              <li key={`${c.a.key}-${c.b.key}`}>
                <strong>{c.a.title}</strong> and <strong>{c.b.title}</strong> — {c.when}
                {c.shared ? `: ${c.shared} student${c.shared === 1 ? ' is' : 's are'} registered for both` : c.shared === 0 ? ': no student is in both' : ''}
                {c.sameVenue ? ' — and the same venue' : ''}
              </li>
            ))}
          </ul>
        </Notice>
      ) : (
        <Notice tone="ok">No scheduling clashes in the dates and times set so far.</Notice>
      )}
      {b.categories.map(c => (
        <div key={c.key}>
          <div className={s.sectionLabel}>{c.name}</div>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th>Activity</th><th>Date</th><th>Time</th><th>Venue</th><th>Guidelines</th></tr></thead>
              <tbody>
                {c.activities.map(a => (
                  <tr key={a.key}>
                    <td><strong>{a.title}</strong></td>
                    <td><input type="date" className={s.select} value={a.scheduleDate} onChange={e => setAct(c.key, a.key, { scheduleDate: e.target.value })} /></td>
                    <td><input className={s.select} style={{ width: 130 }} maxLength={100} placeholder="e.g. 10:00 AM" value={a.time} onChange={e => setAct(c.key, a.key, { time: e.target.value })} /></td>
                    <td><input className={s.select} style={{ width: 170 }} maxLength={255} placeholder="e.g. Main Ground" value={a.venue} onChange={e => setAct(c.key, a.key, { venue: e.target.value })} /></td>
                    <td><GuidelinesCell a={a} upload={upload} onChange={patch => setAct(c.key, a.key, patch)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {err && <div className={s.error} style={{ marginTop: 12 }}>{err}</div>}
      <div style={{ marginTop: 14 }}><button className={s.primaryBtn} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save schedule'}</button></div>
    </>
  );
}

function GuidelinesCell({ a, upload, onChange }) {
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try { const d = await upload(f); onChange({ rulesUrl: d.url, rulesName: d.name }); }
    finally { setBusy(false); }
  };
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {a.rulesUrl && <a href={a.rulesUrl} target="_blank" rel="noreferrer" style={{ color: '#047857', fontWeight: 600, fontSize: '.8rem' }}>{a.rulesName || 'Guidelines'}</a>}
      <label className={s.smallBtn} style={{ cursor: 'pointer' }}>
        {busy ? 'Uploading…' : a.rulesUrl ? 'Replace' : 'Upload'}
        <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }} onChange={pick} />
      </label>
      {a.rulesUrl && <button className={s.linkBtn} style={{ color: '#9ca3af', fontSize: '.78rem' }} onClick={() => onChange({ rulesUrl: '', rulesName: '' })}>Remove</button>}
    </span>
  );
}

/* ── Galore form: the admin's builder, without the Galore-coordinator field ── */
function FormEditor({ eventId, form, onSave, upload, flash }) {
  const [b,     setB]     = useState(() => toBuilder(form));
  const [staff, setStaff] = useState(null);
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState('');
  useEffect(() => { setB(toBuilder(form)); }, [form]);
  useEffect(() => {
    galoreApi.get(`/head/events/${eventId}/staff-options`).then(setStaff).catch(ex => setErr(ex.message));
  }, [eventId]);
  const problems = builderProblems(b, { requireHead: false });
  const save = async () => {
    if (problems.length) return setErr(problems[0]);
    setBusy(true); setErr('');
    try { await onSave(b); flash('Galore form saved — everyone assigned has been emailed the update.'); }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };
  if (!staff) return <div className={s.muted}>{err || 'Loading…'}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <GaloreFormBuilder value={b} onChange={setB} clubs={staff.clubs || []} showHead={false} uploadGuidelines={upload} />
      {problems.length > 0 && <div style={{ fontSize: '.8rem', color: '#dc2626' }}>Still needed: {problems.slice(0, 3).join(' ')}</div>}
      {err && <div className={s.error}>{err}</div>}
      <div><button className={s.primaryBtn} disabled={busy || problems.length > 0} onClick={save}>{busy ? 'Saving…' : 'Save Galore form'}</button></div>
    </div>
  );
}

/* ── Event details: the umbrella's own title / dates / venue / description ── */
function DetailsEditor({ eventId, details, form, onSaved, onSave, flash }) {
  const [d,    setD]    = useState(details);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const f = (k) => (e) => setD(p => ({ ...p, [k]: e.target.value }));
  const save = async () => {
    if (!d.title.trim()) return setErr('Event title is required.');
    setBusy(true); setErr('');
    try {
      const r = await galoreApi.put(`/head/events/${eventId}/details`, d);
      onSaved(r.details);
      /* let everyone assigned know the new dates / venue */
      await onSave(toBuilder(form), true);
      flash('Event details saved — everyone assigned has been emailed the update.');
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };
  const field = (label, k, props = {}) => (
    <div className={s.field}><label>{label}</label><input value={d[k] || ''} onChange={f(k)} {...props} /></div>
  );
  return (
    <div style={{ maxWidth: 640 }}>
      {field('Event title *', 'title', { maxLength: 255 })}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0 14px' }}>
        {field('Display date', 'date', { maxLength: 100, placeholder: 'e.g. 2nd to 7th Feb, 2027' })}
        {field('Start date', 'startDate', { type: 'date' })}
        {field('Time', 'time', { maxLength: 100, placeholder: 'e.g. 8am onwards' })}
        {field('Venue', 'venue', { maxLength: 255, placeholder: 'e.g. RKU Main Campus' })}
        {field('Seats / availability', 'seats', { maxLength: 255 })}
        <div className={s.field}>
          <label>Status</label>
          <select className={s.select} value={d.status} onChange={f('status')}>
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
          </select>
        </div>
      </div>
      <div className={s.field}>
        <label>Description</label>
        <textarea rows={4} className={s.select} value={d.description} onChange={f('description')} style={{ fontFamily: 'inherit', resize: 'vertical' }} />
      </div>
      {field('Highlight (past events)', 'highlight', { maxLength: 255 })}
      {err && <div className={s.error}>{err}</div>}
      <button className={s.primaryBtn} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save event details'}</button>
    </div>
  );
}
