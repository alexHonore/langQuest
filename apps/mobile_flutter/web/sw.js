// LangQuest web app — works offline once it has been opened.
//
// Network first: every request goes to the server, so a redeploy shows on the next load; the cached copy is used only
// when the network fails. Same-origin GET requests only: the account API and Supabase (other hosts) are never cached.
// Once the app has started, flutter_bootstrap.js sends the list of files this browser actually loaded (its CanvasKit
// variant, fonts, content bundle), so one visit is enough to open the app offline.
const CACHE = 'langquest-v1';

const sameOrigin = (url) => {
  try {
    return new URL(url, self.location.href).origin === self.location.origin;
  } catch (_) {
    return false;
  }
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const urls = event.data && event.data.type === 'precache' && Array.isArray(event.data.urls) ? event.data.urls : [];
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.all(urls.filter(sameOrigin).map((url) => cache.add(url).catch(() => undefined)))),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !sameOrigin(request.url)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') cache.put(request, response.clone()).catch(() => undefined);
        return response;
      } catch (error) {
        const cached = (await cache.match(request, { ignoreSearch: true })) || (request.mode === 'navigate' ? await cache.match(new URL('./', self.location.href).href) : undefined);
        if (cached) return cached;
        throw error;
      }
    })(),
  );
});
