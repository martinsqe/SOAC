import { useState, useMemo, useEffect } from 'react';
import SotyDocument, { SotyDocumentView } from './SotyDocument';
import { docFromEntry, docFileName } from '../../utils/sotyDoc';
import s from './GaloreSoty.module.css';

/* Student of the Year — what a student sees once the admin publishes it.
   They're already logged in, so Enrollment No. down to School come from their
   university record; they fill in the rest, then Review: the entry as the
   finished document on the Galore letterhead. Submit from there — it's final:
   the form then closes (from Even Sem Attendance down) and shows "You're
   registered" with the submitted file, viewable but not editable.
   onSubmit(FormData) → the saved entry. */
const MAX = 500;
const MAX_MB = 10;      // each activity's evidence file
const MAX_WORDS = 30;   // each activity's description
const MAX_ACTS = 15;
const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
let keySeq = 0;
const newKey = () => `a${Date.now().toString(36)}${keySeq++}`;
const blankAct = () => ({ key: newKey(), id: null, title: '', description: '', file: null, onFile: null });

export default function SotyForm({ contest, identity, entry, onSubmit }) {
  const [v, setV] = useState(() => ({
    evenAttendance: entry?.evenAttendance ?? '', oddAttendance: entry?.oddAttendance ?? '',
    evenScore: entry?.evenScore ?? '', oddScore: entry?.oddScore ?? '',
    mobile: entry?.mobile || identity.phone || '', contactEmail: entry?.contactEmail || '',
    reason: entry?.reason || '',
  }));
  /* co-curricular activities / achievements: title, ≤ 30-word description, one evidence file each */
  const [acts, setActs] = useState(() => (entry?.activities?.length
    ? entry.activities.map(a => ({ key: newKey(), id: a.id, title: a.title, description: a.description, file: null, onFile: a.file }))
    : [blankAct()]));
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [review, setReview] = useState(false);   // showing the document before submitting
  const [mine, setMine] = useState(entry || null); // the submitted entry (final)
  const [showFile, setShowFile] = useState(false); // the submitted file opens only when clicked
  const closed = contest.closed || contest.deadlinePassed;
  const set = (k) => (e) => { setV(o => ({ ...o, [k]: e.target.value })); setSaved(''); };
  const setAct = (key, patch) => { setActs(list => list.map(a => (a.key === key ? { ...a, ...patch } : a))); setSaved(''); };

  /* A file is only taken if the server would take it — the right kind, size, and
     really what its name says (its first bytes are a PDF, PNG or JPEG). Anything
     else is refused here, so it never reaches the review: whatever the review
     shows is what gets submitted. */
  const pickFile = (key) => async (e) => {
    const f = e.target.files?.[0] || null;
    e.target.value = '';
    if (!f) return;
    const refuse = (msg) => { setError(`${f.name}: ${msg} It wasn’t added.`); };
    if (!/\.(pdf|jpe?g|png)$/i.test(f.name)) return refuse('only PDF, JPG or PNG files can be attached.');
    if (f.size === 0) return refuse('the file is empty.');
    if (f.size > MAX_MB * 1024 * 1024) return refuse(`files must be ${MAX_MB} MB or smaller.`);
    let b;
    try { b = new Uint8Array(await f.slice(0, 8).arrayBuffer()); } catch { return refuse('the file could not be read.'); }
    const isPdf = b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d; // %PDF-
    const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    const isJpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    const ok = /\.pdf$/i.test(f.name) ? isPdf : /\.png$/i.test(f.name) ? isPng : isJpg;
    if (!ok) return refuse('it isn’t a real file of that type (it may be renamed or damaged).');
    setError(''); setAct(key, { file: f });
  };

  /* everything filled in properly? '' when it is */
  const problem = () => {
    const pct = [['evenAttendance', 'Even Sem Attendance'], ['oddAttendance', 'Odd Sem Attendance'], ['evenScore', 'Even Sem CGPA/Percentage'], ['oddScore', 'Odd Sem CGPA/Percentage']];
    for (const [k, label] of pct) {
      const n = Number(String(v[k]).trim());
      if (String(v[k]).trim() === '' || !Number.isFinite(n) || n < 1 || n > 100) return `${label}: value must be between 1 to 100.`;
    }
    if (!/^\d{10}$/.test(String(v.mobile).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''))) return 'Enter a 10-digit mobile number.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v.contactEmail).trim())) return 'Enter a valid email id.';
    if (!acts.length) return 'Add at least one co-curricular activity or special achievement.';
    for (const [i, a] of acts.entries()) {
      const name = a.title.trim() || `Activity ${i + 1}`;
      if (!a.title.trim()) return `Activity ${i + 1}: give it a title.`;
      if (!a.description.trim()) return `"${name}": add a short description.`;
      if (words(a.description) > MAX_WORDS) return `"${name}": the description can be at most ${MAX_WORDS} words.`;
      if (!a.file && !a.onFile) return `"${name}": attach a file as evidence.`;
    }
    if (!String(v.reason).trim()) return 'Say why you are the right contestant.';
    return '';
  };
  const goReview = (e) => {
    e.preventDefault();
    const p = problem();
    if (p) return setError(p);
    setError(''); setReview(true); window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /* the review document: the form as it will be submitted (local images shown from the device) */
  const previewUrls = useMemo(() => (review
    ? acts.map(a => (a.file && /\.(jpe?g|png)$/i.test(a.file.name) ? URL.createObjectURL(a.file) : null)) : []), [review, acts]);
  useEffect(() => () => previewUrls.forEach(u => u && URL.revokeObjectURL(u)), [previewUrls]);
  const preview = {
    title: contest.title, name: identity.name, department: identity.department || identity.school, semester: identity.semester,
    mobile: v.mobile, email: v.contactEmail,
    evenAttendance: v.evenAttendance, oddAttendance: v.oddAttendance, evenScore: v.evenScore, oddScore: v.oddScore, reason: v.reason,
    activities: acts.map((a, i) => ({
      title: a.title.trim(), description: a.description.trim(),
      file: a.file ? { name: a.file.name, url: previewUrls[i] || '', isImage: !!previewUrls[i] } : a.onFile,
    })),
  };

  const submit = async () => {
    setBusy(true); setError(''); setSaved('');
    const fd = new FormData();
    Object.entries(v).forEach(([k, val]) => fd.append(k, String(val)));
    fd.append('activities', JSON.stringify(acts.map(({ key, id, title, description }) => ({ key, id, title, description }))));
    acts.forEach(a => { if (a.file) fd.append(`file_${a.key}`, a.file); });
    try {
      const done = await onSubmit(fd);
      setMine(done?.entry || done);
      setReview(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const year = contest.academicYear || 'this year';

  /* Review: the document as it will be submitted */
  if (review && !mine) {
    return (
      <div className={s.form}>
        <h2 className={s.title}>Review your entry</h2>
        <p className={s.note}>This is the file the main coordinator and the admin will receive. Check it, then submit. Once submitted it can’t be changed.</p>
        {error && <div className={s.error} role="alert">{error}</div>}
        <div className={s.reviewBar}>
          <button type="button" className={s.btn} disabled={busy} onClick={() => setReview(false)}>← Back to edit</button>
          <button type="button" className={s.submit} style={{ width: 'auto' }} disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit'}</button>
        </div>
        <SotyDocument doc={preview} />
        <div className={s.reviewBar}>
          <button type="button" className={s.btn} disabled={busy} onClick={() => setReview(false)}>← Back to edit</button>
          <button type="button" className={s.submit} style={{ width: 'auto' }} disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit'}</button>
        </div>
      </div>
    );
  }

  return (
    <form className={s.form} onSubmit={goReview} noValidate>
      <h2 className={s.title}>{contest.title}</h2>
      {!mine && (closed
        ? <p className={s.note}>{contest.deadlinePassed ? 'The last date of registration has passed.' : 'Registration is closed.'}</p>
        : <p className={s.note}>Fill in the details below, then Review your entry before submitting it.</p>)}

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

      {/* submitted: the form closes here — "You're registered" and the file, view only */}
      {mine && (
        <>
          <p className={s.registered} role="status">You’re registered for {contest.title}.</p>
          <div style={{ textAlign: 'center', marginBottom: 10 }}>
            <button type="button" className={s.btn} aria-expanded={showFile} onClick={() => setShowFile(o => !o)}>
              {showFile ? 'Hide submitted file' : 'View submitted file'}
            </button>
          </div>
          {showFile && <SotyDocumentView doc={docFromEntry(contest, mine)} fileName={docFileName(docFromEntry(contest, mine))} />}
        </>
      )}

      {!mine && <>
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

      {/* co-curricular activities / special achievements — "+ Add activity", each with its evidence */}
      <div className={s.row}>
        <span className={s.label}>Details about Co-curricular Activities/Special achievements :</span>
        <div className={s.field}>
          {acts.map((a, i) => {
            const n = words(a.description);
            return (
              <div key={a.key} className={s.actBox}>
                {/* number · title · remove */}
                <div className={s.actTop}>
                  <span className={s.actNum}>{i + 1}</span>
                  <input className={s.actTitle} placeholder="Title, e.g. Inter-university football, gold medal" maxLength={150}
                    value={a.title} onChange={e => setAct(a.key, { title: e.target.value })} disabled={closed} aria-label={`Activity ${i + 1} title`} />
                  {!closed && acts.length > 1 && (
                    <button type="button" className={s.actX} title="Remove this activity" aria-label={`Remove activity ${i + 1}`}
                      onClick={() => { setActs(l => l.filter(x => x.key !== a.key)); setSaved(''); }}>×</button>
                  )}
                </div>
                <textarea className={s.actDesc} rows={2} placeholder={`Describe it in at most ${MAX_WORDS} words`}
                  value={a.description} onChange={e => setAct(a.key, { description: e.target.value })} disabled={closed} aria-label={`Activity ${i + 1} description`} />
                {/* evidence file · word count */}
                <div className={s.actFoot}>
                  <label className={s.actAttach} style={closed ? { opacity: .6, pointerEvents: 'none' } : undefined}>
                    {a.onFile || a.file ? 'Replace file' : 'Attach file'}
                    <input type="file" accept="application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png" hidden onChange={pickFile(a.key)} disabled={closed} />
                  </label>
                  <span className={s.actFileName} title={a.file?.name || a.onFile?.name || ''}>
                    {a.file ? a.file.name
                      : a.onFile ? (a.onFile.url ? <a href={a.onFile.url} target="_blank" rel="noreferrer">{a.onFile.name}</a> : a.onFile.name)
                      : `PDF, JPG or PNG · up to ${MAX_MB} MB`}
                  </span>
                  <span className={`${s.actCount} ${n > MAX_WORDS ? s.countOver : ''}`}>{n}/{MAX_WORDS} words</span>
                </div>
              </div>
            );
          })}
          {!closed && acts.length < MAX_ACTS && (
            <button type="button" className={s.actAdd} onClick={() => { setActs(l => [...l, blankAct()]); setSaved(''); }}>+ Add activity</button>
          )}
          {entry?.document && (
            <div className={s.fileOnRecord}>
              Documents sent earlier: <a href={entry.document.url} target="_blank" rel="noreferrer">{entry.document.name}</a>
            </div>
          )}
        </div>
      </div>
      <Long id="soty-why" label={`Why do you think, you are the right contestant for the award of the best student of year ${year}?`}
        value={v.reason} onChange={set('reason')} disabled={closed} />

      {!closed && (
        <div className={s.submitRow}>
          <span />
          <button type="submit" className={s.submit} disabled={busy}>Review</button>
        </div>
      )}
      </>}
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
