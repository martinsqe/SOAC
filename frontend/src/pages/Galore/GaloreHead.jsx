import { useState, useEffect, useCallback, useRef } from 'react';
import { galoreApi } from '../../utils/galoreApi';
import { toBuilder, toPayload, builderProblems } from '../../utils/galoreForm';
import GaloreFormBuilder from '../Admin/GaloreFormBuilder';
import GaloreRegistrations from './GaloreRegistrations';
import { downloadGaloreCsv } from '../../utils/galoreCsv';
import {
  EventHeader, Label, Stats, Table, Notice, Empty, VerifyParticipant,
} from './GaloreUI';
import { findClashes } from './galoreHelpers';
import { uploadGuidelines, GUIDELINES_ACCEPT } from '../../utils/guidelinesFile';
import s from './Galore.module.css';

/* Overall Galore coordinator — runs one Galore event from the portal: everything
   the admin's Galore tab does for it except creating or deleting the event.
   "Manage event" shows Event details, Galore form, Overview and Registrations
   as cards; Schedule and Verify have their own strip pages.
     Overview      totals, participation per activity (low / high flagged),
                    departments, open / close each activity's registration
     Schedule       every activity's date, time, venue and guidelines; clashes
     Registrations  every activity, every department, CSV
     Verify         check a participant's registration before they play
     Galore form    departments + their coordinators, categories, activities +
                    their clubs and coordinators
     Event details  the event's own title, dates, venue, description */
const dayLabel = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/* The cards on "Manage event" — each opens one of these sections */
const MANAGE = [
  ['details',       'Event details'],
  ['form',          'Galore form'],
  ['overview',      'Overview'],
  ['registrations', 'Registrations'],
];

export default function GaloreHead({ eventId, section = 'manage' }) {
  const [details, setDetails] = useState(null);
  /* which card is open on "Manage event" — back to the cards whenever the page changes */
  const [sub, setSub] = useState(null);
  const [lastSection, setLastSection] = useState(section);
  if (section !== lastSection) { setLastSection(section); setSub(null); }
  const [form,    setForm]    = useState(null);   // server form (with who's assigned)
  const [regs,    setRegs]    = useState(null);
  const [error,   setError]   = useState('');
  const [toast,   setToast]   = useState('');

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
  const saveForm = async (builder, detailsChanged = false, { clearDraft = false } = {}) => {
    const saved = await galoreApi.put(`/head/events/${eventId}/form`, { form: toPayload(builder), detailsChanged, clearDraft });
    setForm(saved);
    return saved;
  };

  if (error && !details) return <div className={s.card}><div className={s.error}>{error}</div></div>;
  if (!details || !form) return <div className={s.card}><div className={s.muted}>Loading…</div></div>;

  const activities = form.categories.flatMap(c => c.activities.map(a => ({ ...a, categoryName: c.name, dateLabel: dayLabel(a.scheduleDate) })));

  return (
    <div className={s.card}>
      <EventHeader role="Overall Galore coordinator" event={details} />
      <div className={s.pageGap} />
      <PublishBar eventId={eventId} details={details} form={form} onChange={published => setDetails(d => ({ ...d, published }))} flash={flash} />
      {toast && <div className={s.ok}>{toast}</div>}

      {section === 'manage' && !sub && (
        <ManageCards onOpen={setSub} />
      )}
      {section === 'manage' && sub && (
        <>
          <div className={s.manageBack}>
            <button type="button" className={s.backBtn} onClick={() => setSub(null)}>← Manage event</button>
            <h3 className={s.cardTitle}>{MANAGE.find(([k]) => k === sub)?.[1]}</h3>
          </div>
          <ManageSection sub={sub} eventId={eventId} details={details} form={form} activities={activities} regs={regs}
            error={error} load={load} saveForm={saveForm} upload={uploadGuidelines} flash={flash} setDetails={setDetails} />
        </>
      )}
      {section === 'schedule' && <Schedule form={form} activities={activities} regs={regs} onSave={saveForm} upload={uploadGuidelines} flash={flash} />}
      {section === 'departments' && <Departments details={details} form={form} activities={activities} regs={regs} error={error} />}
    </div>
  );
}

/* ── Manage event: one card per section, each with its key numbers ── */
function ManageCards({ onOpen }) {
  return (
    <div className={s.manageGrid}>
      {MANAGE.map(([k, label]) => (
        <button key={k} type="button" className={s.manageCard} onClick={() => onOpen(k)}>
          <span className={s.manageTitle}>{label}</span>
        </button>
      ))}
    </div>
  );
}

