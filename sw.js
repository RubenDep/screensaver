// Cache app shell + cache-while-playing videos.
const APP_CACHE = 'app-v1';
const RUNTIME_CACHE = 'videos-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/styles/main.css',
  '/manifest.json'
];


self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});


self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => ![APP_CACHE, RUNTIME_CACHE].includes(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});


self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);


// App shell: cache-first
  if (request.method === 'GET' && (url.origin === location.origin) && APP_SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
    return;
  }


// Videos & everything else: runtime cache (cache-first, fall back to network)
  if (request.method === 'GET') {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(request, { ignoreVary: true, ignoreSearch: false });
      if (cached) return cached;
      try {
        const resp = await fetch(request, { credentials: 'omit' });
// Put a clone into cache (opaque ok)
        cache.put(request, resp.clone());
        return resp;
      } catch (err) {
// offline and not cached
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })());
  }
});
