import { useState, useEffect } from 'react';
import { pushSupported, requestPushPermission } from '../../utils/push';

const DISMISS_KEY = 'soac_push_dismissed';

const initiallyVisible = () =>
  pushSupported() &&
  Notification.permission === 'default' &&
  !localStorage.getItem(DISMISS_KEY);

/* Small dismissible opt-in banner — never auto-prompts for Notification permission
   (browsers actively penalize sites that call requestPermission() without a user
   gesture). Shows when permission is undecided, OR when permission was already
   granted at some point but no subscription was ever actually saved (e.g. an
   earlier attempt's POST to the backend failed silently) — otherwise that stuck
   "granted but never subscribed" state would hide this forever with no way to
   retry, since permission-decided !== actually-subscribed. */
export default function PushOptInBanner() {
  const [visible, setVisible] = useState(initiallyVisible);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) return; // already showing via the sync check above
    if (!pushSupported() || Notification.permission !== 'granted') return;
    if (localStorage.getItem(DISMISS_KEY)) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => { if (!sub) setVisible(true); })
      .catch(() => {});
  }, [visible]);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  const enable = async () => {
    setBusy(true);
    setError('');
    const ok = await requestPushPermission();
    setBusy(false);
    if (ok) { dismiss(); return; }
    if (Notification.permission === 'denied') { dismiss(); return; }
    // Permission granted (or still default) but the subscribe attempt itself
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
