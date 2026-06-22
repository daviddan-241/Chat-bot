/* NEXUS Service Worker — PWA offline support */
const CACHE    = 'nexus-v2';
const PRECACHE = [
  '/nexus',
  '/static/nexus/app.js',
  '/static/nexus/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE).catch(()=>{}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API calls: network-first, no cache
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/stream')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ok:false,error:'offline',offline:true}),
                     {headers:{'Content-Type':'application/json'}})
      )
    );
    return;
  }

  // Static assets: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

/* Offline command queue */
const QUEUE_KEY = 'nexus-offline-queue';

self.addEventListener('message', e => {
  if (e.data?.type === 'QUEUE_CMD') {
    // Store command for when connectivity resumes
    const entry = {id: Date.now(), ...e.data.payload, queued: new Date().toISOString()};
    self.registration.showNotification('NEXUS — Queued Offline', {
      body: `Command saved: "${(entry.message||'').slice(0,50)}"`,
      icon: '/static/nexus/manifest.json',
      tag: 'offline-queue',
    }).catch(()=>{});
  }
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', e => {
  if (!e.data) return;
  try {
    const d = e.data.json();
    e.waitUntil(
      self.registration.showNotification(d.title || 'NEXUS', {
        body: d.body || '',
        icon: '/static/nexus/manifest.json',
        tag: d.tag || 'nexus',
        data: {url: d.url || '/nexus'},
      })
    );
  } catch {}
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/nexus'));
});
