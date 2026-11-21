import { useState } from 'react';
import { sotyLine } from '../../utils/galoreDeadline';
import s from './GaloreSoty.module.css';

/* Student of the Year — when entries are taken, for the admin and the main
   Galore coordinator: one Open / Close button (Open takes entries from today,
   Close stops them) and the last date of registration. The line above says what
   students see. onSave({ opensOn?, deadline?, closed? }) → the saved contest. */
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export default function SotyDates({ contest, onSave }) {
  const [deadline, setDeadline] = useState(contest.deadline || '');
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');
  const [ok,    setOk]    = useState('');
  /* keep in step when the date changes elsewhere */
  const [seen, setSeen] = useState(contest.deadline || '');
  if ((contest.deadline || '') !== seen) { setSeen(contest.deadline || ''); setDeadline(contest.deadline || ''); }

  const isOpen = contest.opened && !contest.deadlinePassed;
  const run = async (patch, done) => {
    setBusy(true); setError(''); setOk('');
    try { await onSave(patch); setOk(done); }
    catch (ex) { setError(ex.message); }
    finally { setBusy(false); }
  };
  return (
    <form className={s.dates} onSubmit={(e) => { e.preventDefault(); run({ deadline }, 'Last date of registration saved.'); }}>
      <div className={s.datesHead}>
        <h3 className={s.datesTitle}>Registration</h3>
        <p className={s.muted}>Students see: “{sotyLine(contest)}”</p>
      </div>
      <div className={s.datesRow}>
        {/* Open / Close first, on the left */}
        <button type="button" className={isOpen ? s.btn : s.submit} disabled={busy || (!isOpen && contest.deadlinePassed)}
          title={!isOpen && contest.deadlinePassed ? 'Set a later last date first' : undefined}
          onClick={() => (isOpen
            ? run({ closed: true }, 'Registration closed.')
            : run({ closed: false, opensOn: contest.opensOn && contest.opensOn <= todayIso() ? contest.opensOn : todayIso() }, 'Registration is open.'))}>
          {isOpen ? 'Close registration' : 'Open registration'}
        </button>
        <label className={s.datesField}>
          <span>Last date of registration</span>
          <input type="date" className={s.input} value={deadline} onChange={e => { setDeadline(e.target.value); setOk(''); }} />
        </label>
        <button type="submit" className={s.submit} disabled={busy || deadline === (contest.deadline || '')}>{busy ? 'Saving…' : 'Save date'}</button>
      </div>
      {error && <div className={s.error} role="alert">{error}</div>}
      {ok && <div className={s.ok} role="status">{ok}</div>}
    </form>
  );
}
