/* Dedicated Firebase Cloud Messaging service worker. Registered on its own
   scope ('/firebase-cloud-messaging-push-scope', see firebaseMessaging.js) so
   it coexists with the app's main PWA service worker (src/sw.js) at scope
   '/' — only one worker can control a given scope, so they're kept separate
   rather than fighting over '/'.

   This file is served as-is from public/ (not bundled by Vite), so it uses
   the compat SDK via importScripts — the standard approach for an unbundled
   service worker, per Firebase's own docs. */
importScripts('https://www.gstatic.com/firebasejs/12.17.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.17.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyB3xG2mXeH54ri-4xs81qA2WXgeE8bS4CU',
  authDomain: 'soac-493719.firebaseapp.com',
  projectId: 'soac-493719',
  storageBucket: 'soac-493719.firebasestorage.app',
  messagingSenderId: '303465255574',
  appId: '1:303465255574:web:990c1230f7c5ab9643e8b7',
});

const messaging = firebase.messaging();

/* Fires when a push arrives while no tab has focus (app closed / backgrounded).
   Foreground messages are handled separately via onMessage() in firebaseMessaging.js,
   since FCM does not run this handler while a tab is actively focused.

   Payloads are sent data-only (no top-level "notification" key, see webPush.js)
   so this handler is always the single source of truth for what gets shown —
   a "notification" key would make some browsers auto-display a system
   notification too, causing duplicates. */
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};

  self.registration.showNotification(data.title || 'SOAC RKU', {
    body: data.body || '',
    icon: '/images/icon-192.png',
    badge: '/images/icon-badge.png',
    data: { url: data.url || '/' },
  });

  /* App-icon badge count — carried in the payload since this worker has no
     logged-in session to fetch it itself (see badge.js / notify.js). */
  if ('setAppBadge' in self.navigator && data.badge !== undefined) {
    const count = parseInt(data.badge, 10) || 0;
    if (count > 0) self.navigator.setAppBadge(count).catch(() => {});
    else self.navigator.clearAppBadge().catch(() => {});
  }
});

/* TEMPORARY diagnostic — fires on every raw push event regardless of whether
   Firebase's SDK can parse it, so we can isolate "does the push event reach
   this worker at all on iOS" from "does firebase-messaging-compat.js's own
   parsing/onBackgroundMessage dispatch work correctly on Safari". Multiple
   listeners on the same event type all run, so this fires alongside
   onBackgroundMessage above, not instead of it. Safe to remove once iOS
   delivery is confirmed working. */
self.addEventListener('push', (event) => {
  let raw = '(no data)';
  try { raw = event.data ? event.data.text() : '(empty)'; } catch (e) { raw = `(unreadable: ${e.message})`; }
  event.waitUntil(
    self.registration.showNotification('🔧 Raw push received', {
      body: raw.slice(0, 150),
      icon: '/images/icon-192.png',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
