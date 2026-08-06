import { getMessaging, getToken, deleteToken, onMessage } from 'firebase/messaging';
import { firebaseApp } from './firebase';

/* "Web Push certificates" key pair from Firebase Console → Project Settings →
   Cloud Messaging. Public by design (same as a VAPID public key) — required
   by getToken() to generate a browser registration token. */
const VAPID_KEY = 'BJROV1NTDNklfD2iGjx9_Z19cRtt3OG0s4DuKGf-8-34hQI-W6TMdPAQcFMG71OIA1XqdzOLyDnNYK81ji3Dp5E';

const FCM_SW_URL = '/firebase-messaging-sw.js';
const FCM_SW_SCOPE = '/firebase-cloud-messaging-push-scope';

export function fcmSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

let messagingInstance = null;
function getMessagingInstance() {
  if (!messagingInstance) messagingInstance = getMessaging(firebaseApp);
  return messagingInstance;
}

/* Registered on its own scope, separate from the app's main PWA service
   worker (src/sw.js, scope '/') — see the comment atop firebase-messaging-sw.js. */
async function registerFcmServiceWorker() {
  return navigator.serviceWorker.register(FCM_SW_URL, { scope: FCM_SW_SCOPE });
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
