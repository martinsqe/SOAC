import { useState, useEffect } from 'react';
import { galoreApi } from '../../utils/galoreApi';
import { toBuilder, toPayload, coordProblems, mergeForSave } from '../../utils/galoreForm';
import { GaloreCoordinatorsBuilder } from '../Admin/GaloreFormBuilder';
import { Notice } from './GaloreUI';
import s from './Galore.module.css';

/* Main coordinator, Coordinators page → Assign coordinators: departments (add /
   remove) with their coordinators, and each activity's coordinator. Saved on
   top of the latest Galore form, so the categories and activities stay as
   they are. Works any time — also after Galore is published and open. */
export default function AssignCoordinators({ eventId, onClose }) {
  const [b,    setB]    = useState(null);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const [noForm, setNoForm] = useState(false);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const { form } = await galoreApi.get(`/head/events/${eventId}`);
        if (off) return;
        if (!form.categories.length) { setNoForm(true); return; }
        setB(toBuilder(form));
      } catch (ex) { if (!off) setErr(ex.message); }
    })();
    return () => { off = true; };
  }, [eventId]);

  const problems = b ? coordProblems(b) : [];
  const save = async () => {
    if (problems.length) return setErr(problems[0]);
    setBusy(true); setErr('');
    try {
      const { form: fresh } = await galoreApi.get(`/head/events/${eventId}`);
      await galoreApi.put(`/head/events/${eventId}/form`, { form: toPayload(mergeForSave(fresh, b, 'coords')) });
      onClose(true);
    } catch (ex) { setErr(ex.message); setBusy(false); }
  };

  return (
    <div className={s.card}>
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <h2 className={s.cardTitle}>Assign coordinators</h2>
        <div className={s.muted}>Anyone left blank can be assigned later — new coordinators are emailed their Galore portal login when you save.</div>
      </div>
      {noForm && <Notice>Save the Galore form first (Manage event → Galore form) — then assign coordinators to its departments and activities here.</Notice>}
      {!b && !noForm && !err && <div className={s.muted}>Loading…</div>}
      {b && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <GaloreCoordinatorsBuilder value={b} onChange={setB} />
          {problems.length > 0 && <div style={{ fontSize: '.8rem', color: '#dc2626' }}>Still needed before saving: {problems.slice(0, 3).join(' ')}</div>}
        </div>
      )}
      {err && <div className={s.error} style={{ marginTop: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
        {b && <button type="button" className={s.primaryBtn} disabled={busy || problems.length > 0} onClick={save}>{busy ? 'Saving…' : 'Save coordinators'}</button>}
        <button type="button" className={s.smallBtn} disabled={busy} onClick={() => onClose(false)}>Cancel</button>
      </div>
    </div>
  );
}
