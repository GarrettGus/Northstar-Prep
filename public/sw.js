const CACHE = 'northstar-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(response => response || caches.match('/'))));
});

// Overdue reminders, expiring supplies and due restocks (see shared/digest.js and the daily
// cron in api/backup.js). The payload is deliberately small — a title, a summary line and a
// path to deep-link to — never household contents.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* ignore a malformed payload */ }
  const title = data.title || 'NorthStar Prep';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    data: { url: data.url || '/' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const existing = list.find(client => new URL(client.url).pathname === url);
    if (existing) return existing.focus();
    return self.clients.openWindow(url);
  }));
});
