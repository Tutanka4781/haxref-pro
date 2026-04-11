// ── HaxRef Pro Service Worker ──
// Incrementa CACHE_VERSION con cada release para forzar actualización
const CACHE_VERSION = 'haxref-v2.3.0';
const CACHE_NAME = `haxref-cache-${CACHE_VERSION}`;

// Archivos que se cachean en la instalación
const PRECACHE = [
  '/haxref-pro/app/',
  '/haxref-pro/app/index.html',
  '/haxref-pro/app/manifest.json',
  '/haxref-pro/app/icon.svg',
];

// ── INSTALL: cachear archivos base ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()) // activar inmediatamente
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
    ).then(() => self.clients.claim()) // tomar control de todas las pestañas
  );
});

// ── FETCH: servir desde caché, actualizar en segundo plano ──
self.addEventListener('fetch', event => {
  // Solo manejar peticiones GET del mismo origen
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        // Fetch en segundo plano para actualizar la caché
        const fetchPromise = fetch(event.request)
          .then(response => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch(() => null);

        // Servir desde caché si existe, si no esperar la red
        return cached || fetchPromise;
      })
    )
  );
});

// ── MESSAGE: recibir orden de actualizar desde la app ──
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
