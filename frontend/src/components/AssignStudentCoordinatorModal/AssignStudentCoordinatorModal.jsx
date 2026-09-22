import { useState } from 'react';
import api from '../../api/client';
import s from './AssignStudentCoordinatorModal.module.css';

/* A Faculty Coordinator's own "Assign Student Coordinator" action — same
   backend endpoint (POST /clubs/:id/assign-coordinator) and the same UI
   procedure as the admin dashboard's "Assign Coordinator" modal in
   AdminClubs.jsx (name + RKU email, existing-assignments lookup, credentials
   emailed on save), scoped to the club the Faculty Coordinator already
   manages rather than a club picker. */
export default function AssignStudentCoordinatorModal({ club, onClose }) {
  const [name,   setName]   = useState(club.coordinator || '');
  const [email,  setEmail]  = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [done,   setDone]   = useState(null); // { message } once assigned

  const [assignments,  setAssignments]  = useState([]);
  const [lookingUp,    setLookingUp]    = useState(false);

  const handleEmailLookup = async (value) => {
    const e = value.trim().toLowerCase();
    if (!e.endsWith('@rku.ac.in')) { setAssignments([]); return; }
    setLookingUp(true);
    try {
      const d = await api.get(`/clubs/coordinator-assignments?email=${encodeURIComponent(e)}`);
      setAssignments(d.assignments || []);
      if (d.user?.name && !name) setName(d.user.name);
    } catch {
      setAssignments([]);
    } finally {
      setLookingUp(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim())  return setError('Name is required.');
    if (!email.trim()) return setError('RKU email is required.');
    if (!email.toLowerCase().endsWith('@rku.ac.in')) return setError('Only @rku.ac.in emails are allowed.');
    setSaving(true); setError('');
    try {
      const res = await api.post(`/clubs/${club.id}/assign-coordinator`, {
        name: name.trim(), email: email.trim(),
      });
      setDone({ message: res.message });
    } catch (err) {
      setError(err.message || 'Failed to assign Student Coordinator.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHeader}>
          <div>
            <div className={s.modalTag}>Student Coordinator Assignment</div>
            <h2 className={s.modalTitle}>{club.name}</h2>
          </div>
          <button className={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {done ? (
          <div className={s.form}>
            <div className={s.doneBanner}>{done.message}</div>
            <div className={s.modalFooter}>
              <button className={s.saveBtn} onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <>
            {club.coordinator && (
              <div className={s.currentBanner}>
                Currently assigned: <strong>{club.coordinator}</strong>
              </div>
            )}

            <form onSubmit={handleSubmit} className={s.form}>
              <div className={s.field}>
                <label>Full Name <span className={s.req}>*</span></label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Priya Sharma" required />
              </div>

              <div className={s.field}>
                <label>RKU Email Address <span className={s.req}>*</span></label>
                <input
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setAssignments([]); }}
                  onBlur={e => handleEmailLookup(e.target.value)}
                  placeholder="student.coordinator@rku.ac.in"
                  required
                />
                <div className={s.hint}>
                  If this email doesn't exist yet, a new account will be created and credentials emailed to them.
                  If it already exists, they'll receive a <strong>confirmation email only</strong> — their password won't be changed.
                </div>
              </div>

              {(lookingUp || assignments.length > 0) && (
                <div className={s.lookupBanner}>
                  {lookingUp ? (
                    <span>Looking up…</span>
                  ) : (
                    <>
                      <div className={s.lookupTitle}>
                        Already managing {assignments.length} club{assignments.length !== 1 ? 's' : ''}:
                      </div>
                      <div className={s.lookupChips}>
                        {assignments.map(a => (
                          <span key={a.id} className={`${s.chip} ${a.is_active ? s.chipOn : s.chipOff}`}>
                            {a.club_name}{!a.is_active ? ' (inactive)' : ''}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {error && <div className={s.errorBanner}>{error}</div>}

              <div className={s.modalFooter}>
                <button type="button" className={s.cancelBtn} onClick={onClose}>Cancel</button>
                <button type="submit" className={s.saveBtn} disabled={saving}>
                  {saving ? 'Assigning…' : 'Assign Student Coordinator'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
