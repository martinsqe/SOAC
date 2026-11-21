import { useState } from 'react';
import { deadlineSentence, isIsoDate } from '../../utils/galoreDeadline';
import FitWidth from '../FitWidth/FitWidth';
import { isPhoneScreen } from '../../utils/useDesktopViewport';
import s from './GaloreLetterhead.module.css';

/* The Galore letterhead — one look for every Galore screen (admin, portal roles,
   login): the four logos on white, a grey nav strip whose pages differ per role,
   the "last date of registration" statement, then the page's content — all on
   white except the strip.

     nav        [[key, label, action?], …] — omit for no strip (e.g. the login page);
                an item with an action (e.g. Log out) runs it instead of switching page
     active     key of the page showing
     onNav      (key) => void
     deadline   the statement shown under the strip ('' = nothing shown)
     onSaveDeadline  async (text) => void — given only where it's editable (admin)
     stripEnd   extra element at the end of the strip (e.g. Log out)
     plain      no card edge / shadow — for a page that is already all white */
/* Each logo's width is a fixed share of the row (see .logo1–.logo4), so the
   row keeps exactly the same proportions on every screen — it only gets
   bigger or smaller as a whole. */
const LOGOS = [
  { src: '/galore/letterhead-1.webp', w: 443, cls: 'logo1', alt: '' },
  { src: '/galore/letterhead-2.webp', w: 552, cls: 'logo2', alt: 'RK University' },
  { src: '/galore/letterhead-3.webp', w: 395, cls: 'logo3', alt: 'Galore' },
  { src: '/galore/letterhead-4.webp', w: 395, cls: 'logo4', alt: '' },
];

export function GaloreLogos({ className = '' }) {
  return (
    <div className={`${s.logos} ${className}`}>
      {LOGOS.map(l => (
        <img key={l.src} src={l.src} alt={l.alt} aria-hidden={l.alt ? undefined : true}
          width={l.w} height={300} className={s[l.cls]} />
      ))}
    </div>
  );
}

/* deadlineNote: plain words shown in the deadline's place when there's no date
   (e.g. "Registrations will be opened soon") */
export default function GaloreLetterhead({ nav, active, onNav, deadline = '', deadlineNote = '', onSaveDeadline, stripEnd, plain = false, children }) {
  return (
    <div className={`${s.sheet} ${plain ? s.plain : ''}`}>
      <GaloreLogos />

      {nav?.length > 0 && (
        <nav className={s.strip} aria-label="Galore pages">
          {/* phones: the row fills the strip's width, its words as large as fit on one line */}
          <FitWidth maxScale={isPhoneScreen() ? 1.6 : 1}><div className={s.stripInner}>
            {nav.map(([key, label, action]) => (
              <button key={key} type="button" data-label={label}
                className={`${s.navBtn} ${active === key ? s.navOn : ''}`}
                aria-current={active === key ? 'page' : undefined}
                onClick={() => (action ? action() : onNav?.(key))}>
                {label}
              </button>
            ))}
            {stripEnd}
          </div></FitWidth>
        </nav>
      )}

      {deadlineNote && !deadline && !onSaveDeadline
        ? <p className={s.deadline}>{deadlineNote}</p>
        : <Deadline text={deadline} onSave={onSaveDeadline} />}

      <div className={s.body}>{children}</div>
    </div>
  );
}

/* text = the stored date (YYYY-MM-DD; older free text still shows), always shown
   as "Last date of registration is 17th January, 2027". The admin picks the date. */
function Deadline({ text, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState('');
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');
  const sentence = deadlineSentence(text);

  if (!onSave) return sentence ? <p className={s.deadline}>{sentence}</p> : <div className={s.deadlineGap} />;

  if (editing) {
    const save = async (value) => {
      setBusy(true); setErr('');
      try { await onSave(value); setEditing(false); }
      catch (ex) { setErr(ex.message || 'Could not save.'); }
      finally { setBusy(false); }
    };
    return (
      <form className={s.deadlineEdit} onSubmit={(e) => { e.preventDefault(); if (draft) save(draft); else setErr('Pick the last date.'); }}>
        <label className={s.deadlineLabel} htmlFor="galore-deadline">Last date of registration is</label>
        <input id="galore-deadline" type="date" autoFocus value={draft} onChange={e => { setDraft(e.target.value); setErr(''); }} />
        <button type="submit" className={s.deadlineSave} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        {text && <button type="button" className={s.deadlineLink} disabled={busy} onClick={() => save('')}>Remove</button>}
        <button type="button" className={s.deadlineLink} disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
        {err && <span className={s.deadlineErr}>{err}</span>}
      </form>
    );
  }

  const start = () => { setDraft(isIsoDate(text) ? text : ''); setErr(''); setEditing(true); };
  return sentence ? (
    <p className={s.deadline}>
      {sentence} <button type="button" className={s.deadlineLink} onClick={start}>Edit</button>
    </p>
  ) : (
    <p className={s.deadline}>
      <button type="button" className={s.deadlineLink} onClick={start}>+ Add the last date of registration</button>
    </p>
  );
}
