import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import GaloreFormBuilder from './GaloreFormBuilder';
import { toBuilder, toPayload, formProblems, mergeForSave } from '../../utils/galoreForm';
import s from './AdminEvents.module.css';

/* Admin → Galore → Manage Event → Galore form: the same form the main Galore
   coordinator edits in the portal — categories, activities, the club
   responsible for each, individual / duo / team with its players, and
   guidelines. Departments and coordinators stay as they are (the main
   coordinator assigns them on their Coordinators page). A form with no
   categories yet starts from the usual ones. */
export default function AdminGaloreForm({ event, clubs = [], onSaved, showToast }) {
  const [b,      setB]      = useState(null);
  const [origin, setOrigin] = useState('form');   // 'form' | 'template'
  const [dirty,  setDirty]  = useState(false);
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState('');

  const start = useCallback(async () => {
    setErr(''); setDirty(false);
    try {
      const form = await api.get(`/events/${event._id}/galore-setup`);
      if (form.categories?.length) { setB(toBuilder(form)); setOrigin('form'); return; }
      const t = await api.get('/events/galore/template').catch(() => null);
      const saved = toBuilder(form);
      setB(t ? { ...saved, categories: toBuilder(t).categories } : saved);
      setOrigin(t ? 'template' : 'form');
    } catch (ex) { setErr(ex.message || 'Could not load the Galore form.'); }
  }, [event._id]);
  useEffect(() => { start(); }, [start]);

  /* leaving with unsaved changes asks first */
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const change = (next) => { setB(next); setDirty(true); setErr(''); };
  const problems = b ? formProblems(b) : [];

  const save = async () => {
    if (problems.length) return setErr(problems[0]);
    setBusy(true); setErr('');
    try {
      /* departments and coordinators: whatever is saved now */
      const fresh = await api.get(`/events/${event._id}/galore-setup`);
      const saved = await api.put(`/events/${event._id}/galore-form`, { form: toPayload(mergeForSave(fresh, b, 'form')) });
      setB(toBuilder(saved)); setOrigin('form'); setDirty(false);
      onSaved?.(saved);
      showToast?.('Galore form saved — everyone assigned has been emailed the update.');
    } catch (ex) { setErr(ex.message || 'Failed to save.'); }
    finally { setBusy(false); }
  };

  if (!b) return err ? <div className={s.formError}>{err}</div> : <div className={s.regsEmpty}>Loading…</div>;

  return (
    <div className={s.form} style={{ padding: 0 }}>
      <div className={s.galoreSheet}>
        {origin === 'template' && (
          <div style={{ fontSize: '.8rem', color: '#6b7280' }}>
            Started from the usual categories and activities — change, add or remove anything, then save. Coordinators are assigned by the main
            Galore coordinator on their Coordinators page.
          </div>
        )}
        <GaloreFormBuilder value={b} onChange={change} clubs={clubs} />
        {problems.length > 0 && <div style={{ fontSize: '.76rem', color: '#dc2626' }}>Still needed: {problems.slice(0, 3).join(' ')}</div>}
        {err && <div className={s.formError}>{err}</div>}
      </div>
      <div className={s.modalFooter}>
        <button type="button" className={s.cancelBtn} disabled={busy || !dirty} onClick={start}>Discard changes</button>
        <button type="button" className={s.saveBtn} disabled={busy || problems.length > 0} onClick={save}>
          {busy ? 'Saving…' : 'Save Galore form'}
        </button>
      </div>
    </div>
  );
}
