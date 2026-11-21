import { useState, useEffect, useCallback, useRef } from 'react';
import { galoreApi } from '../../utils/galoreApi';
import useTeamsLive from '../../realtime/useTeamsLive';
import { toBuilder, toPayload, formProblems, mergeForSave } from '../../utils/galoreForm';
import GaloreFormBuilder from '../Admin/GaloreFormBuilder';
import GaloreActivities from './GaloreActivities';
import GaloreResults from './GaloreResults';
import { ScheduleView, FixtureMaker, DeclareButton } from './GaloreSchedule';
import {
  EventHeader, Label, Stats, Table, Notice, Empty, VerifyParticipant, DeptRegistrations,
} from './GaloreUI';
import { unitOf, selectedLabel } from './galoreHelpers';
import FitWidth from '../../components/FitWidth/FitWidth';
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

/* "Manage event": one row of tabs; the picked section opens below it */
const MANAGE = [
  ['details',       'Edit details'],
  ['form',          'Galore form'],
  ['activities',    'Activities'],
  ['results',       'Results'],
];

export default function GaloreHead({ eventId, section = 'manage' }) {
  const [details, setDetails] = useState(null);
  /* which tab is open on "Manage event" (kept while moving between pages) */
  const [sub, setSub] = useState(MANAGE[0][0]);
  const [form,    setForm]    = useState(null);   // server form (with who's assigned)
  const [regs,    setRegs]    = useState(null);
  const [error,   setError]   = useState('');
  const [toast,   setToast]   = useState('');

  const load = useCallback(() => {
    galoreApi.get(`/head/events/${eventId}`).then(d => { setDetails(d.details); setForm(d.form); }).catch(err => setError(err.message));
    galoreApi.get(`/head/events/${eventId}/registrations`).then(d => setRegs(d.registrations || [])).catch(err => setError(err.message));
  }, [eventId]);
  useEffect(() => { load(); }, [load]);
  useTeamsLive(null, load); // team counts on Activities stay current

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
      {/* publish / unpublish lives on the Manage event page only */}
      {section === 'manage' && (
        <PublishBar eventId={eventId} details={details} form={form} onChange={published => setDetails(d => ({ ...d, published }))} flash={flash} />
      )}
      {toast && <div className={s.ok}>{toast}</div>}

      {section === 'manage' && (
        <>
          <ManageTabs active={sub} onPick={setSub} />
          <ManageSection sub={sub} eventId={eventId} details={details} form={form} activities={activities} regs={regs}
            error={error} saveForm={saveForm} upload={uploadGuidelines} flash={flash} setDetails={setDetails} />
        </>
      )}
      {section === 'schedule' && <HeadSchedule eventId={eventId} form={form} flash={flash} />}
      {section === 'departments' && <Departments details={details} form={form} activities={activities} regs={regs} error={error} />}
    </div>
  );
}

/* ── Manage event: its sections in one row, each with an arrow on its right
   (like the dashboard switcher); the open one's arrow points up and it opens below ── */
function ManageTabs({ active, onPick }) {
  return (
    <div className={s.deptTabs} role="tablist" aria-label="Manage event">
      {MANAGE.map(([k, label]) => (
        <button key={k} type="button" role="tab" aria-selected={active === k} aria-expanded={active === k}
          className={`${s.deptTab} ${s.manageTab} ${active === k ? s.deptTabOn : ''}`} onClick={() => onPick(k)}>
          {label}
          <svg className={`${s.roleArrow} ${active === k ? s.roleArrowUp : ''}`} viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ))}
    </div>
  );
}

function ManageSection({ sub, eventId, details, form, activities, regs, error, saveForm, upload, flash, setDetails }) {
  if (sub === 'results') return <HeadResults eventId={eventId} form={form} title={details.title} />;
  if (sub === 'activities') return <GaloreActivities activities={activities} regs={regs} error={error} fileBase={details.title} />;
  if (sub === 'form') return <FormEditor eventId={eventId} form={form} onSave={saveForm} upload={upload} flash={flash} />;
  if (sub === 'details') return <DetailsEditor eventId={eventId} details={details} form={form} onSaved={d => setDetails(d)} onSave={saveForm} flash={flash} />;
  return null;
}

