// Warázsló service worker: offline gyorsítótár
// A VERSION értékét minden kiadásnál növelni kell (tools/bump-version.ps1).
const VERSION = 'v1';
const CACHE = `warazslo-${VERSION}`;
const CORE = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png', './icons/logo-256.png', './icons/favicon-64.png',
  './vendor/three/three.module.js', './vendor/three/three.core.js',
  './vendor/replicad/replicad.js', './vendor/replicad/casting-rs4QjB74.js',
  './vendor/occt/replicad_single.js', './vendor/occt/replicad_single.wasm',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('warazslo-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Stratégia: az alkalmazás fájljai hálózat először (friss kód), hiba esetén gyorsítótár;
// a nagy vendor fájlok (wasm) gyorsítótár először.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isVendor = url.pathname.includes('/vendor/');
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isVendor) {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
