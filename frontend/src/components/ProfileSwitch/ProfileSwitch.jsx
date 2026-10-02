import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

/* "Switch to … dashboard" — shown only to someone with two profiles on one
   login (a club member who is also a Student Coordinator / Faculty Advisor).
   Styled by the sidebar it sits in via `className`. */
export default function ProfileSwitch({ className, style }) {
  const { user, switchProfile } = useAuth();
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  if (!user?.switchTo) return null;

  const go = async () => {
    setBusy(true); setError('');
    try { await switchProfile(); }
    catch (err) { setError(err.message || 'Could not switch. Please try again.'); setBusy(false); }
  };

  return (
    <>
      <button type="button" className={className} style={style} onClick={go} disabled={busy}
        title={`Open your ${user.switchTo.label} — same login`}>
        {busy ? 'Switching…' : `⇄ Switch to ${user.switchTo.label}`}
      </button>
      {error && <div style={{ fontSize: 12, color: '#fecaca', padding: '4px 2px' }}>{error}</div>}
    </>
  );
}
