import { precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

/* injectManifest strategy replaces this at build time with the versioned asset
   list, giving correct cache invalidation on every deploy. */
precacheAndRoute(self.__WB_MANIFEST);

self.skipWaiting();
clientsClaim();

/* ── Push notifications ── */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  const title = data.title || 'SOAC RKU';
  const options = {
    body: data.body || '',
    icon: '/images/icon-192.png',
    badge: '/images/icon-badge.png',
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* Focus an already-open tab on the target URL if one exists, otherwise open a new one. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
