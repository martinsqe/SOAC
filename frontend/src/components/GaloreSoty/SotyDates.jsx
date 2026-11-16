import { useState } from 'react';
import { sotyStatus } from '../../utils/galoreDeadline';
import s from './GaloreSoty.module.css';

/* Student of the Year — when entries are taken: the day registration opens and
   the last date of registration. Set by the admin or the main Galore
   coordinator. Before the opening day students only see "Registration will open
   soon, check back later".
   onSave({ opensOn, deadline }) → the saved contest */
export default function SotyDates({ contest, onSave }) {
  const [opensOn,  setOpensOn]  = useState(contest.opensOn || '');
  const [deadline, setDeadline] = useState(contest.deadline || '');
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');
  const [ok,    setOk]    = useState('');
  /* keep in step when the dates change elsewhere (e.g. the line under the strip) */
  const [seen, setSeen] = useState(`${contest.opensOn}|${contest.deadline}`);
  const now = `${contest.opensOn}|${contest.deadline}`;
  if (now !== seen) { setSeen(now); setOpensOn(contest.opensOn || ''); setDeadline(contest.deadline || ''); }

  const changed = opensOn !== (contest.opensOn || '') || deadline !== (contest.deadline || '');
  const orderBad = opensOn && deadline && deadline < opensOn;

  const save = async (e) => {
    e.preventDefault();
    if (orderBad) return setError('The last date of registration must be on or after the day registration opens.');
    setBusy(true); setError(''); setOk('');
    try {
      await onSave({ opensOn, deadline });
      setOk(!opensOn ? 'Saved — set the day registration opens; until then students see “Registration will open soon”.' : 'Registration dates saved.');
    } catch (ex) { setError(ex.message); }
    finally { setBusy(false); }
  };

  return (
    <form className={s.dates} onSubmit={save}>
      <div className={s.datesHead}>
        <h3 className={s.datesTitle}>Registration dates</h3>
        <p className={s.muted}>{sotyStatus(contest)}</p>
      </div>
      <div className={s.datesRow}>
        <label className={s.datesField}>
          <span>Registration opens on</span>
          <input type="date" className={s.input} value={opensOn} onChange={e => { setOpensOn(e.target.value); setOk(''); }} />
        </label>
        <label className={s.datesField}>
          <span>Last date of registration</span>
          <input type="date" className={s.input} value={deadline} min={opensOn || undefined}
            onChange={e => { setDeadline(e.target.value); setOk(''); }} />
        </label>
        <button type="submit" className={s.submit} disabled={busy || !changed || orderBad}>{busy ? 'Saving…' : 'Save dates'}</button>
      </div>
      {orderBad && <div className={s.error}>The last date of registration must be on or after the day registration opens.</div>}
      {error && <div className={s.error} role="alert">{error}</div>}
      {ok && <div className={s.ok} role="status">{ok}</div>}
    </form>
  );
}
