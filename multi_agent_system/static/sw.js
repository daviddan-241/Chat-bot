// NEXUS Service Worker — Offline + Push Notifications
const CACHE = 'nexus-v3';
const OFFLINE_URLS = [
  '/',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/manifest.json',
  '/static/logo.svg',
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(OFFLINE_URLS).catch(() => {}))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Network-first for API calls
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/chat') || url.pathname.startsWith('/task')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline — no connection', offline: true }),
          { status: 503, headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }
  // Cache-first for static assets
  if (url.pathname.startsWith('/static/')) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(r => {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return r;
      }))
    );
    return;
  }
  // Network-first for pages, fallback to cache
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

self.addEventListener('push', function(event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(_) {}
  const title   = data.title  || 'NEXUS';
  const body    = data.body   || 'Task complete!';
  const tag     = data.tag    || 'nexus-notif';
  const url     = data.url    || '/';
  const options = {
    body,
    icon:    '/static/icon-192.png',
    badge:   '/static/icon-192.png',
    tag,
    data:    { url },
    vibrate: [200, 100, 200],
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(location.origin) && 'focus' in c) { c.focus(); return; }
      }
      return clients.openWindow(url);
    })
  );
});
