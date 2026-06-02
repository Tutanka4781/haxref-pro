// ── HaxRef Pro Service Worker ──
// CACHE_VERSION es solo informativo — no necesita incrementarse manualmente.
// La estrategia network-first garantiza contenido fresco con conexión.
const CACHE_VERSION = 'haxref-v2.5';
const CACHE_NAME = `haxref-cache-${CACHE_VERSION}`;

// Archivos que se precargan en la instalación (fallback offline)
const PRECACHE = [
  '/haxref-pro/app/',
  '/haxref-pro/app/index.html',
  '/haxref-pro/app/haxref.js',
  '/haxref-pro/app/haxref.css',
  '/haxref-pro/app/sw-register.js',
  '/haxref-pro/app/manifest.json',
  '/haxref-pro/app/icon.svg',
  '/haxref-pro/app/ligas.html',
  '/haxref-pro/app/guia.html',
];

// ── INSTALL: cachear archivos base ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar cachés viejas ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('haxref-cache-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: network-first con fallback a caché ──
// Con conexión: siempre sirve desde la red y actualiza el caché.
// Sin conexión: sirve el caché si existe.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      fetch(event.request)
        .then(response => {
          // Respuesta válida — actualizar caché y servir
          if (response && response.status === 200) {
            cache.put(event.request, response.clone());
          }
          return response;
        })
        .catch(() =>
          // Sin red — intentar servir desde caché
          cache.match(event.request)
        )
    )
  );
});

// ── MESSAGE: recibir orden de actualizar desde la app ──
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