/* ── Results: winners and runners-up of every activity, by department ── */
function HeadResults({ eventId, form, title }) {
  const load = useCallback(() => galoreApi.get(`/head/events/${eventId}/results`), [eventId]);
  const save = useCallback((body) => galoreApi.put(`/head/events/${eventId}/results`, body), [eventId]);
  return <GaloreResults eventId={eventId} load={load} save={save} departments={form.departments.map(d => d.name)} fileBase={title} />;
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
  /* "Selected teams ▾" / "Selected duos ▾" / "Selected individuals ▾" beside each activity */
  const teamsOf = (id) => {
    const a = activities.find(x => String(x.id) === id);
    return a ? selectedLabel(unitOf(a)) : null;
  };

  return (
    <>
      {verify && (
        <div className={s.deptBar}>
          <div className={s.muted}>Check a participant by their ID card number.</div>
          <button type="button" className={s.primaryBtn} onClick={() => setVerify(false)}>← Back to departments</button>
        </div>
      )}

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
            <Label>Registrations</Label>
            {/* search + filters · the count · download on one row, then the table */}
            <DeptRegistrations key={active.key} deptName={active.name} rows={active.rows} order={order} fileBase={details.title}
              teamsOf={teamsOf} teamDept={active.name}
              extra={<button type="button" className={s.primaryBtn} style={{ width: 'auto' }} onClick={() => setVerify(true)}>Verify participant</button>} />
          </>
        )}
    </>
  );
}

/* ── Schedule page: what everyone sees, each activity's date / time / venue,
   and the fixtures (which team plays which, when and where) ── */
const SCHEDULE_TABS = [['view', 'Full schedule'], ['fixtures', 'Dates, venues & Fixtures']];
function HeadSchedule({ eventId, form, flash }) {
  const [tab, setTab] = useState('view');
  return (
    <>
      <div className={s.subTabs} role="tablist">
        {SCHEDULE_TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            className={`${s.subTab} ${tab === k ? s.subTabOn : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {/* the form can change in "dates & venues" — key so the view reloads with it */}
      {tab === 'view' && <ScheduleView showHidden key={JSON.stringify(form.categories.map(c => c.activities.map(a => [a.scheduleDate, a.reportingTime, a.time, a.duration, a.venue])))} eventId={eventId} />}
      {tab === 'fixtures' && <FixtureMaker eventId={eventId} flash={flash} />}
    </>
  );
}

/* ── Galore form: categories, activities, clubs, players, guidelines ── */
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
  /* no categories saved yet = a new form (departments may already be saved — they're the Coordinators page's) */
  const isEmpty = !form.categories.length;

  /* Start from the draft if there is one (nothing typed is ever lost), else
     the saved form, else — for a brand-new event — the usual template */
  useEffect(() => {
    let off = false;
    (async () => {
      const draft = await galoreApi.get(`/head/events/${eventId}/form-draft`).then(r => r.draft).catch(() => null);
      if (off) return;
      /* a draft with nothing typed in it (no category or activity named) doesn't
         count — a new event then still opens with the usual categories */
      const typed = (draft?.data?.categories || []).some(c => c.name?.trim() || (c.activities || []).some(a => a.title?.trim()));
      if (draft?.data && (typed || !isEmpty)) { setB(draft.data); setOrigin('draft'); setDraftAt(draft.updatedAt); return; }
      if (!isEmpty) { setB(toBuilder(form)); setOrigin('form'); return; }
      const t = await galoreApi.get(`/head/events/${eventId}/template`).catch(() => null);
      if (off) return;
      /* the usual categories and activities; departments already saved stay as they are */
      if (t) {
        const saved = toBuilder(form), tpl = toBuilder(t);
        setB({ ...saved, categories: tpl.categories, departments: saved.departments.length ? saved.departments : tpl.departments });
        setOrigin('template');
      }
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

  const problems = b ? formProblems(b) : [];
  const saveDraftNow = async () => {
    if (await keepDraft(b)) flash('Draft saved — finish it any time, then save the Galore form.');
    else setErr('Could not save the draft — check your connection and try again.');
  };
  const save = async () => {
    if (problems.length) return setErr(problems[0]);
    setBusy(true); setErr('');
    try {
      /* coordinators and departments are the Coordinators page's — keep what's saved there */
      const { form: fresh } = await galoreApi.get(`/head/events/${eventId}`);
      await onSave(mergeForSave(fresh, b, 'form'), false, { clearDraft: true });
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
        <Notice>Started from the usual Galore departments, categories and activities — change, add or remove anything. Coordinators are assigned on the Coordinators page. Everything you type is kept as a draft as you go.</Notice>
      )}
      {(origin === 'draft' || draftAt) && (
        <Notice>
          You're editing a draft — it's kept as you type, so nothing is lost, but students and coordinators don't see it
          until you <strong>Save Galore form</strong> (that needs every field filled in).
          {!isEmpty && <> <button type="button" className={s.linkBtn} onClick={discardDraft}>Discard draft</button></>}
        </Notice>
      )}
      <GaloreFormBuilder value={b} onChange={change} clubs={staff.clubs || []} uploadGuidelines={upload} />
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
      <button className={s.primaryBtn} style={{ width: 'auto' }} disabled={busy || !ready} onClick={() => set(true)}>
        {busy ? 'Publishing…' : 'Publish Galore'}
      </button>
    </div>
  );
}
