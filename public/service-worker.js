// Sev-1 kill switch: retire service worker control to recover stuck clients.
// This worker immediately activates, clears all caches, unregisters itself,
// and asks open tabs to reload to fetch fresh network HTML/assets.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    } catch (_) {
      // best effort
    }

    try {
      await self.registration.unregister();
    } catch (_) {
      // best effort
    }

    try {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        try { client.navigate(client.url); } catch (_) { /* noop */ }
      }
    } catch (_) {
      // best effort
    }
  })());
});
