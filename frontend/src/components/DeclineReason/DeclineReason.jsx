import { useState, useEffect, useRef } from 'react';

/* Declining a join request needs a reason — admin, FA and SC alike.
   DeclineReasonModal asks for it; DeclinedByNote shows "Declined by: FA" with
   a "Reason" link that reveals the reason (hover, or click/tap to keep it open). */

const ROLE_SHORT = { admin: 'Admin', faculty_coordinator: 'FA', coordinator: 'SC' };

export function DeclineReasonModal({ request, busy, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const ok = reason.trim().length >= 3;
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, width: '100%', maxWidth: 440, padding: 22,
        boxShadow: '0 20px 60px rgba(0,0,0,.25)', color: '#111',
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Decline request</div>
        <div style={{ fontSize: 13, color: '#555', marginBottom: 14 }}>
          {request.name} · {request.club_name || request.clubName}
        </div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
          Reason for declining <span style={{ color: '#D92E1D' }}>*</span>
        </label>
        <textarea
          autoFocus rows={3} maxLength={500} value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Club has reached its member limit for this semester"
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '10px 12px',
            border: '1.5px solid #d1d5db', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', outline: 'none',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button onClick={onCancel} disabled={busy} style={{
            padding: '8px 16px', borderRadius: 8, border: '1.5px solid #d1d5db', background: '#fff',
            color: '#111', fontWeight: 700, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={() => ok && onConfirm(reason.trim())} disabled={!ok || busy} style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff',
            fontWeight: 700, cursor: ok && !busy ? 'pointer' : 'not-allowed', opacity: ok && !busy ? 1 : .5,
          }}>{busy ? 'Declining…' : 'Decline'}</button>
        </div>
      </div>
    </div>
  );
}

export function DeclinedByNote({ role, reason }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef(null);

  /* a click elsewhere closes a reason that was opened by click/tap */
  useEffect(() => {
    if (!pinned) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setPinned(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close); };
  }, [pinned]);

  const show = hover || pinned;
  return (
    <div ref={ref} style={{ marginLeft: 'auto', textAlign: 'right', position: 'relative', fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 700, color: '#dc2626', whiteSpace: 'nowrap' }}>
        {ROLE_SHORT[role] ? `Declined by: ${ROLE_SHORT[role]}` : 'Declined'}
      </div>
      {reason && (
        <>
          <button
            type="button"
            onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
            onClick={() => setPinned(p => !p)}
            aria-expanded={show}
            style={{
              border: 'none', background: 'none', padding: 0, font: 'inherit', fontWeight: 700,
              color: '#111', textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'pointer',
            }}
          >Reason</button>
          {show && (
            <div role="tooltip" style={{
              position: 'absolute', right: 0, top: '100%', marginTop: 6, zIndex: 20,
              width: 'max-content', maxWidth: 260, textAlign: 'left',
              background: '#fff', color: '#000', fontSize: 13, fontWeight: 400, lineHeight: 1.5,
              padding: '8px 12px', borderRadius: 8, boxShadow: '0 6px 24px rgba(0,0,0,.18)',
              whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
            }}>{reason}</div>
          )}
        </>
      )}
    </div>
  );
}
