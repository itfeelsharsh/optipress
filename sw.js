/* Opti service worker — offline-first, but never stale HTML. */
const CACHE_VERSION = '__BUILD__';
const CACHE_NAME = 'opti-' + CACHE_VERSION;

const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './core.js',
  './presets.js',
  './padding.js',
  './compressor.js',
  './pdf-tools.js',
  './app.js',
  './manifest.json',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png',
  './fonts/ibm-plex-mono-400-latin.woff2',
  './fonts/ibm-plex-mono-500-latin.woff2',
  './fonts/ibm-plex-mono-600-latin.woff2',
  './fonts/instrument-sans-latin.woff2',
  './lib/pdf.min.js',
  './lib/pdf.worker.min.js',
  './lib/pdf-lib.min.js',
  './lib/heic2any.min.js',
  './lib/jszip.min.js',
  './lib/ocr/tesseract.min.js',
  './lib/ocr/worker.min.js',
  './lib/ocr/core/tesseract-core-simd-lstm.wasm.js',
  './lib/ocr/lang/eng.traineddata.gz'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => (key.startsWith('opti-') || key.startsWith('optipress-')) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations go to the network first so a deploy is visible immediately.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // Assets: serve cached instantly, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
