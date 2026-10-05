import { useEffect, useState } from 'react';
import api from '../../api/client';

/* Admin → Events → "Send Reminder": email a reminder about one event.
   Shows how many people it will reach before sending (server dry run). */
const TYPES = [
  { key: 'countdown', label: 'Days to go',      hint: 'e.g. "2 days to go" — counted from the event date' },
  { key: 'venue',     label: 'Venue update',    hint: 'Announce the confirmed venue' },
  { key: 'register',  label: 'Register now',    hint: 'Only club members who haven\'t registered yet' },
  { key: 'custom',    label: 'Custom message',  hint: 'Write your own reminder' },
];
const AUDIENCES = [
  { key: 'both',       label: 'Registered + club members' },
  { key: 'registered', label: 'Registered participants only' },
  { key: 'members',    label: 'Club members only' },
];

export default function EventReminderModal({ ev, onClose, onSent }) {
  /* Only events using SOAC's own form have registered participants here;
     external-site and announcement-only events remind club members. */
  const regType  = ev.registrationType || 'internal';
  const internal = regType === 'internal';
  const types    = TYPES.filter(t => !(t.key === 'register' && regType === 'none'));
  const [type,     setType]     = useState(ev.venue ? 'countdown' : 'custom');
  const [audience, setAudience] = useState(internal ? 'both' : 'members');
  const [message,  setMessage]  = useState('');
  const [preview,  setPreview]  = useState(null);   // { count, daysToGo, ... } or { error }
  const [sending,  setSending]  = useState(false);
  const [error,    setError]    = useState('');

  /* Recipient count for the current choice */
  useEffect(() => {
    let alive = true;
    setPreview(null);
    const t = setTimeout(() => {
      api.post(`/events/${ev._id}/remind`, { type, audience, message: message || 'preview', dryRun: true })
        .then(d => { if (alive) setPreview(d); })
        .catch(err => { if (alive) setPreview({ error: err.message }); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [ev._id, type, audience]); // eslint-disable-line react-hooks/exhaustive-deps

  const blockedReason = (key) => {
    if (key === 'venue' && !ev.venue) return 'Set a venue on the event first';
    if (key === 'register' && ev.registrationClosed) return 'Registration is closed';
    return '';
  };
  const hintFor = (t) => (t.key === 'register' && regType === 'external'
    ? 'Club members — the button links to the registration website'
    : t.hint);

  const send = async () => {
    setSending(true); setError('');
    try {
      const res = await api.post(`/events/${ev._id}/remind`, { type, audience, message: message.trim() });
      onSent(res.message);
      onClose();
    } catch (err) { setError(err.message); }
    finally { setSending(false); }
  };

  const daysText = preview && preview.daysToGo != null
    ? (preview.daysToGo === 0 ? 'today' : preview.daysToGo === 1 ? 'tomorrow' : preview.daysToGo > 0 ? `in ${preview.daysToGo} days` : 'already started')
    : null;

  return (
    <div onClick={() => !sending && onClose()}
      style={{ position:'fixed', inset:0, zIndex:10000, background:'rgba(15,10,46,.55)', backdropFilter:'blur(4px)',
        display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:'#fff', borderRadius:18, padding:24, maxWidth:500, width:'100%', maxHeight:'90vh', overflowY:'auto',
          boxShadow:'0 24px 64px rgba(0,0,0,.2)' }}>
        <div style={{ fontSize:11, fontWeight:800, letterSpacing:1, textTransform:'uppercase', color:'#0ea5e9' }}>Event reminder</div>
        <h3 style={{ margin:'4px 0 4px', fontWeight:900, color:'#0f0a2e' }}>{ev.title}</h3>
        <div style={{ fontSize:12.5, color:'#6b7280', marginBottom:16 }}>
          {[ev.date, ev.time, ev.venue ? `Venue: ${ev.venue}` : 'No venue set yet'].filter(Boolean).join(' · ')}
          {daysText && <> · <strong>{daysText}</strong></>}
        </div>

        <div style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:6 }}>What is this reminder about?</div>
        <div style={{ display:'grid', gap:8, marginBottom:16 }}>
          {types.map(t => {
            const blocked = blockedReason(t.key);
            const active = type === t.key;
            return (
              <button key={t.key} type="button" disabled={!!blocked} onClick={() => setType(t.key)}
                style={{ textAlign:'left', padding:'10px 12px', borderRadius:10, cursor: blocked ? 'not-allowed' : 'pointer',
                  border:`1.5px solid ${active ? '#635BFF' : '#e5e7eb'}`, background: active ? '#f5f3ff' : '#fff',
                  opacity: blocked ? .5 : 1, fontFamily:'inherit' }}>
                <div style={{ fontWeight:800, fontSize:13.5, color:'#0f0a2e' }}>{t.label}</div>
                <div style={{ fontSize:12, color:'#6b7280', marginTop:2 }}>{blocked || hintFor(t)}</div>
              </button>
            );
          })}
        </div>

        {type !== 'register' && internal && (
          <>
            <div style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:6 }}>Send to</div>
            <select value={audience} onChange={e => setAudience(e.target.value)}
              style={{ width:'100%', padding:'9px 12px', borderRadius:10, border:'1.5px solid #e5e7eb', fontSize:13.5,
                marginBottom:16, fontFamily:'inherit', background:'#fff' }}>
              {AUDIENCES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </>
        )}
        {!internal && (
          <div style={{ fontSize:12.5, color:'#6b7280', marginBottom:16 }}>
            Sent to <strong>club members</strong>
            {regType === 'external' ? ' — sign-ups on the external website aren\'t tracked here.' : ' — this event has no registrations.'}
          </div>
        )}

        <div style={{ fontSize:12, fontWeight:700, color:'#374151', marginBottom:6 }}>
          Message {type === 'custom' ? <span style={{ color:'#dc2626' }}>*</span> : <span style={{ color:'#9ca3af', fontWeight:500 }}>(optional)</span>}
        </div>
        <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} maxLength={1000}
          placeholder={type === 'venue' ? 'e.g. Please arrive 15 minutes early at the main gate.' : 'Add a note to include in the email…'}
          style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:'1.5px solid #e5e7eb', fontSize:13.5,
            resize:'vertical', boxSizing:'border-box', fontFamily:'inherit' }} />

        <div style={{ margin:'14px 0 4px', padding:'10px 12px', borderRadius:10, background:'#f0f9ff', border:'1px solid #bae6fd',
          fontSize:13, color:'#0369a1' }}>
          {!preview ? 'Counting recipients…'
            : preview.error ? <span style={{ color:'#b91c1c' }}>{preview.error}</span>
            : <>This will email <strong>{preview.count}</strong> {preview.count === 1 ? 'person' : 'people'}
                {type === 'register' && internal && <> — club members who haven't registered</>}.</>}
        </div>

        {error && <div style={{ marginTop:10, padding:'9px 12px', borderRadius:8, background:'#fff0f0', border:'1px solid #fca5a5',
          color:'#b91c1c', fontSize:13 }}>{error}</div>}

        <div style={{ display:'flex', gap:10, marginTop:16 }}>
          <button type="button" onClick={onClose} disabled={sending}
            style={{ flex:1, padding:'10px 14px', borderRadius:10, border:'1.5px solid #e5e7eb', background:'#fff', color:'#374151',
              fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>Cancel</button>
          <button type="button" onClick={send}
            disabled={sending || !preview || preview.error || !preview.count || (type === 'custom' && !message.trim())}
            style={{ flex:1, padding:'10px 14px', borderRadius:10, border:'none', background:'#635BFF', color:'#fff',
              fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'inherit',
              opacity: (sending || !preview || preview.error || !preview.count || (type === 'custom' && !message.trim())) ? .5 : 1 }}>
            {sending ? 'Sending…' : 'Send reminder'}
          </button>
        </div>
      </div>
    </div>
  );
}
