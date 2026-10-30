// Velaris Kasa service worker: uygulama kabuğunu önbelleğe alır, böylece internet/sunucu
// kesildiğinde de arayüz açılır. /api istekleri asla önbelleğe alınmaz.
const CACHE = 'velaris-kasa-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;

  if (e.request.mode === 'navigate') {
    // Sayfa: önce ağ, olmazsa önbellek
    e.respondWith(fetch(e.request).then((res) => {
      caches.open(CACHE).then((c) => c.put('./index.html', res.clone()));
      return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  // Statik dosyalar: önce önbellek, arka planda yenile
  e.respondWith(caches.match(e.request).then((hit) => {
    const net = fetch(e.request).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
