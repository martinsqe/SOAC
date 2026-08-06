import { precacheAndRoute } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

/* injectManifest strategy replaces this at build time with the versioned asset
   list, giving correct cache invalidation on every deploy. */
precacheAndRoute(self.__WB_MANIFEST);

self.skipWaiting();
clientsClaim();

/* Push notifications are handled by the dedicated firebase-messaging-sw.js,
   registered on its own scope (see src/firebaseMessaging.js) — this worker
   only owns PWA installability, precaching, and update lifecycle. */
