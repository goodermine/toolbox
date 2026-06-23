/*
 * Service worker — makes Image Toolbox installable and offline-capable.
 * Strategy:
 *   - navigations: network-first (fresh pages online, cached offline)
 *   - same-origin assets: cache-first with runtime caching (so big vendored
 *     libraries/models are cached on first use, then work offline)
 * Bump CACHE to invalidate after a deploy.
 */
const CACHE = "toolbox-v1";

const SHELL = [
  "./", "./index.html", "./styles.css", "./shared.js", "./app.js", "./upscale.js",
  "./heic/", "./heic/heic.js",
  "./compress/", "./compress/compress.js",
  "./metadata/", "./metadata/metadata.js",
  "./background/", "./background/background.js",
  "./og-image.png", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // Don't let one missing file abort the whole install.
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // only handle our own assets

  // Big, immutable third-party libraries/models: cache-first (fast + offline).
  if (url.pathname.includes("/vendor/")) {
    e.respondWith(
      caches.match(req).then((hit) =>
        hit || fetch(req).then((res) => { cachePut(req, res); return res; })
      )
    );
    return;
  }

  // App shell + pages: network-first so deploys take effect immediately,
  // falling back to cache when offline.
  e.respondWith(
    fetch(req)
      .then((res) => { cachePut(req, res); return res; })
      .catch(() => caches.match(req).then((hit) =>
        hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined)
      ))
  );
});

function cachePut(req, res) {
  if (res && res.status === 200 && res.type === "basic") {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
}
