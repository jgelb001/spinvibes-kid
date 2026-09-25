/* SpinVibes Clubhouse SW.
   HTML is fetched with cache:'no-store' so GitHub Pages' max-age never serves a stale build.
   Bump CACHE on every deploy. */
const CACHE = 'svkid-v19';   // bump on every deploy; activate deletes every other svkid-* cache
// They are NOT in ASSETS on purpose: the fetch handler below caches them on first use, so a kid
// who never opens the game never downloads 1.4 MB of hole art.
const ASSETS = ['./index.html', './manifest.json'];

// Self-healing cleanup (same as the app SW): runs on activate AND lazily on
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
