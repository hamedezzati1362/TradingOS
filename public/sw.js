// Offline shell. App files: network-first (always fresh when online), cache fallback when offline.
// Market data (data/*.json, later) is never served from here as LIVE: the app labels its age itself.
const CACHE = 'tradingos-shell-v6';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'assets/css/app.css', 'assets/js/main.js', 'assets/js/config.js',
  'assets/js/i18n.js', 'assets/js/engines/time-engine.js', 'assets/js/engines/session-engine.js',
  'assets/js/core/condition-engine.js', 'assets/js/core/provider-manager.js', 'assets/js/core/validators.js',
  'assets/js/core/market-engines.js', 'assets/js/data-client.js', 'assets/js/core/impact-kb.js', 'assets/js/core/macro-engine.js',
  'assets/icons/icon.svg', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;   // fonts etc. go to the network
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((r) => r || caches.match('index.html'))));
});
