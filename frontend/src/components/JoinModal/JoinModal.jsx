import { useState } from 'react';
import s from './JoinModal.module.css';
import { signInWithRkuGoogle } from '../../utils/googleSignIn';

const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
  </svg>
);

const DEPTS = ['ACH','AI/ML','FOT','SDS','SOE','SPT','SOP','SOM','SOS',];
const YEARS = ['1st Year','2nd Year','3rd Year','4th Year','5th Year', '6th Year'];
const CAMPUSES = ['Main Campus','City Campus'];

export default function JoinModal({ club, onClose }) {
  const [form, setForm] = useState({ name:'', email:'', phone:'', enrollmentNo:'', dept:'', year:'', gender:'', campus:'', message:'' });
  const [submitting, setSubmitting] = useState(false);
  const [done,       setDone]       = useState(false);
  /* 'sent' — a confirmation link was emailed (guests); 'created' — sent straight to the club */
  const [doneKind,   setDoneKind]   = useState('created');
  const [err,        setErr]        = useState('');
  /* Verified Google account ({ email, name, idToken }) — the form only opens after it */
  const [google,     setGoogle]     = useState(null);
  const [signingIn,  setSigningIn]  = useState(false);

  const continueWithGoogle = async () => {
    setErr('');
    setSigningIn(true);
    try {
      const g = await signInWithRkuGoogle();
      setGoogle(g);
      setForm(f => ({ ...f, email: g.email, name: f.name.trim() ? f.name : g.name }));
    } catch (ex) { setErr(ex.message); }
    finally { setSigningIn(false); }
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!google) { setErr('Please continue with your RKU Google account first.'); return; }
    if (!form.name.trim()) { setErr('Name is required.'); return; }
    if (!form.gender) { setErr('Please select your gender.'); return; }
    if (!form.campus) { setErr('Please select your campus.'); return; }
    setSubmitting(true);
    try {
      /* Pre-check the 3-club request cap (active memberships + pending requests), existing
         membership in this club, and an already-pending request for it BEFORE sending the
         actual join request — if any is true, alert and stop here so no request ever
         gets submitted. The server re-checks all three on the real POST below regardless
         (authoritative), since this GET is only a best-effort UX shortcut, not something to
         trust alone. */
      try {
        const limitRes  = await fetch(`/api/requests/check-club-limit?email=${encodeURIComponent(form.email.trim().toLowerCase())}&clubId=${encodeURIComponent(club._id)}&campus=${encodeURIComponent(form.campus)}`);
        const limitData = await limitRes.json();
        if (limitRes.ok && limitData.joinClosed) {
          alert(limitData.message);
          setSubmitting(false);
          return;
        }
        if (limitRes.ok && limitData.wrongCampus) {
          alert(limitData.campusMessage);
          /* switch the form to the campus they're allowed, ready to resubmit */
          if (limitData.allowedCampus) setForm(p => ({ ...p, campus: limitData.allowedCampus }));
          setSubmitting(false);
          return;
        }
        if (limitRes.ok && limitData.alreadyMember) {
          alert("You're already a member of this club.");
          setSubmitting(false);
          return;
        }
        if (limitRes.ok && limitData.alreadyPending) {
          alert('You already have a pending request for this club.');
          setSubmitting(false);
          return;
        }
        if (limitRes.ok && limitData.atLimit) {
          alert('You can only send request to 3 clubs.');
          setSubmitting(false);
          return;
        }
      } catch { /* pre-check failed (offline/etc) — fall through to the real submit, which still enforces both */ }

      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clubId:       club._id,
          clubName:     club.name,
          name:         form.name.trim(),
          email:        form.email.trim().toLowerCase(),
          phone:        form.phone.trim(),
          enrollmentNo: form.enrollmentNo.trim(),
          dept:         form.dept,
          year:         form.year,
          gender:       form.gender,
          campus:       form.campus,
          message:      form.message.trim(),
          googleIdToken: google.idToken,
        }),
      });
      const data = await res.json();
      if (res.status === 403 && data.joinClosed) { alert(data.message); return; }
      /* Google token expired (left open a long time) — sign in again */
      if (res.status === 401) { setGoogle(null); throw new Error(data.message || 'Please continue with Google again.'); }
      if (!res.ok) throw new Error(data.message || 'Submission failed.');
      setDoneKind(data.confirmationSent ? 'sent' : 'created');
      setDone(true);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className={s.mSuccess}>
          {doneKind === 'sent' ? (<>
            <div className={s.mSuccessIcon}>📧</div>
            <h3>Check your email</h3>
            <p>We've sent a confirmation link to <strong>{form.email.trim().toLowerCase()}</strong>. Open it within an hour to send your request to join <strong>{club.name}</strong> — nothing is sent to the club until you do. Can't find it? Check your spam folder.</p>
          </>) : (<>
            <div className={s.mSuccessIcon}>✅</div>
            <h3>Request Submitted!</h3>
            <p>Your request to join <strong>{club.name}</strong> has been sent to the coordinator. Once approved, your login credentials will be emailed to <strong>{form.email}</strong>.</p>
          </>)}
          <button className="btr" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className={s.modalBackdrop} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.mhead}>
          <div>
            <div className={s.mheadTag}>Join Request</div>
            <h2 className={s.mheadTitle}>Join {club.name}</h2>
          </div>
          <button className={s.mclose} onClick={onClose}>✕</button>
        </div>

        {!google ? (
          <div className={s.mbody}>
            <div className={s.mgoogle}>
              <p className={s.mgoogleText}>
                To make sure your request reaches you, join with your <strong>RKU Google account</strong>.
                Only <strong>@rku.ac.in</strong> accounts can join clubs.
              </p>
              <button type="button" className={s.mgoogleBtn} onClick={continueWithGoogle} disabled={signingIn}>
                <GoogleG /> {signingIn ? 'Opening Google…' : 'Continue with Google'}
              </button>
              {err && <div style={{ background:'#fff0f0', border:'1px solid #fca5a5', borderRadius:8, padding:'9px 12px', fontSize:13, color:'#c0002e', width:'100%', boxSizing:'border-box' }}>{err}</div>}
              <button type="button" className={s.mbtnBack} onClick={onClose}>Cancel</button>
            </div>
          </div>
        ) : (
        <form className={s.mbody} onSubmit={handleSubmit} noValidate>
          <div className={s.mfields}>
            <div className={s.mg2}>
              <div>
                <label className={s.mlbl}>Full Name <span className={s.mreq}>*</span></label>
                <input className={s.minp} placeholder="e.g. Aryan Kumar" value={form.name} onChange={e => set('name', e.target.value)} />
              </div>
              <div>
                <label className={s.mlbl}>Email Address <span className={s.mreq}>*</span></label>
                <div className={s.mverified}>
                  <input className={s.minp} type="email" value={form.email} readOnly title="Verified with Google" />
                  <button type="button" className={s.mchange} onClick={() => { setGoogle(null); set('email', ''); }}>Change</button>
                </div>
                <div className={s.mverifiedNote}><GoogleG /> Verified with Google</div>
              </div>
            </div>
            <div className={s.mg2}>
              <div>
                <label className={s.mlbl}>Phone Number</label>
                <input className={s.minp} placeholder="e.g. 9876543210" value={form.phone} onChange={e => set('phone', e.target.value)} />
              </div>
              <div>
                <label className={s.mlbl}>Enrollment No.</label>
                <input className={s.minp} placeholder="e.g. 22BCE001" value={form.enrollmentNo} onChange={e => set('enrollmentNo', e.target.value)} />
              </div>
            </div>
            <div className={s.mg3}>
              <div>
                <label className={s.mlbl}>Department</label>
                <select className={s.minp} value={form.dept} onChange={e => set('dept', e.target.value)}>
                  <option value="">Select School</option>
                  {DEPTS.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className={s.mlbl}>Year</label>
                <select className={s.minp} value={form.year} onChange={e => set('year', e.target.value)}>
                  <option value="">Select year</option>
                  {YEARS.map(y => <option key={y}>{y}</option>)}
                </select>
              </div>
              <div>
                <label className={s.mlbl}>Gender <span className={s.mreq}>*</span></label>
                <select className={s.minp} value={form.gender} onChange={e => set('gender', e.target.value)}>
                  <option value="">Select gender</option>
                  <option value="M">M</option>
                  <option value="F">F</option>
                </select>
              </div>
            </div>
            <div>
              <label className={s.mlbl}>Campus <span className={s.mreq}>*</span></label>
              <select className={s.minp} value={form.campus} onChange={e => set('campus', e.target.value)}>
                <option value="">Select campus</option>
                {CAMPUSES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={s.mlbl}>Why do you want to join?</label>
              <textarea className={s.minp} rows={3} placeholder="Tell the coordinator why you'd like to join this club…" value={form.message} onChange={e => set('message', e.target.value)} style={{ resize:'vertical', minHeight:72 }} />
            </div>

            {err && <div style={{ background:'#fff0f0', border:'1px solid #fca5a5', borderRadius:8, padding:'9px 12px', fontSize:13, color:'#c0002e' }}>{err}</div>}

            <div style={{ display:'flex', gap:10, justifyContent:'flex-end', paddingTop:4 }}>
              <button type="button" className={s.mbtnBack} onClick={onClose}>Cancel</button>
              <button type="submit" className="btr" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit Request →'}</button>
            </div>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}
