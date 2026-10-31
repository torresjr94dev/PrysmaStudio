// Service worker de vitroPDF: caché en tiempo de ejecución, sin precarga.
// Los datos móviles en México son caros: el motor (~3.6 MB comprimido) solo se descarga
// cuando alguien usa una herramienta, y desde ahí funciona sin conexión.
const CACHE = "vitropdf-v1";

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

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function networkFirstPage(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put("/index.html", response.clone());
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
    event.respondWith(cacheFirst(request));
  } else if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
  }
});
