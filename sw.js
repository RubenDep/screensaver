// sw.js — with detailed logs
const APP_CACHE = 'app-v3';
const RUNTIME_CACHE = 'videos-v3';
const APP_SHELL = [
  'index.html',
  'app.js',
  'styles/main.css',
  'manifest.json'
];

console.log('[SW] Starting service worker install...');

self.addEventListener('install', (event) => {
  console.log('[SW] Install event');
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => {
        console.log('[SW] Caching app shell:', APP_SHELL);
        return cache.addAll(APP_SHELL);
      })
      .then(() => {
        console.log('[SW] Install complete, skipping waiting');
        return self.skipWaiting();
      })
      .catch(err => console.error('[SW] Install error:', err))
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event');
  event.waitUntil((async () => {
    const keys = await caches.keys();
    console.log('[SW] Existing caches:', keys);
    await Promise.all(
      keys.filter(k => ![APP_CACHE, RUNTIME_CACHE].includes(k))
        .map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
    );
    console.log('[SW] Claiming clients');
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const isSameOrigin = url.origin === location.origin;

  if (request.method !== 'GET') return;

  console.log('[SW] Fetch:', url.href);

  // Handle app shell (cache-first)
  if (isSameOrigin && APP_SHELL.includes(url.pathname.replace(/^\//, ''))){
  console.log('[SW] Cache-first for app shell:', url.pathname);
  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) {
          console.log('[SW] → Served from cache:', url.pathname);
          return cached;
        }
        console.log('[SW] → Fetching from network:', url.pathname);
        return fetch(request)
          .then(resp => {
            const copy = resp.clone();
            caches.open(APP_CACHE).then(c => c.put(request, copy));
            return resp;
          });
      })
      .catch(err => {
        console.error('[SW] Cache-first fetch error:', err);
        return new Response('', { status: 500, statusText: 'SW Fetch Error' });
      })
  );
  return;
}

// Handle videos or anything else (runtime cache)
if (request.destination === 'video' || request.url.endsWith('.mp4')) {
  console.log('[SW] Runtime cache for video:', url.pathname);
}

event.respondWith((async () => {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) {
    console.log('[SW] → Served from runtime cache:', url.href);
    return cached;
  }

  try {
    console.log('[SW] → Fetching and caching:', url.href);
    const resp = await fetch(request, { credentials: 'omit' });
    cache.put(request, resp.clone());
    console.log('[SW] Cached new response for:', url.href);
    return resp;
  } catch (err) {
    console.error('[SW] Network fetch failed:', err);
    return new Response('', { status: 504, statusText: 'Offline' });
  }
})());
});
