import { useState, useRef } from 'react';
import s from './GaloreSoty.module.css';

/* Student of the Year — what a student sees once the admin publishes it.
   They're already logged in, so Enrollment No. down to School come from their
   university record; they fill in the rest. Saving again updates their entry
   (until submissions close). onSubmit(FormData) → the saved entry. */
const MAX = 500;
const MAX_MB = 10;

export default function SotyForm({ contest, identity, entry, onSubmit }) {
  const [v, setV] = useState(() => ({
    evenAttendance: entry?.evenAttendance ?? '', oddAttendance: entry?.oddAttendance ?? '',
    evenScore: entry?.evenScore ?? '', oddScore: entry?.oddScore ?? '',
    mobile: entry?.mobile || identity.phone || '', contactEmail: entry?.contactEmail || '',
    achievements: entry?.achievements || '', reason: entry?.reason || '',
  }));
  const [file,  setFile]  = useState(null);
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const fileRef = useRef(null);
  const closed = contest.closed || contest.deadlinePassed;
  const set = (k) => (e) => { setV(o => ({ ...o, [k]: e.target.value })); setSaved(''); };

  const pickFile = (e) => {
    const f = e.target.files?.[0] || null;
    setSaved('');
    if (f && !/\.pdf$/i.test(f.name)) { setError('Choose a single PDF file.'); e.target.value = ''; return; }
    if (f && f.size > MAX_MB * 1024 * 1024) { setError(`The PDF must be ${MAX_MB} MB or smaller.`); e.target.value = ''; return; }
    setError(''); setFile(f);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file && !entry?.document) return setError('Upload your important documents as one PDF file.');
    setBusy(true); setError(''); setSaved('');
    const fd = new FormData();
    Object.entries(v).forEach(([k, val]) => fd.append(k, String(val)));
    if (file) fd.append('document', file);
    try {
      await onSubmit(fd);
      setFile(null); if (fileRef.current) fileRef.current.value = '';
      setSaved(entry ? 'Your entry has been updated.' : 'Your entry has been submitted. You can change it until the last date of registration.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const year = contest.academicYear || 'this year';
  return (
    <form className={s.form} onSubmit={submit} noValidate>
      <h2 className={s.title}>{contest.title}</h2>
      {closed
        ? <p className={s.note}>{contest.deadlinePassed ? 'The last date of registration has passed' : 'Registration is closed'}{entry ? ' — this is the entry you submitted.' : '.'}</p>
        : entry
          ? <p className={s.note}>You entered on <strong>{new Date(entry.submittedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>. Change anything below and submit again to update it.</p>
          : <p className={s.note}>Fill in the details below and submit to enter.</p>}

      {error && <div className={s.error} role="alert">{error}</div>}
      {saved && <div className={s.ok} role="status">{saved}</div>}

      {/* who they are — from their university record, not editable */}
      <div className={s.row}>
        <label className={s.label} htmlFor="soty-enr">Enrollment No:</label>
        <div className={s.field}><input id="soty-enr" className={s.input} value={identity.enrollmentNo} readOnly /></div>
      </div>
      <div className={s.idRows}>
        {[['Name', identity.name], ['Branch', identity.branch], ['Semester', identity.semester], ['Gender', identity.gender], ['School', identity.school]].map(([k, val]) => (
          <div key={k} className={`${s.row} ${s.idRow}`}>
            <span className={s.label}>{k} :</span>
            <span className={s.idValue}>{val || '—'}</span>
          </div>
        ))}
      </div>

      <Pct id="even-att" label="Even Sem Attendance :" value={v.evenAttendance} onChange={set('evenAttendance')} disabled={closed} />
      <Pct id="odd-att"  label="Odd Sem Attendance :"  value={v.oddAttendance}  onChange={set('oddAttendance')}  disabled={closed} />
      <Pct id="even-cg"  label="Even Sem CGPA/PERCENTAGE" value={v.evenScore} onChange={set('evenScore')} disabled={closed} unit="%" />
      <Pct id="odd-cg"   label="Odd Sem CGPA/PERCENTAGE"  value={v.oddScore}  onChange={set('oddScore')}  disabled={closed} unit="%" />

      <div className={s.row}>
        <label className={s.label} htmlFor="soty-mob">Mobile No :</label>
        <div className={s.field}>
          <input id="soty-mob" className={s.input} type="tel" inputMode="numeric" autoComplete="tel" maxLength={15}
            value={v.mobile} onChange={set('mobile')} disabled={closed} />
        </div>
      </div>
      <div className={s.row}>
        <label className={s.label} htmlFor="soty-email">Email Id :</label>
        <div className={s.field}>
          <input id="soty-email" className={s.input} type="email" autoComplete="email" maxLength={255}
            value={v.contactEmail} onChange={set('contactEmail')} disabled={closed} />
        </div>
      </div>

      <Long id="soty-ach" label="Details about Co-curricular Activities/Special achievements :"
        value={v.achievements} onChange={set('achievements')} disabled={closed} />
      <Long id="soty-why" label={`Why do you think, you are the right contestant for the award of the best student of year ${year}?`}
        value={v.reason} onChange={set('reason')} disabled={closed} />

      <div className={s.row}>
        <label className={s.label} htmlFor="soty-doc">
          Upload your important documents(Single pdf file having all documents) File Size Limited to {MAX_MB}MB:
        </label>
        <div className={s.field}>
          <div className={s.file}>
            <button type="button" className={s.fileBtn} onClick={() => fileRef.current?.click()} disabled={closed}>Choose file</button>
            <span className={s.fileName}>{file ? file.name : 'No file chosen'}</span>
            <input id="soty-doc" ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={pickFile} />
          </div>
          {entry?.document && (
            <div className={s.fileOnRecord}>
              On file: <a href={entry.document.url} target="_blank" rel="noreferrer">{entry.document.name}</a>
              {!closed && ' — choose a new file only to replace it.'}
            </div>
          )}
        </div>
      </div>

      {!closed && (
        <div className={s.submitRow}>
          <span />
          <button type="submit" className={s.submit} disabled={busy}>{busy ? 'Submitting…' : entry ? 'Update' : 'Submit'}</button>
        </div>
      )}
    </form>
  );
}

/* a 1–100 value (attendance, CGPA or percentage) */
function Pct({ id, label, value, onChange, disabled, unit }) {
  return (
    <div className={s.row}>
      <label className={s.label} htmlFor={`soty-${id}`}>{label}</label>
      <div className={s.field}>
        <div className={s.withUnit}>
          <input id={`soty-${id}`} className={s.input} type="number" inputMode="decimal" min="1" max="100" step="0.01"
            value={value} onChange={onChange} disabled={disabled} />
          {unit && <span className={s.unit}>{unit}</span>}
        </div>
        <div className={s.hint}>Value must be between 1 to 100</div>
      </div>
    </div>
  );
}

/* up to 500 characters */
function Long({ id, label, value, onChange, disabled }) {
  const n = value.length;
  return (
    <div className={s.row}>
      <label className={s.label} htmlFor={id}>{label}</label>
      <div className={s.field}>
        <textarea id={id} className={s.textarea} maxLength={MAX} value={value} onChange={onChange} disabled={disabled} />
        <div className={s.hint}>
          Maximum {MAX} characters are allowed.
          <span className={`${s.count} ${n >= MAX ? s.countOver : ''}`}>{n}/{MAX}</span>
        </div>
      </div>
    </div>
  );
}
