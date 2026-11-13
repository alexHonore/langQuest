// LangQuest web app — works offline once it has been opened.
//
// Network first: every request goes to the server, so a redeploy shows on the next load; the cached copy is used only
// when the network fails. Same-origin GET requests, and the course content read from the content bucket; the account
// API and the rest of Supabase are never cached.
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

// A course the learner left: its kept content goes (only what the learner selected stays on the device).
const courseFile = (url, track) =>
  new RegExp(`/content/(chapters|voices|narration/[a-z]+)/${track.replace(/[^a-z-]/g, '')}(\\.[0-9a-f]+)?\\.json$`).test(new URL(url).pathname);

async function forgetCourse(track) {
  const cache = await caches.open(CACHE);
  for (const request of await cache.keys()) if (courseFile(request.url, track)) await cache.delete(request);
}

// After a new release (a new `index.json`), the copies it no longer names go.
async function keepOnly(index) {
  const files = new Set(Object.values((index && index.files) || {}));
  const cache = await caches.open(CACHE);
  for (const request of await cache.keys()) {
    const m = /\/langquest-content\/(content\/.+\.json)$/.exec(new URL(request.url).pathname);
    if (m && !files.has(decodeURIComponent(m[1]))) await cache.delete(request);
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'forget-course' && typeof event.data.track === 'string') {
    event.waitUntil(forgetCourse(event.data.track));
    return;
  }
  const urls = event.data && event.data.type === 'precache' && Array.isArray(event.data.urls) ? event.data.urls : [];
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.all(urls.filter(sameOrigin).map((url) => cache.add(url).catch(() => undefined)))),
  );
});

// The content bucket (another host): the JSON the app read for the learner's courses is kept, so the app opens offline.
// Its files are named by their content, so a kept copy is always right (cache first); only `index.json` changes, so it
// goes to the network first. Voice clips are left to the browser's own cache.
const bucketContent = (url) => /\/langquest-content\/(index\.json|content\/.+\.json)$/.test(new URL(url).pathname);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method === 'GET' && !sameOrigin(request.url) && bucketContent(request.url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const isIndex = new URL(request.url).pathname.endsWith('/index.json');
        if (!isIndex) {
          const kept = await cache.match(request);
          if (kept) return kept;
        }
        try {
          const response = await fetch(request);
          if (response.ok) {
            cache.put(request, response.clone()).catch(() => undefined);
            if (isIndex) response.clone().json().then(keepOnly).catch(() => undefined);
          }
          return response;
        } catch (error) {
          const kept = await cache.match(request);
          if (kept) return kept;
          throw error;
        }
      })(),
    );
    return;
  }
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
