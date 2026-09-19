/* FloodShield AI service worker — offline/low-connectivity support.
   App shell: cache-first. API GETs: network-first with cached fallback (maps, rainfall,
   predictions, drainage, emergency contacts). Map tiles: stale-while-revalidate. */
const SHELL = "fs-shell-v1";
const DATA = "fs-data-v1";
const TILES = "fs-tiles-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/index.html", "/favicon.svg", "/manifest.webmanifest"])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/ws")) return;
  if (url.pathname.startsWith("/api/")) {
    if (url.pathname.endsWith(".pdf")) return;
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((m) => m || new Response(JSON.stringify({ offline: true, detail: "Offline and not cached" }), { status: 503, headers: { "Content-Type": "application/json" } })))
    );
    return;
  }
  if (url.hostname.endsWith("tile.openstreetmap.org")) {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req).then((m) => m || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match("/index.html"))));
  }
});
