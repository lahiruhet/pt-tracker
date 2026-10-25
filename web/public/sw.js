// Minimal offline support: the app shell and hashed assets come from cache when there's no
// signal, so the app still opens and shows the last synced data. API calls are never cached.
const CACHE = "pt-shell-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      const res = await fetch("/", { credentials: "include" });
      if (res.ok && res.type === "basic") await cache.put("/", res);
    }).catch(() => {}),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/cdn-cgi/")) return;

  if (req.mode === "navigate") {
    // Network first (so sign-in redirects and new versions work), cached shell when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") caches.open(CACHE).then((c) => c.put("/", res.clone()));
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || /\.(svg|png|webmanifest|woff2?)$/.test(url.pathname)) {
    // Hashed files never change: cache first.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok && res.type === "basic") caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
  }
});
