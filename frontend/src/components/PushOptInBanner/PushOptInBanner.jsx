import { useState, useEffect, useRef } from 'react';
import { fcmSupported, requestFcmPermission, onForegroundMessage, deleteFcmToken } from '../../firebaseMessaging';
import api from '../../api/client';

const DISMISS_KEY = 'soac_push_dismissed';
const TOKEN_KEY = 'soac_fcm_token';

const initiallyVisible = () =>
  fcmSupported() &&
  Notification.permission === 'default' &&
  !localStorage.getItem(DISMISS_KEY);

/* Small dismissible opt-in banner — never auto-prompts for Notification permission
   (browsers actively penalize sites that call requestPermission() without a user
   gesture). Shows when permission is undecided, OR when permission was already
   granted at some point but no token was ever actually saved (e.g. an earlier
   attempt's POST to the backend failed silently) — otherwise that stuck
   "granted but never subscribed" state would hide this forever with no way to
   retry, since permission-decided !== actually-subscribed. */
export default function PushOptInBanner() {
  const [visible, setVisible] = useState(initiallyVisible);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unsubForeground = useRef(null);

  useEffect(() => {
    if (visible) return; // already showing via the sync check above
    if (!fcmSupported() || Notification.permission !== 'granted') return;
    if (localStorage.getItem(DISMISS_KEY)) return;
    if (!localStorage.getItem(TOKEN_KEY)) setVisible(true);
  }, [visible]);

  /* FCM's onMessage() only fires the callback — it never displays a system
     notification itself, unlike the service worker's background handler.
     Wired up whenever permission is already granted (not just at the moment
     of clicking Enable) so returning users with an existing subscription
     still get notified while the tab is open and focused. */
  useEffect(() => {
    if (!fcmSupported() || Notification.permission !== 'granted') return;
    unsubForeground.current = onForegroundMessage((payload) => {
      const { title, body, url } = payload.data || {};
      const n = new Notification(title || 'SOAC RKU', { body: body || '', icon: '/images/icon-192.png' });
      n.onclick = () => { window.focus(); if (url) window.location.href = url; };
    });
    return () => unsubForeground.current?.();
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  const enable = async () => {
    setBusy(true);
    setError('');
    const token = await requestFcmPermission();
    if (token) {
      try {
        await api.post('/push/subscribe', { token });
        localStorage.setItem(TOKEN_KEY, token);
        setBusy(false);
        dismiss();
        return;
      } catch (err) {
        setBusy(false);
        setError(err?.message || 'Could not finish enabling notifications — check your connection and try again.');
        return;
      }
    }
    setBusy(false);
    if (Notification.permission === 'denied') { dismiss(); return; }
    // Permission granted (or still default) but getToken()/subscribe itself
    // failed — keep the banner up so they can retry, instead of hiding a
    // recoverable failure forever.
    setError('Could not finish enabling notifications — check your connection and try again.');
  };

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
      background: '#f5f3ff', border: '1.5px solid #ddd6fe', borderRadius: 10,
      padding: '10px 16px', margin: '0 0 16px', fontSize: 13, color: '#374151',
    }}>
      <span style={{ flex: 1, minWidth: 200 }}>
        🔔 Get notified about messages, events &amp; announcements — even when the tab is closed.
      </span>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button onClick={enable} disabled={busy}
          style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: '#635BFF',
            color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Enabling…' : 'Enable'}
        </button>
        <button onClick={dismiss}
          style={{ padding: '6px 14px', borderRadius: 8, border: '1.5px solid #e5e7eb', background: '#fff',
            color: '#6b7280', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
          Not now
        </button>
      </div>
      {error && (
        <div style={{ width: '100%', fontSize: 12, color: '#dc2626' }}>{error}</div>
      )}
    </div>
  );
}

/* Exported so a future settings page can offer an explicit "turn off
   notifications" toggle — mirrors requestFcmPermission()'s call shape. */
export async function disablePush() {
  const token = localStorage.getItem(TOKEN_KEY);
  await deleteFcmToken();
  if (token) {
    await api.delete('/push/subscribe', { token }).catch(() => {});
    localStorage.removeItem(TOKEN_KEY);
  }
}
