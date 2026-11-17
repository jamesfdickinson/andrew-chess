const CACHE = 'andrew-chess-__CACHE_VERSION__';
const SHELL = __PRECACHE_URLS__;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('andrew-chess-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Studio and recording APIs always use the network.
  if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html', { cacheName: CACHE })));
  } else if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(request, { cacheName: CACHE }).then(cached => cached || fetch(request)));
  }
});
