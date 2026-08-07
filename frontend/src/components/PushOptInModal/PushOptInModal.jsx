import { useState, useEffect, useRef } from 'react';
import { fcmSupported, requestFcmPermission, onForegroundMessage, deleteFcmToken, FCM_TOKEN_STORAGE_KEY } from '../../firebaseMessaging';
import api from '../../api/client';
import s from './PushOptInModal.module.css';

const DISMISS_KEY = 'soac_push_dismissed';
const TOKEN_KEY = FCM_TOKEN_STORAGE_KEY;

const initiallyVisible = () =>
  fcmSupported() &&
  Notification.permission === 'default' &&
  !localStorage.getItem(DISMISS_KEY);

/* One-time opt-in modal shown automatically on first login — never auto-calls
   Notification.requestPermission() itself (browsers actively penalize sites
   that request permission without a genuine user gesture, and can silently
   block the prompt forever if they detect that pattern). The modal appearing
   is just our own UI, no gesture needed for that part; only the "Allow
   Notifications" button click triggers the real browser permission request,
   which satisfies the gesture requirement while still surfacing the ask
   immediately instead of a background banner someone might never notice.

   Shows once per account: when permission is undecided, OR when permission
   was already granted at some point but no token was ever actually saved
   (e.g. an earlier attempt's POST to the backend failed silently) —
   otherwise that stuck "granted but never subscribed" state would hide this
   forever with no way to retry, since permission-decided !== actually-subscribed. */
export default function PushOptInModal() {
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
     of clicking Allow) so returning users with an existing subscription
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
    // failed — keep the modal up so they can retry, instead of hiding a
    // recoverable failure forever.
    setError('Could not finish enabling notifications — check your connection and try again.');
  };

  return (
    <div className={s.overlay} onClick={dismiss}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.hero}>
          <div className={s.icon}>🔔</div>
          <div className={s.title}>Stay in the loop</div>
          <div className={s.sub}>
            Turn on notifications to hear about messages, event updates &amp; announcements — even when SOAC isn't open.
          </div>
        </div>
        <div className={s.body}>
          <div className={s.actions}>
            <button className={s.allowBtn} onClick={enable} disabled={busy}>
              {busy ? 'Enabling…' : 'Allow Notifications'}
            </button>
            <button className={s.notNowBtn} onClick={dismiss}>Not now</button>
          </div>
          {error && <div className={s.error}>{error}</div>}
        </div>
      </div>
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
