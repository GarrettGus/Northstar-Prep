// Caches the app shell and static assets only. Household data never goes into Cache Storage:
// API responses carry the household's records (including medications) and must not outlive a
// sign-out. Offline data lives in src/offline.js, which sign-out clears.
const CACHE = 'northstar-shell-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  // Drops earlier caches, which also held API responses.
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request).then(response => response || caches.match('/'))));
});

// Push notifications (daily digest, plan activation, a member needing help). Payloads carry
// counts and generic text only; see shared/digest.js and api/go.js.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  event.waitUntil(self.registration.showNotification(data.title || 'NorthStar Prep', {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    requireInteraction: Boolean(data.requireInteraction),
    data: {url: data.url || '/'},
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  // Only ever open a page of this app, whatever the payload says.
  let target = new URL('/', self.location.origin);
  try { const candidate = new URL(event.notification.data?.url || '/', self.location.origin); if (candidate.origin === self.location.origin) target = candidate; } catch { /* keep "/" */ }
  event.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(windows => {
    const open = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (open) return open.navigate(target.href).then(client => (client || open).focus());
    return self.clients.openWindow(target.href);
  }));
});
