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
   PushOptInModal.jsx uses the exact same key rather than a duplicated
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
export async function registerFcmServiceWorker() {
  const registration = await navigator.serviceWorker.register(FCM_SW_URL, { scope: FCM_SW_SCOPE });

  /* Explicitly ask the browser to check for a newer version of this file on
     every call, instead of relying on its own background check — browsers
     throttle that to roughly once a day (worse on iOS), which is exactly why
     a since-fixed bug (the old raw-push diagnostic listener) kept firing on
     real devices for days after the corrected file was actually deployed.
     Fire-and-forget: this only affects which version takes over on the
     *next* activation, so it must never delay returning the registration
     that's active right now below. */
  registration.update().catch(() => {});

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

/* Ensures a valid subscription exists whenever permission is already granted
   — regardless of HOW it got granted. Permission can end up "granted"
   without our modal ever running (e.g. an installed PWA's Android-level
   notification toggle grants it directly at the OS layer), and Android
   granting permission does NOT itself create an FCM token or tell the
   backend anything — only an actual getToken() + POST /push/subscribe call
   does that. Previously this only ran when a token was already stored
   locally ("refresh"), which silently skipped exactly that out-of-band-grant
   case — permission showed "Allowed" everywhere, yet no subscription ever
   existed server-side.

   Separately, FCM can also invalidate a token server-side (Google's FCM
   registry, e.g. after extended inactivity) WITHOUT the browser's own
   getToken() ever returning a different value — so even in the "already
   subscribed" case, this always re-POSTs (a harmless idempotent upsert, see
   push.controller.js's ON CONFLICT) rather than only when the token visibly
   differs, since a value-comparison check can't catch that either.

   Call on every app load. */
export async function syncFcmToken() {
  if (!fcmSupported() || Notification.permission !== 'granted') return;

  try {
    const registration = await registerFcmServiceWorker();
    const token = await getToken(getMessagingInstance(), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return;

    await api.post('/push/subscribe', { token });
    const stored = localStorage.getItem(FCM_TOKEN_STORAGE_KEY);
    if (token !== stored) {
      localStorage.setItem(FCM_TOKEN_STORAGE_KEY, token);
      if (stored) api.delete('/push/subscribe', { token: stored }).catch(() => {});
    }
  } catch (err) {
    console.error('[fcm] token sync failed:', err.message);
  }
}
