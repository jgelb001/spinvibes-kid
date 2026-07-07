/* SpinVibes Clubhouse SW — v1
   Lesson from app (session 49): fetch HTML with cache:'no-store' so Pages'
   max-age never serves a stale build; bump CACHE on deploys. */
const CACHE = 'svkid-v11'; // 2026-07-06 s54b: premium avatar rendering (gradient shading, steel/gold club metals)
const ASSETS = ['./index.html', './manifest.json'];

// Self-healing cleanup (same fix as app SW, s54): runs on activate AND lazily on
// fetch, so an interrupted activate can't leave stale svkid-* caches behind.
let _cleaned = false;
function cleanupOldCaches() {
  return caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith('svkid-') && k !== CACHE).map(k => caches.delete(k)))
  ).then(() => { _cleaned = true; });
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(cleanupOldCaches().then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (!_cleaned) e.waitUntil(cleanupOldCaches());
  const req = e.request;
  if (req.method !== 'GET') return;
  const isHTML = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isHTML) {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return res; })
        .catch(() => caches.match(req).then(m => m || caches.match('./index.html')))
    );
  } else {
    e.respondWith(
      caches.match(req).then(m => m || fetch(req).then(res => {
        const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return res;
      }))
    );
  }
});
