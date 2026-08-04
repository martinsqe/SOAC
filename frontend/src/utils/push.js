import api from '../api/client';

/* VAPID public keys arrive as URL-safe base64; pushManager.subscribe() needs a
   Uint8Array applicationServerKey. Standard, well-known conversion. */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

/* Requests Notification permission and subscribes via the service worker's
   pushManager — must be called from a user gesture (a click handler), never on
   page load, or the browser may auto-deny/flag the site. Returns false (never
   throws) if unsupported, denied, or misconfigured. */
export async function requestPushPermission() {
  if (!pushSupported()) return false;
  if (Notification.permission === 'denied') return false;
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidKey) return false;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });

    await api.post('/push/subscribe', subscription.toJSON());
    return true;
  } catch (err) {
    console.error('[push] subscribe failed:', err.message);
    return false;
  }
}

/* Reverses subscribe — unsubscribes locally and tells the backend to drop the row. */
export async function disablePush() {
  if (!pushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return true;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await api.delete('/push/subscribe', { endpoint }).catch(() => {});
    return true;
  } catch (err) {
    console.error('[push] unsubscribe failed:', err.message);
    return false;
  }
}
