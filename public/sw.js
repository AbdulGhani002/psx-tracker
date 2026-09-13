// Minimal, safe service worker.
// Caches ONLY immutable build assets (/_next/static, fonts, icons) cache-first —
// they're content-hashed so this can never go stale. Pages and API calls are NOT
// intercepted: financial data always comes from the network, never a stale cache.
const CACHE = "psx-static-v2";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isImmutable =
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || url.pathname.endsWith(".woff2") || url.pathname.startsWith("/icon-"));
  if (!isImmutable || event.request.method !== "GET") return; // pass through untouched

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(event.request);
      if (hit) return hit;
      const res = await fetch(event.request);
      if (res.ok) cache.put(event.request, res.clone());
      return res;
    })
  );
});
