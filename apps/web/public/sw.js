// Service worker de PrysmaStudio: caché en tiempo de ejecución, sin precarga.
// Los datos móviles en México son caros: el motor (~4.8 MB comprimido) solo se descarga
// cuando alguien usa una herramienta, y desde ahí funciona sin conexión.
const CACHE = "prysma-v1";
/** Cada deploy deja ~10 archivos con hash nuevos; sin tope, la caché crecería para siempre. */
const MAX_ASSETS = 80;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

/** Borra los assets más antiguos (Cache conserva el orden de inserción). */
async function trimAssets(cache) {
  const assets = (await cache.keys()).filter((request) => new URL(request.url).pathname.startsWith("/assets/"));
  const excess = assets.length - MAX_ASSETS;
  if (excess > 0) await Promise.all(assets.slice(0, excess).map((request) => cache.delete(request)));
}

/**
 * La respuesta se devuelve DE INMEDIATO y la copia se guarda en paralelo con waitUntil.
 * Regresión: esperar a cache.put() antes de devolver bloqueaba la descarga del WASM (10 MB) durante
 * minutos — la rama clonada llenaba su búfer mientras nadie consumía la original.
 */
async function cacheFirst(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (response.ok) {
    event.waitUntil(
      cache
        .put(event.request, response.clone())
        .then(() => trimAssets(cache))
        .catch(() => undefined),
    );
  }
  return response;
}

async function networkFirstPage(event) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(event.request);
    if (response.ok) event.waitUntil(cache.put("/index.html", response.clone()).catch(() => undefined));
    return response;
  } catch (error) {
    const cached = await cache.match("/index.html");
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Nunca se cachea la API ni nada de otro origen.
  if (url.origin !== self.location.origin || url.pathname.startsWith("/v1/")) return;

  if (url.pathname.startsWith("/assets/")) {
    // Archivos con hash en el nombre: inmutables.
    event.respondWith(cacheFirst(event));
  } else if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(event));
  }
});
