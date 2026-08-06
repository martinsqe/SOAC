import { getMessaging, getToken, deleteToken, onMessage } from 'firebase/messaging';
import { firebaseApp } from './firebase';
import api from './api/client';

/* "Web Push certificates" key pair from Firebase Console → Project Settings →
   Cloud Messaging. Public by design (same as a VAPID public key) — required
   by getToken() to generate a browser registration token. */
const VAPID_KEY = 'BJROV1NTDNklfD2iGjx9_Z19cRtt3OG0s4DuKGf-8-34hQI-W6TMdPAQcFMG71OIA1XqdzOLyDnNYK81ji3Dp5E';

const FCM_SW_URL = '/firebase-messaging-sw.js';
const FCM_SW_SCOPE = '/firebase-cloud-messaging-push-scope';

/* Where the current device's token is cached locally — exported so
   PushOptInBanner.jsx uses the exact same key rather than a duplicated
   string literal that could drift out of sync. */
export const FCM_TOKEN_STORAGE_KEY = 'soac_fcm_token';

export function fcmSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

let messagingInstance = null;
function getMessagingInstance() {
  if (!messagingInstance) messagingInstance = getMessaging(firebaseApp);
  return messagingInstance;
}

/* Registered on its own scope, separate from the app's main PWA service
   worker (src/sw.js, scope '/') — see the comment atop firebase-messaging-sw.js.

   register() resolves as soon as the registration exists, not once it's
   actually active — and navigator.serviceWorker.ready only tracks the page's
   main controlling worker, not this separately-scoped one. Calling
   getToken()'s pushManager.subscribe() before activation finishes throws
   "no active Service Worker", so this explicitly waits for that state. */
async function registerFcmServiceWorker() {
  const registration = await navigator.serviceWorker.register(FCM_SW_URL, { scope: FCM_SW_SCOPE });
  if (registration.active) return registration;

  const worker = registration.installing || registration.waiting;
  if (!worker) return registration;

  await new Promise((resolve) => {
    worker.addEventListener('statechange', function onChange() {
      if (worker.state === 'activated') {
        worker.removeEventListener('statechange', onChange);
        resolve();
      }
    });
  });
  return registration;
}

/* Requests Notification permission (if not already decided) and returns an FCM
   registration token, or null if unsupported/denied/failed. Must be called
   from a user gesture. Never throws. */
export async function requestFcmPermission() {
  if (!fcmSupported()) return null;
  if (Notification.permission === 'denied') return null;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return null;

    const registration = await registerFcmServiceWorker();
    const token = await getToken(getMessagingInstance(), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    return token || null;
  } catch (err) {
    console.error('[fcm] getToken failed:', err.message);
    return null;
  }
}

/* Foreground messages (tab open & focused) never reach the service worker's
   onBackgroundMessage handler — FCM requires this separate listener for that
   case. Returns the unsubscribe function onMessage() gives back. */
export function onForegroundMessage(callback) {
  return onMessage(getMessagingInstance(), callback);
}

/* Invalidates the current token client-side. Never throws — the backend row
   should be removed by the caller regardless of whether this succeeds. */
export async function deleteFcmToken() {
  try {
    await deleteToken(getMessagingInstance());
    return true;
  } catch (err) {
    console.error('[fcm] deleteToken failed:', err.message);
    return false;
  }
}

/* FCM registration tokens can rotate (Android Chrome in particular does this
   more often than desktop) — nothing notifies the app when that happens, so
   without this, a rotated token just silently stops receiving anything
   forever: the old token still sits in the backend's push_subscriptions table
   until FCM reports it dead on some future send, and only then gets cleaned
   up, with no replacement ever taking its place.

   Call on every app load while permission is already granted (not just at
   the moment of clicking Enable) so a rotation gets caught and re-synced
   quickly. No-ops if this device was never subscribed in the first place. */
export async function syncFcmToken() {
  if (!fcmSupported() || Notification.permission !== 'granted') return;
  const stored = localStorage.getItem(FCM_TOKEN_STORAGE_KEY);
  if (!stored) return;

  try {
    const registration = await registerFcmServiceWorker();
    const token = await getToken(getMessagingInstance(), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token || token === stored) return;

    await api.post('/push/subscribe', { token });
    localStorage.setItem(FCM_TOKEN_STORAGE_KEY, token);
    api.delete('/push/subscribe', { token: stored }).catch(() => {});
  } catch (err) {
    console.error('[fcm] token refresh failed:', err.message);
  }
}
