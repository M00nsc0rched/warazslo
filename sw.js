// Warázsló service worker: offline gyorsítótár
// A VERSION értékét a tools/deploy.ps1 minden kiadásnál automatikusan lépteti.
// A nagy könyvtárak (CAD kernel ~23 MB) külön, tartós gyorsítótárban vannak: csak a
// VENDOR_VERSION változásakor töltődnek le újra.
const VERSION = 'v20260929-153502';
const VENDOR_VERSION = 'three186-replicad110';
const APP_CACHE = `warazslo-app-${VERSION}`;
const VENDOR_CACHE = `warazslo-vendor-${VENDOR_VERSION}`;

const APP_CORE = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png', './icons/logo-256.png', './icons/favicon-64.png',
];
const VENDOR_CORE = [
  './vendor/three/three.module.js', './vendor/three/three.core.js',
  './vendor/replicad/replicad.js', './vendor/replicad/casting-rs4QjB74.js',
  './vendor/occt/replicad_single.js', './vendor/occt/replicad_single.wasm',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const app = await caches.open(APP_CACHE);
    await app.addAll(APP_CORE);
    const vendor = await caches.open(VENDOR_CACHE);
    for (const url of VENDOR_CORE) {
      if (!(await vendor.match(url))) await vendor.add(url);
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('warazslo-') && k !== APP_CACHE && k !== VENDOR_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Az alkalmazás fájljai: hálózat először (friss kód), hiba esetén gyorsítótár.
// A vendor fájlok: gyorsítótár először.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const isVendor = url.pathname.includes('/vendor/');
  e.respondWith((async () => {
    if (isVendor) {
      const cache = await caches.open(VENDOR_CACHE);
      const hit = await cache.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }
    const cache = await caches.open(APP_CACHE);
    const net = fetch(e.request).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    });
    // lassú hálózaton 4 mp után a gyorsítótárból szolgálunk ki (a letöltés közben frissíti)
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
    try {
      const res = await Promise.race([net, timeout]);
      if (res) return res;
      const hit = await cache.match(e.request, { ignoreSearch: true });
      return hit || await net;
    } catch (err) {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
