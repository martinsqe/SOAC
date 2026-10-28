import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api/client';
import s from './ActivityClaims.module.css';
import { CATEGORY_OPTIONS, RESULT_OPTIONS, RESULT_LABEL, openProof } from './activityClaimsUtils';

/* Student side of "missing activity" claims: the form to report an activity that
   was never recorded on SOAC (with proof), and the list of what they've reported
   and where each one stands. The club's Student Coordinator / Faculty Advisor
   verifies it on My Club → Student Activity; once approved it shows up in the
   normal My Activity view like any other event. */

/* A club's category → the activity category most likely to fit */
const CLUB_TO_CATEGORY = { sports: 'sports', cultural: 'cultural', social: 'community', academic: 'general' };

const PROOF_EXT   = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'webp'];
const PROOF_MAX   = 15 * 1024 * 1024;
const todayIso    = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtDate = (d) => d
  ? new Date(String(d).length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—';
const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const EMPTY = { clubId: '', title: '', category: '', result: 'participation', activityDate: '', venue: '', organizer: '', description: '' };

/* ── The "Add missing activity" form ── */
export function AddActivityModal({ onClose, onSubmitted }) {
  const [clubs,      setClubs]      = useState(null);
  const [form,       setForm]       = useState(EMPTY);
  const [file,       setFile]       = useState(null);
  const [preview,    setPreview]    = useState('');
  const [dragging,   setDragging]   = useState(false);
  const [error,      setError]      = useState('');
  const [saving,     setSaving]     = useState(false);
  const [done,       setDone]       = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    api.get('/student-activity/clubs')
      .then(r => setClubs(r.clubs || []))
      .catch(() => { setClubs([]); setError('Could not load clubs. Please close this and try again.'); });
  }, []);

  /* Esc closes; lock page scroll behind the modal */
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, saving]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const set = (k) => (e) => { setForm(f => ({ ...f, [k]: e.target.value })); setError(''); };

  const pickClub = (e) => {
    const clubId = e.target.value;
    const club = (clubs || []).find(c => c.id === clubId);
    setForm(f => ({
      ...f, clubId,
      /* Suggest a category from the club — only if the student hasn't chosen one */
      category: f.category || CLUB_TO_CATEGORY[club?.category] || 'general',
    }));
    setError('');
  };

  const takeFile = (f) => {
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!PROOF_EXT.includes(ext)) { setError('Proof must be a PDF, Word document or image (JPG, PNG, WEBP).'); return; }
    if (f.size > PROOF_MAX)       { setError('The proof file is too large — please keep it under 15 MB.'); return; }
    if (preview) URL.revokeObjectURL(preview);
    setPreview(['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? URL.createObjectURL(f) : '');
    setFile(f);
    setError('');
  };

  const clearFile = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview('');
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const validate = () => {
    if (!form.clubId)                              return 'Please choose the club this activity was with.';
    if (form.title.trim().length < 3)              return 'Please enter the name of the activity.';
    if (!form.category)                            return 'Please choose a category.';
    if (!form.activityDate)                        return 'Please enter the date of the activity.';
    if (form.activityDate > todayIso())            return 'The activity date cannot be in the future.';
    if (form.description.trim().length < 10)       return 'Please describe what you did (at least 10 characters).';
    if (!file)                                     return 'Please upload proof of the activity.';
    return '';
  };

  const submit = async (e) => {
    e.preventDefault();
    const msg = validate();
    if (msg) { setError(msg); return; }
    setSaving(true);
    setError('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, typeof v === 'string' ? v.trim() : v));
      fd.append('proof', file);
      const { claim } = await api.postForm('/student-activity', fd);
      setDone(claim);
      onSubmitted?.(claim);
    } catch (err) {
      setError(err.message || 'Could not submit your activity. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const myClubs    = (clubs || []).filter(c => c.isMember);
  const otherClubs = (clubs || []).filter(c => !c.isMember);

  return (
    <div className={s.backdrop} onClick={() => !saving && onClose()}>
      <div className={s.modal} role="dialog" aria-modal="true" aria-labelledby="add-activity-title" onClick={e => e.stopPropagation()}>
        <div className={s.head}>
          <div>
            <div className={s.headTag}>My Activity</div>
            <h2 id="add-activity-title" className={s.headTitle}>{done ? 'Submitted for review' : 'Add a missing activity'}</h2>
          </div>
          <button type="button" className={s.close} onClick={onClose} disabled={saving} aria-label="Close">✕</button>
        </div>

        {done ? (
          <div className={s.body}>
            <div className={s.doneIcon}>✓</div>
            <p className={s.doneText}>
              <strong>{done.title}</strong> has been sent to the Student Coordinator and Faculty Advisor
              of <strong>{done.clubName}</strong>. They'll check your proof, and you'll get an email and a
              notification as soon as it's added to your activity.
            </p>
            <div className={s.actions}>
              <button type="button" className={s.btnPrimary} onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <form className={s.body} onSubmit={submit} noValidate>
            <p className={s.intro}>
              Took part in something that isn't showing in your activity? Tell us about it and upload proof
              — the club's coordinators will verify it and add it to your record.
            </p>

            <label className={s.field}>
              <span className={s.label}>Club <em>*</em></span>
              <select className={s.input} value={form.clubId} onChange={pickClub} disabled={!clubs}>
                <option value="">{clubs ? 'Choose the club that ran the activity' : 'Loading clubs…'}</option>
                {myClubs.length > 0 && (
                  <optgroup label="Your clubs">
                    {myClubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                )}
                {otherClubs.length > 0 && (
                  <optgroup label={myClubs.length ? 'Other clubs' : 'Clubs'}>
                    {otherClubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                )}
              </select>
            </label>

            <label className={s.field}>
              <span className={s.label}>Activity / event name <em>*</em></span>
              <input className={s.input} value={form.title} onChange={set('title')} maxLength={200}
                placeholder="e.g. Inter-college Football Tournament" />
            </label>

            <div className={s.grid2}>
              <label className={s.field}>
                <span className={s.label}>Category <em>*</em></span>
                <select className={s.input} value={form.category} onChange={set('category')}>
                  <option value="">Choose…</option>
                  {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className={s.field}>
                <span className={s.label}>Date <em>*</em></span>
                <input className={s.input} type="date" value={form.activityDate} onChange={set('activityDate')} max={todayIso()} />
              </label>
            </div>

            <div className={s.field}>
              <span className={s.label}>Your result <em>*</em></span>
              <div className={s.segment} role="radiogroup" aria-label="Your result">
                {RESULT_OPTIONS.map(o => (
                  <button type="button" key={o.value} role="radio" aria-checked={form.result === o.value}
                    className={`${s.segBtn} ${form.result === o.value ? s.segOn : ''}`}
                    onClick={() => setForm(f => ({ ...f, result: o.value }))}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={s.grid2}>
              <label className={s.field}>
                <span className={s.label}>Venue</span>
                <input className={s.input} value={form.venue} onChange={set('venue')} maxLength={200} placeholder="Optional" />
              </label>
              <label className={s.field}>
                <span className={s.label}>Organised by</span>
                <input className={s.input} value={form.organizer} onChange={set('organizer')} maxLength={200} placeholder="Optional" />
              </label>
            </div>

            <label className={s.field}>
              <span className={s.label}>What did you do? <em>*</em></span>
              <textarea className={`${s.input} ${s.textarea}`} value={form.description} onChange={set('description')}
                maxLength={1000} rows={3} placeholder="Briefly describe the activity and your part in it" />
              <span className={s.counter}>{form.description.length}/1000</span>
            </label>

            <div className={s.field}>
              <span className={s.label}>Proof of activity <em>*</em></span>
              {file ? (
                <div className={s.fileCard}>
                  {preview
                    ? <img src={preview} alt="Proof preview" className={s.fileThumb} />
                    : <span className={s.fileIcon}>{file.name.split('.').pop().toUpperCase()}</span>}
                  <div className={s.fileInfo}>
                    <span className={s.fileName}>{file.name}</span>
                    <span className={s.fileSize}>{fmtSize(file.size)}</span>
                  </div>
                  <button type="button" className={s.fileRemove} onClick={clearFile}>Remove</button>
                </div>
              ) : (
                <div
                  className={`${s.drop} ${dragging ? s.dropOn : ''}`}
                  role="button" tabIndex={0}
                  onClick={() => fileRef.current?.click()}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={e => { e.preventDefault(); setDragging(false); takeFile(e.dataTransfer.files?.[0]); }}
                >
                  <span className={s.dropTitle}>Click to upload or drag a file here</span>
                  <span className={s.dropHint}>Certificate, photo or letter — PDF, Word, JPG, PNG or WEBP, up to 15 MB</span>
                </div>
              )}
              <input ref={fileRef} type="file" hidden accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
                onChange={e => takeFile(e.target.files?.[0])} />
            </div>

            {error && <div className={s.error} role="alert">{error}</div>}

            <div className={s.actions}>
              <button type="button" className={s.btnGhost} onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className={s.btnPrimary} disabled={saving || !clubs}>
                {saving ? 'Submitting…' : 'Submit for review'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const STATUS_TEXT = { pending: 'Waiting for review', approved: 'Added to your activity', rejected: 'Not approved' };

/* ── The student's own submissions and their status. Renders nothing until they
   have submitted at least one. `refreshKey` reloads it (e.g. after a new submit). ── */
export function ActivityClaimsList({ refreshKey = 0 }) {
  const [claims,  setClaims]  = useState([]);
  const [busyId,  setBusyId]  = useState(null);
  const [error,   setError]   = useState('');

  const load = useCallback(() => {
    api.get('/student-activity/mine').then(r => setClaims(r.claims || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const remove = async (c) => {
    const verb = c.status === 'pending' ? 'Withdraw' : 'Remove';
    if (!window.confirm(`${verb} "${c.title}"?`)) return;
    setBusyId(c.id);
    setError('');
    try {
      await api.delete(`/student-activity/${c.id}`);
      setClaims(list => list.filter(x => x.id !== c.id));
    } catch (err) {
      setError(err.message || 'Could not remove it. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  if (!claims.length) return null;

  return (
    <div className={s.listWrap}>
      <div className={s.listTitle}>Activities you've added ({claims.length})</div>
      {error && <div className={s.error} role="alert">{error}</div>}
      {claims.map(c => (
        <div key={c.id} className={s.claimRow}>
          <div className={s.claimMain}>
            <div className={s.claimTop}>
              <span className={s.claimTitle}>{c.title}</span>
              <span className={`${s.pill} ${s['pill_' + c.status]}`}>{STATUS_TEXT[c.status]}</span>
            </div>
            <div className={s.claimMeta}>
              {[c.clubName, c.categoryLabel, RESULT_LABEL[c.result], fmtDate(c.activityDate)].filter(Boolean).join(' · ')}
            </div>
            {c.status === 'rejected' && c.reviewNote && (
              <div className={s.claimNote}><strong>Reason:</strong> {c.reviewNote}</div>
            )}
            {c.status === 'approved' && c.reviewedByName && (
              <div className={s.claimVerified}>Verified by {c.reviewedByName} on {fmtDate(c.reviewedAt)}</div>
            )}
          </div>
          <div className={s.claimActions}>
            <button type="button" className={s.linkBtn} onClick={() => openProof(c.id)}>Proof</button>
            {c.status !== 'approved' && (
              <button type="button" className={s.linkBtnDanger} disabled={busyId === c.id} onClick={() => remove(c)}>
                {busyId === c.id ? '…' : c.status === 'pending' ? 'Withdraw' : 'Remove'}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
