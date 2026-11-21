import { useState, useEffect, useCallback } from 'react';
import { galoreApi } from '../../utils/galoreApi';
import styles from '../Events/Events.module.css';
import s from './Galore.module.css';

/* Student → Event selection → Activity selection. The same verified details
   and activity checklist the Events page used to show, now inside the portal:
   the student's own university record (from their login), any missing mobile /
   gender, then one section per category with its maximum picks. Confirming
   registers them — once only. Already registered: their details and the
   activities they're registered for. */
const EMPTY = { phone: '', gender: '', activityIds: [] };

export default function GaloreActivitySelection({ eventId, onRegistered }) {
  const [data, setData] = useState(null);
  const [err,  setErr]  = useState('');
  const [form, setForm] = useState(EMPTY);
  const [fieldErr, setFieldErr] = useState({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    galoreApi.get(`/student/events/${eventId}/selection`).then(d => { setData(d); setErr(''); })
      .catch(ex => setErr(ex.message || 'Could not load the activities.'));
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  if (!data) return err ? <div className={s.error}>{err}</div> : <div className={s.muted}>Loading…</div>;

  const v = data.verified || {};
  const cats = data.categories || [];
  const acts = cats.flatMap(c => c.activities || []);
  const registered = data.registered || [];
  const catOf = (id) => acts.find(a => a.id === id)?.categoryId;
  const catCount = (catId) => form.activityIds.filter(id => catOf(id) === catId).length;
  const toggle = (act) => setForm(p => {
    if (p.activityIds.includes(act.id)) return { ...p, activityIds: p.activityIds.filter(id => id !== act.id) };
    const max = Number(cats.find(c => c.id === act.categoryId)?.maxPicks || 0);
    if (max && catCount(act.categoryId) >= max) return p; // at this category's cap
    return { ...p, activityIds: [...p.activityIds, act.id] };
  });
  const set = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const fe = {};
    if (!v.phone) {
      const digits = form.phone.replace(/[\s\-+]/g, '').replace(/^91/, '');
      if (!form.phone.trim()) fe.phone = 'Mobile number is required.';
      else if (!/^\d{10}$/.test(digits)) fe.phone = 'Enter a valid 10-digit mobile number.';
    }
    if (!v.gender && !form.gender) fe.gender = 'Gender is required.';
    if (!form.activityIds.length) fe.activities = 'Select at least one activity.';
    setFieldErr(fe); setErr('');
    if (Object.keys(fe).length) return;
    setBusy(true);
    try {
      await galoreApi.post(`/student/events/${eventId}/register`, { activityIds: form.activityIds, phone: form.phone, gender: form.gender });
      setForm(EMPTY);
      load();
      onRegistered?.();
    } catch (ex) { setErr(ex.message || 'Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  };

  /* ── Verified details — straight from the university record, not editable ── */
  const details = (
    <div className={styles.galoreInfo}>
      <div className={styles.galoreInfoRow}>
        <span style={{ fontWeight: 700, color: '#166534', fontSize: 13 }}>✓ Verified</span>
      </div>
      {[
        ['Name', v.name],
        ['Enrollment No.', v.enrollmentNo || 'Not issued yet'],
        ['Admission No.', v.admissionNo],
        ['Department', [v.department, v.subDepartment].filter(Boolean).join(' · ')],
        ['Program', v.program],
        ['Semester', v.semester],
        ['Division', v.division],
        ['Email', v.email],
        ...(v.phone ? [['Mobile', v.phone]] : []),
        ...(v.gender ? [['Gender', v.gender === 'F' ? 'Female' : 'Male']] : []),
      ].map(([k, val]) => (
        <div key={k} className={styles.galoreInfoRow}>
          <span className={styles.galoreInfoLabel}>{k}</span>
          <span className={styles.galoreInfoValue}>{val || '—'}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className={styles.galoreTheme} style={{ maxWidth: 640, margin: '0 auto' }}>
      {registered.length > 0 ? (
        <div className={styles.regForm}>
          {details}
          <div style={{ fontSize: '.95rem', color: '#1a1040', lineHeight: 1.55 }}>
            You're registered for <strong>{data.event.title}</strong> under the following activities:
            <ul style={{ margin: '8px 0 0', paddingLeft: 22 }}>
              {registered.map(a => <li key={a.id} style={{ fontWeight: 600, marginBottom: 4 }}>{a.title}</li>)}
            </ul>
          </div>
        </div>
      ) : (
        <form className={styles.regForm} onSubmit={submit} noValidate>
          {details}
          {data.event.closed ? (
            <div className={styles.regApiErr}>Registrations for {data.event.title} are closed.</div>
          ) : !data.departmentOk ? (
            <div className={styles.regApiErr}>Your department ({v.department}) isn't taking part in {data.event.title}.</div>
          ) : (
            <>
              {(!v.phone || !v.gender) && (
                <div className={styles.regRow}>
                  {!v.phone && (
                    <div className={styles.regField}>
                      <label htmlFor="sel-phone">Mobile Number <span className={styles.req}>*</span></label>
                      <input id="sel-phone" type="tel" placeholder="e.g. 9876543210" value={form.phone} onChange={set('phone')} className={fieldErr.phone ? styles.regInputErr : ''} />
                      {fieldErr.phone && <span className={styles.regErrMsg}>{fieldErr.phone}</span>}
                    </div>
                  )}
                  {!v.gender && (
                    <div className={styles.regField}>
                      <label htmlFor="sel-gender">Gender <span className={styles.req}>*</span></label>
                      <select id="sel-gender" value={form.gender} onChange={set('gender')} className={fieldErr.gender ? styles.regInputErr : ''}>
                        <option value="">Select gender</option>
                        <option value="M">M</option>
                        <option value="F">F</option>
                      </select>
                      {fieldErr.gender && <span className={styles.regErrMsg}>{fieldErr.gender}</span>}
                    </div>
                  )}
                </div>
              )}

              {/* ── one section per category, each with its own max picks ── */}
              <div className={styles.regField}>
                <label>Activity selection <span className={styles.req}>*</span></label>
                {fieldErr.activities && <span className={styles.regErrMsg}>{fieldErr.activities}</span>}
                {cats.map(cat => {
                  const inCat = cat.activities || [];
                  if (!inCat.length) return null;
                  const count = catCount(cat.id);
                  const max = Number(cat.maxPicks || 0);
                  return (
                    <div key={cat.id} style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                        {cat.name}
                        {max > 0 && <span style={{ marginLeft: 8, textTransform: 'none', fontWeight: 800 }}>maximum {max}</span>}
                        <span style={{ marginLeft: 8, color: '#9ca3af', fontWeight: 500, textTransform: 'none' }}>
                          ({max ? `${count}/${max} selected` : `${count} selected`})
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
                        {inCat.map(act => {
                          const selected = form.activityIds.includes(act.id);
                          const disabled = !selected && ((max > 0 && count >= max) || act.registrationClosed);
                          return (
                            /* just the checkbox and the name — a picked one in green */
                            <label key={act.id} style={{
                              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', fontSize: '.83rem', fontWeight: 600,
                              lineHeight: 1.25, minHeight: 32, cursor: disabled ? 'not-allowed' : 'pointer',
                              opacity: disabled ? 0.5 : 1, color: selected ? '#16a34a' : '#374151',
                            }}>
                              <input type="checkbox" checked={selected} disabled={disabled} onChange={() => toggle(act)}
                                style={{ margin: 0, width: 16, height: 16, flex: '0 0 16px', accentColor: '#16a34a' }} />
                              <span>{act.title}{act.registrationClosed ? ' (Closed)' : ''}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {err && <div className={styles.regApiErr}>{err}</div>}
              <div style={{ fontSize: '.8rem', color: '#6b7280' }}>Registration is once only — check your activities before confirming.</div>
              <button type="submit" className={styles.regSubmitBtn} disabled={busy}>
                {busy ? 'Submitting…' : 'Confirm Registration →'}
              </button>
            </>
          )}
        </form>
      )}
    </div>
  );
}
