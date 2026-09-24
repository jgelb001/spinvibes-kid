/* SpinVibes Clubhouse SW — v1
   Lesson from app (session 49): fetch HTML with cache:'no-store' so Pages'
   max-age never serves a stale build; bump CACHE on deploys. */
const CACHE = 'svkid-v19'; // 2026-09-24: B14d aim terminals sit on the side / in the order their words say (pys.js aimTerminals + bank.json aimSide) + B16 four age bands (k46/k68/k912/teen), DRILLS/WEEKLY regenerated from iOS + B80 nickname escaped at every innerHTML sink. (v18 2026-09-21: B58b — hole maps preload/retry/prefetch + bottom-nav clearance; SW no longer caches error responses. (v17 2026-09-20: Pick Your Shot pys/ assets.)
// They are NOT in ASSETS on purpose: the fetch handler below caches them on first use, so a kid
// who never opens the game never downloads 1.4 MB of hole art.
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
        .then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return res; })
        .catch(() => caches.match(req).then(m => m || caches.match('./index.html')))
    );
  } else {
    e.respondWith(
      caches.match(req).then(m => m || fetch(req).then(res => {
        // Only a good response is worth keeping. A 404/5xx cached here would be served cache-first
        // FOREVER, so "Try again" on a hole map could never succeed.
        if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
        return res;
      }))
    );
  }
});