function ManageSection({ sub, eventId, details, form, activities, regs, error, load, saveForm, upload, flash, setDetails }) {
  if (sub === 'overview') return <Overview details={details} form={form} activities={activities} regs={regs} eventId={eventId} onChanged={load} />;
  if (sub === 'registrations') return <GaloreRegistrations registrations={regs} error={error} fileBase={details.title} />;
  if (sub === 'form') return <FormEditor eventId={eventId} form={form} onSave={saveForm} upload={upload} flash={flash} />;
  if (sub === 'details') return <DetailsEditor eventId={eventId} details={details} form={form} onSaved={d => setDetails(d)} onSave={saveForm} flash={flash} />;
  return null;
}

/* ── Departments: one tab per department in a single row; the picked one shows
   every student it registered, grouped by activity (like the admin's page).
   "Verify participant" sits on the right and opens the check in place. ── */
function Departments({ details, form, activities, regs, error }) {
  const [verify, setVerify] = useState(false);
  const [pick,   setPick]   = useState('');
  const lc = (v) => String(v || '').trim().toLowerCase();

  /* every department on the form (even with no one yet), plus any a student typed that isn't */
  const depts = form.departments.map(d => ({ key: lc(d.name), name: d.name, rows: [] }));
  const byKey = new Map(depts.map(d => [d.key, d]));
  for (const r of regs || []) {
    const k = lc(r.dept) || '—';
    if (!byKey.has(k)) { const d = { key: k, name: r.dept || 'No department', rows: [] }; byKey.set(k, d); depts.push(d); }
    byKey.get(k).rows.push(r);
  }
  const active = byKey.get(pick) || depts[0];
  const order = new Map(activities.map((a, i) => [String(a.id), i]));

  const groups = [];
  if (active) {
    const m = new Map();
    for (const r of active.rows) {
      if (!m.has(r.eventId)) m.set(r.eventId, { title: r.eventTitle, categoryName: r.categoryName, rows: [] });
      m.get(r.eventId).rows.push(r);
    }
    groups.push(...[...m.entries()]
      .sort(([a, x], [b, y]) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || x.title.localeCompare(y.title))
      .map(([, g]) => g));
  }

  return (
    <>
      <div className={s.deptBar}>
        <div className={s.muted}>
          {verify ? 'Check a participant by their ID card number.' : 'Registrations from each department, grouped by activity.'}
        </div>
        <button type="button" className={s.primaryBtn} onClick={() => setVerify(v => !v)}>
          {verify ? '← Back to departments' : 'Verify participant'}
        </button>
      </div>

      {verify ? <VerifyParticipant registrations={regs} scope={details.title} />
        : error && !regs ? <div className={s.error}>{error}</div>
        : regs === null ? <div className={s.muted}>Loading…</div>
        : depts.length === 0 ? <Empty>No departments yet — add them on Manage event → Galore form.</Empty>
        : (
          <>
            <div className={s.deptTabs} role="tablist">
              {depts.map(d => (
                <button key={d.key} type="button" role="tab" aria-selected={active === d}
                  className={`${s.deptTab} ${active === d ? s.deptTabOn : ''}`} onClick={() => setPick(d.key)}>
                  {d.name} ({d.rows.length})
                </button>
              ))}
            </div>

            {active.rows.length === 0 ? <Empty>No registrations from {active.name} yet.</Empty> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className={s.smallBtn} onClick={() => downloadGaloreCsv(`${details.title} ${active.name} all activities`, active.rows)}>
                    Download all {active.name} (CSV)
                  </button>
                </div>
                {groups.map(g => (
                  <div key={g.title}>
                    <h3 className={s.deptActHead}>
                      {g.title}
                      <span className={s.muted}>{g.categoryName ? `${g.categoryName} · ` : ''}{g.rows.length} registered</span>
                      <button className={s.smallBtn} onClick={() => downloadGaloreCsv(`${details.title} ${active.name} ${g.title}`, g.rows)}>Download CSV</button>
                    </h3>
                    <Table head={['#', 'Name', 'Enrollment No.', 'Gender', 'Course', 'Mobile', 'Email']}>
                      {g.rows.map((r, i) => (
                        <tr key={r.registrationId}>
                          <td>{i + 1}</td><td><strong>{r.name || '—'}</strong></td><td>{r.enrollmentNo || '—'}</td>
                          <td>{r.gender || '—'}</td><td>{r.course || '—'}</td><td>{r.phone || '—'}</td>
                          <td>{r.email ? <a href={`mailto:${r.email}`} style={{ color: '#b91c1c' }}>{r.email}</a> : '—'}</td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
    </>
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
  const [err,  setErr]  = useState('');
  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true); setErr('');
    try { onChange(await uploadGuidelines(upload, f)); }
    catch (ex) { setErr(ex.message || 'Upload failed — please try again.'); }
    finally { setBusy(false); }
  };
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {a.rulesUrl && <a href={a.rulesUrl} target="_blank" rel="noreferrer" style={{ color: '#047857', fontWeight: 600, fontSize: '.8rem' }}>{a.rulesName || 'Guidelines'}</a>}
      <label className={s.smallBtn} style={{ cursor: 'pointer' }}>
        {busy ? 'Uploading…' : a.rulesUrl ? 'Replace' : 'Upload'}
        <input type="file" accept={GUIDELINES_ACCEPT} style={{ display: 'none' }} onChange={pick} disabled={busy} />
      </label>
      {a.rulesUrl && <button className={s.linkBtn} style={{ color: '#9ca3af', fontSize: '.78rem' }} onClick={() => { setErr(''); onChange({ rulesUrl: '', rulesName: '' }); }}>Remove</button>}
      {err && <span style={{ color: '#dc2626', fontSize: '.76rem', flexBasis: '100%' }}>{err}</span>}
    </span>
  );
}

/* ── Galore form: the admin's builder, without the Galore-coordinator field ── */
function FormEditor({ eventId, form, onSave, upload, flash }) {
  const [b,     setB]     = useState(null);
  const [staff, setStaff] = useState(null);
  const [busy,  setBusy]  = useState(false);
  const [err,   setErr]   = useState('');
  /* where the editor started: the saved form, the usual template, or a draft */
  const [origin, setOrigin] = useState(null);       // 'form' | 'template' | 'draft'
  const [draftAt, setDraftAt] = useState(null);     // when the draft was last kept
  const [draftState, setDraftState] = useState(''); // '' | 'saving' | 'saved' | 'error'
  const dirty = useRef(false);                      // changed since the last draft save
  const isEmpty = !form.departments.length && !form.categories.length;

  /* Start from the draft if there is one (nothing typed is ever lost), else
     the saved form, else — for a brand-new event — the usual template */
  useEffect(() => {
    let off = false;
    (async () => {
      const draft = await galoreApi.get(`/head/events/${eventId}/form-draft`).then(r => r.draft).catch(() => null);
      if (off) return;
      if (draft?.data) { setB(draft.data); setOrigin('draft'); setDraftAt(draft.updatedAt); return; }
      if (!isEmpty) { setB(toBuilder(form)); setOrigin('form'); return; }
      const t = await galoreApi.get(`/head/events/${eventId}/template`).catch(() => null);
      if (off) return;
      if (t) { setB({ ...toBuilder(t), head: toBuilder(form).head }); setOrigin('template'); }
      else { setB(toBuilder(form)); setOrigin('form'); }
    })();
    return () => { off = true; };
  }, [form, isEmpty, eventId]);
  useEffect(() => {
    galoreApi.get(`/head/events/${eventId}/staff-options`).then(setStaff).catch(ex => setErr(ex.message));
  }, [eventId]);

  const keepDraft = useCallback(async (data) => {
    setDraftState('saving');
    try {
      const r = await galoreApi.put(`/head/events/${eventId}/form-draft`, { data });
      dirty.current = false;
      setDraftAt(r.updatedAt); setDraftState('saved');
      return true;
    } catch { setDraftState('error'); return false; }
  }, [eventId]);

  /* Autosave: a moment after they stop typing, the whole form — complete or not — is kept */
  const change = (next) => { dirty.current = true; setDraftState(''); setB(next); };
  useEffect(() => {
    if (!b || !dirty.current) return;
    const t = setTimeout(() => keepDraft(b), 1200);
    return () => clearTimeout(t);
  }, [b, keepDraft]);
  /* …and on leaving the page with changes not yet kept */
  const latest = useRef(b);
  latest.current = b;
  useEffect(() => () => {
    if (dirty.current && latest.current) {
      galoreApi.put(`/head/events/${eventId}/form-draft`, { data: latest.current }).catch(() => {});
    }
  }, [eventId]);
  useEffect(() => {
    const warn = (e) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const problems = b ? builderProblems(b, { requireHead: false }) : [];
  const saveDraftNow = async () => {
    if (await keepDraft(b)) flash('Draft saved — finish it any time, then save the Galore form.');
    else setErr('Could not save the draft — check your connection and try again.');
  };
  const save = async () => {
    if (problems.length) return setErr(problems[0]);
    setBusy(true); setErr('');
    try {
      await onSave(b, false, { clearDraft: true });
      dirty.current = false;
      setDraftAt(null); setDraftState(''); setOrigin('form');
      flash('Galore form saved — everyone assigned has been emailed the update.');
    }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };
  const discardDraft = async () => {
    if (!window.confirm('Discard the draft and go back to the last saved Galore form?')) return;
    try {
      await galoreApi.del(`/head/events/${eventId}/form-draft`);
      dirty.current = false;
      setDraftAt(null); setDraftState('');
      setB(toBuilder(form)); setOrigin('form');
    } catch (ex) { setErr(ex.message); }
  };

  if (!staff || !b) return <div className={s.muted}>{err || 'Loading…'}</div>;
  const at = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const status = draftState === 'saving' ? 'Saving draft…'
    : draftState === 'error' ? 'Draft not saved — check your connection'
    : draftAt ? `Draft saved ${at(draftAt)}` : '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {origin === 'template' && !draftAt && (
        <Notice>Started from the usual Galore departments, categories and activities — change, add or remove anything and assign the coordinators. Everything you type is kept as a draft as you go.</Notice>
      )}
      {(origin === 'draft' || draftAt) && (
        <Notice>
          You're editing a draft — it's kept as you type, so nothing is lost, but students and coordinators don't see it
          until you <strong>Save Galore form</strong> (that needs every field filled in).
          {!isEmpty && <> <button type="button" className={s.linkBtn} onClick={discardDraft}>Discard draft</button></>}
        </Notice>
      )}
      <GaloreFormBuilder value={b} onChange={change} clubs={staff.clubs || []} showHead={false} uploadGuidelines={upload} />
      {problems.length > 0 && <div style={{ fontSize: '.8rem', color: '#dc2626' }}>Still needed before saving the form: {problems.slice(0, 3).join(' ')}</div>}
      {err && <div className={s.error}>{err}</div>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className={s.smallBtn} type="button" disabled={draftState === 'saving'} onClick={saveDraftNow}>Save draft</button>
        <button className={s.primaryBtn} type="button" disabled={busy || problems.length > 0} onClick={save}>{busy ? 'Saving…' : 'Save Galore form'}</button>
        {status && <span className={s.muted} style={{ fontSize: '.78rem', color: draftState === 'error' ? '#b91c1c' : undefined }}>{status}</span>}
      </div>
    </div>
  );
}
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
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
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

/* ── Publishing: the admin created Galore and named the overall coordinator;
   the coordinator adds the rest and publishes it. Until then students can't see
   Galore or register. ── */
function PublishBar({ eventId, details, form, onChange, flash }) {
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const acts = form.categories.reduce((n, c) => n + c.activities.length, 0);
  const ready = form.departments.length > 0 && acts > 0;
  const set = async (published) => {
    if (!published && !window.confirm('Unpublish Galore? Students will no longer see it or be able to register.')) return;
    setBusy(true); setErr('');
    try {
      const r = await galoreApi.patch(`/head/events/${eventId}/publish`, { published });
      onChange(r.published);
      flash(r.published ? 'Galore is published — students can now see it and register.' : 'Galore is unpublished — hidden from students.');
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };
  const box = (tone) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
    borderRadius: 12, padding: '12px 14px', marginBottom: 14, fontSize: '.88rem',
    ...(tone === 'live' ? { background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534' }
      : { background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e' }),
  });
  if (details.published) {
    return (
      <div style={box('live')}>
        <span><strong>Published.</strong> Students can see Galore and register.</span>
        <button className={s.smallBtn} disabled={busy} onClick={() => set(false)}>{busy ? 'Saving…' : 'Unpublish'}</button>
      </div>
    );
  }
  return (
    <div style={box('draft')}>
      <span>
        <strong>Not published yet</strong> — students can’t see Galore or register.{' '}
        {ready ? 'Publish it when everything is in place.' : 'Add the departments and activities on “Galore form”, then publish.'}
        {err && <span style={{ display: 'block', color: '#b91c1c', marginTop: 4 }}>{err}</span>}
      </span>
      <button className={s.primaryBtn} style={{ width: 'auto', padding: '9px 20px' }} disabled={busy || !ready} onClick={() => set(true)}>
        {busy ? 'Publishing…' : 'Publish Galore'}
      </button>
    </div>
  );
}
