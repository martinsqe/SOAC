import { useState } from 'react';
import s from './JoinModal.module.css';

const DEPTS = ['Engineering','Pharmacy','Physiotherapy','Science'];
const YEARS = ['1st Year','2nd Year','3rd Year','4th Year','5th Year', '6th Year'];

export default function JoinModal({ club, onClose }) {
  const [form, setForm] = useState({ name:'', email:'', phone:'', enrollmentNo:'', dept:'', year:'', message:'' });
  const [submitting, setSubmitting] = useState(false);
  const [done,       setDone]       = useState(false);
  const [err,        setErr]        = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.name.trim() || !form.email.trim()) { setErr('Name and email are required.'); return; }
    if (!form.email.includes('@')) { setErr('Enter a valid email address.'); return; }
    setSubmitting(true);
    try {
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
          message:      form.message.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Submission failed.');
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
          <div className={s.mSuccessIcon}>✅</div>
          <h3>Request Submitted!</h3>
          <p>Your request to join <strong>{club.name}</strong> has been sent to the coordinator. Once approved, your login credentials will be emailed to <strong>{form.email}</strong>.</p>
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

        <form className={s.mbody} onSubmit={handleSubmit} noValidate>
          <div className={s.mfields}>
            <div className={s.mg2}>
              <div>
                <label className={s.mlbl}>Full Name <span className={s.mreq}>*</span></label>
                <input className={s.minp} placeholder="e.g. Aryan Kumar" value={form.name} onChange={e => set('name', e.target.value)} />
              </div>
              <div>
                <label className={s.mlbl}>Email Address <span className={s.mreq}>*</span></label>
                <input className={s.minp} type="email" placeholder="name@rku.ac.in" value={form.email} onChange={e => set('email', e.target.value)} />
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
            <div className={s.mg2}>
              <div>
                <label className={s.mlbl}>Department</label>
                <select className={s.minp} value={form.dept} onChange={e => set('dept', e.target.value)}>
                  <option value="">Select department</option>
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
      </div>
    </div>
  );
}
