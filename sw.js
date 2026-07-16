const CACHE_NAME = 'vanta-v11-universal-import';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './pdf-import.js',
  './universal-import.js',
  './exercise-catalog.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/jszip.min.js',
  './manifest.webmanifest',
  './assets/vanta-logo.jpg',
  './assets/vanta-background.jpg',
  './assets/vanta-barbell-purple.jpg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

async function networkFirst(request, fallback) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    return (await caches.match(request)) || (fallback ? await caches.match(fallback) : Response.error());
  }
}

async function cacheFirstAndRefresh(request) {
  const cached = await caches.match(request);
  const refresh = fetch(request).then(async response => {
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);
  return cached || refresh || Response.error();
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, './index.html'));
    return;
  }

  const isCoreCode = /\.(?:js|css|webmanifest)$/i.test(url.pathname);
  event.respondWith(isCoreCode ? networkFirst(event.request) : cacheFirstAndRefresh(event.request));
});
