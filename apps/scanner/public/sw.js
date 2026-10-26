/* eslint-disable no-restricted-globals */
/**
 * Service worker de Tatami Pass Scanner.
 * - Precache del build (la lista `PRECACHE` la rellena vite.config.ts al compilar).
 * - Shell y assets con hash: cache-first (abren sin red).
 * - Navegaciones: network-first con fallback al index.html cacheado.
 * - API del host (/sync, /auth, /devices, /health, en cualquier origen):
 *   network-first; solo los GET se guardan como último recurso si no hay red.
 * - Actualización: la versión nueva queda en espera hasta que la app manda
 *   SKIP_WAITING ("Hay una versión nueva · Actualizar").
 */
const VERSION = '__BUILD_ID__';
const PRECACHE = __PRECACHE__;
const SHELL_CACHE = `tp-shell-${VERSION}`;
const API_CACHE = 'tp-api-v1';
const API_PATHS = ['/sync/', '/auth/', '/devices', '/health'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' })))).catch(() => undefined)
  );
  // No skipWaiting aquí: la app decide cuándo actualizar.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tp-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isApi(url) {
  return API_PATHS.some((p) => url.pathname.startsWith(p));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (isApi(url)) {
    if (req.method !== 'GET') return; // POST /sync/events, enroll, login: nunca se cachean.
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok && url.pathname === '/sync/snapshot') {
          const copy = res.clone();
          caches.open(API_CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
        }
        return res;
      }).catch(async () => (await caches.match(req)) || Response.error())
    );
    return;
  }

  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy)).catch(() => undefined);
        return res;
      }).catch(async () => (await caches.match('/index.html')) || (await caches.match('/')) || Response.error())
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
      }
      return res;
    }))
  );
});
