import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import s from './JoinModal.module.css';

/* Opened from the join-request confirmation email (/clubs?confirmJoin=<token>):
   confirms the request — only now is it sent to the club — and shows the result. */
export default function JoinConfirm() {
  const [params, setParams] = useSearchParams();
  const token = params.get('confirmJoin');
  /* The token is captured once on mount — the address bar is cleared straight after */
  const [initialToken] = useState(token);
  const [state, setState] = useState(initialToken ? { pending: true } : null);   // { ok, message } once done
  const sent = useRef(false);

  useEffect(() => {
    if (!initialToken || sent.current) return;
    sent.current = true;
    /* Drop the token from the address bar (and history) straight away */
    const next = new URLSearchParams(params);
    next.delete('confirmJoin');
    setParams(next, { replace: true });

    fetch('/api/requests/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: initialToken }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        setState({ ok: res.ok, message: data.message || (res.ok ? 'Your request has been sent to the club.' : 'This link could not be confirmed.') });
      })
      .catch(() => setState({ ok: false, message: 'Could not reach the server. Please open the link again in a moment.' }));
  }, [initialToken, params, setParams]);

  if (!state) return null;
  if (state.pending) {
    return (
      <div className={s.modalBackdrop}>
        <div className={s.modal} style={{ maxWidth: 440 }}>
          <div className={s.mSuccess}><h3>Confirming your request…</h3></div>
        </div>
      </div>
    );
  }

  return (
    <div className={s.modalBackdrop} onClick={() => setState(null)}>
      <div className={s.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className={s.mSuccess}>
          <div className={s.mSuccessIcon}>{state.ok ? '✅' : '⚠️'}</div>
          <h3>{state.ok ? 'Request sent!' : "Couldn't confirm"}</h3>
          <p>{state.message}</p>
          <button className="btr" onClick={() => setState(null)}>Done</button>
        </div>
      </div>
    </div>
  );
}
