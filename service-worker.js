/* service-worker.js – offline app shell. Bump VERSION on every release so users get the update prompt. */
const VERSION = 'cm-v1.0.0';
const SHELL = ['./', './index.html', './style.css', './app.js', './database.js', './billing.js', './reports.js', './invoice.js', './backup.js', './firebase.js', './manifest.json', './assets/icons/icon-192.png', './assets/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));   // no skipWaiting: the user chooses when to update
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'cm-ext').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // navigation: network-first would delay offline start, so serve cached shell
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
  } else if (url.hostname === 'www.gstatic.com') {
    // Firebase SDK modules (only requested when cloud backup is configured): cache for offline reuse
    e.respondWith(caches.open('cm-ext').then(async (c) => { const hit = await c.match(req); const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit); return hit || net; }));
  }
});
