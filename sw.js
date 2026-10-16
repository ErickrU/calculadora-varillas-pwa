/* ==========================================================================
   Calculadora de Varillas · Service Worker
   --------------------------------------------------------------------------
   La app es 100 % cliente (no consume APIs), así que basta con precachear el
   app shell y servirlo desde caché:

     navegación         -> network-first -> cache(index.html) -> offline.html
     app shell (css/js/iconos/manifest)
                        -> cache-first + revalidación en segundo plano
     resto same-origin  -> network con respaldo de caché

   Sube VERSION para invalidar los caches viejos en el siguiente despliegue.
   ========================================================================== */

const VERSION = 'v4';
const CACHE_SHELL = `calculadora-varillas-shell-${VERSION}`;

/** App shell: lo mínimo para que la app abra y calcule sin red. */
const PRECACHE = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './sw.js',
  './css/estilos.css',
  './js/app.js',
  './js/calculo.js',
  './js/registro-sw.js',
  './iconos/favicon.svg',
  './iconos/icono-192.png',
  './iconos/icono-512.png',
  './iconos/icono-maskable-512.png',
  './iconos/apple-touch-icon.png',
];

const absoluta = (ruta) => new URL(ruta, self.registration.scope).toString();

/* ==========================================================================
   INSTALL · precache tolerante a fallos
   ========================================================================== */
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_SHELL);

      // addAll falla en bloque si un solo recurso da error; lo hacemos uno a uno
      // para que un archivo ausente no impida instalar el service worker.
      const resultados = await Promise.allSettled(
        PRECACHE.map(async (ruta) => {
          const peticion = new Request(absoluta(ruta), { cache: 'reload' });
          const respuesta = await fetch(peticion);
          if (!respuesta.ok) throw new Error(`${ruta} -> ${respuesta.status}`);
          await cache.put(peticion, respuesta);
        }),
      );

      const fallos = resultados.filter((r) => r.status === 'rejected');
      if (fallos.length > 0) {
        console.warn('[SW] recursos no precacheados:', fallos.map((f) => f.reason?.message));
      }
    })(),
  );
});

/* ==========================================================================
   ACTIVATE · limpieza de caches antiguos
   ========================================================================== */
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      const nombres = await caches.keys();
      await Promise.all(
        nombres
          .filter((nombre) => nombre.startsWith('calculadora-varillas-') && nombre !== CACHE_SHELL)
          .map((nombre) => caches.delete(nombre)),
      );

      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.enable(); } catch { /* opcional */ }
      }

      await self.clients.claim();
    })(),
  );
});

/* ==========================================================================
   MESSAGE · la página pide activar la versión nueva
   ========================================================================== */
self.addEventListener('message', (evento) => {
  if (evento.data?.tipo === 'SALTAR_ESPERA') self.skipWaiting();
});

/* ==========================================================================
   Helpers
   ========================================================================== */

/** Guarda en caché solo respuestas útiles (200 y no opacas). */
const esGuardable = (respuesta) => respuesta && respuesta.ok && respuesta.type !== 'opaque';

/* --------------------------- cache-first -------------------------------- */
async function cachePrimero(peticion) {
  const cache = await caches.open(CACHE_SHELL);
  const guardada = await cache.match(peticion);

  if (guardada) {
    // Revalidamos en segundo plano para la próxima visita.
    fetch(peticion)
      .then((respuesta) => { if (esGuardable(respuesta)) cache.put(peticion, respuesta); })
      .catch(() => {});
    return guardada;
  }

  const respuesta = await fetch(peticion);
  if (esGuardable(respuesta)) cache.put(peticion, respuesta.clone());
  return respuesta;
}

/* --------------------------- network-first ------------------------------ */
async function redPrimero(peticion) {
  const cache = await caches.open(CACHE_SHELL);
  try {
    const respuesta = await fetch(peticion);
    if (esGuardable(respuesta)) cache.put(peticion, respuesta.clone());
    return respuesta;
  } catch (error) {
    const guardada = await cache.match(peticion);
    if (guardada) return guardada;
    throw error;
  }
}

/* --------------------------- navegación --------------------------------- */
async function navegacion(evento) {
  const cache = await caches.open(CACHE_SHELL);
  try {
    const respuesta = (await evento.preloadResponse) || (await fetch(evento.request));
    if (esGuardable(respuesta)) cache.put(evento.request, respuesta.clone());
    return respuesta;
  } catch {
    return (
      (await cache.match(evento.request)) ||
      (await cache.match(absoluta('./index.html'))) ||
      (await cache.match(absoluta('./'))) ||
      (await cache.match(absoluta('./offline.html'))) ||
      new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    );
  }
}

/* ==========================================================================
   FETCH · enrutado
   ========================================================================== */
self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;

  // Solo GET: nada más se cachea.
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);

  // Dejamos pasar lo que no es de nuestro origen.
  if (url.origin !== self.location.origin) return;

  // 1. Navegaciones
  if (peticion.mode === 'navigate') {
    evento.respondWith(navegacion(evento));
    return;
  }

  // 2. App shell
  if (/\.(?:css|js|mjs|svg|png|webp|woff2?|webmanifest)$/.test(url.pathname)) {
    evento.respondWith(cachePrimero(peticion));
    return;
  }

  // 3. Resto: red con respaldo de caché.
  evento.respondWith(redPrimero(peticion));
});
