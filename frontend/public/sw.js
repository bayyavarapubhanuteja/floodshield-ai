/* FloodShield AI service worker — offline/low-connectivity support.
   App shell: cache-first. API GETs: network-first with cached fallback (maps, rainfall,
   predictions, drainage, emergency contacts). Map tiles: stale-while-revalidate. */
const SHELL = "fs-shell-v2";
const DATA = "fs-data-v2";
const TILES = "fs-tiles-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/index.html", "/favicon.svg", "/manifest.webmanifest"])));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  // drop caches from previous versions so a new deploy is picked up immediately
  const keep = [SHELL, DATA, TILES];
  for (const k of await caches.keys()) if (k.startsWith("fs-") && !keep.includes(k)) await caches.delete(k);
  await self.clients.claim();
})()));
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
    // HTML/navigations: network-first so a new deployment is never masked by the cache.
    // Hashed build assets (/assets/*): cache-first, they are immutable.
    const isDoc = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
    if (isDoc) {
      e.respondWith(fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put("/index.html", copy)); }
        return res;
      }).catch(() => caches.match("/index.html").then((m) => m || Response.error())));
      return;
    }
    e.respondWith(caches.match(req).then((m) => m || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match("/index.html"))));
  }
});
