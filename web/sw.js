// Service worker: caches the app shell so it keeps working offline / when
// reopened without a network connection. Bump CACHE_NAME whenever any
// cached file's content changes, so old clients pick up the new version.
const CACHE_NAME = "study-rest-clock-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./shared/clock.js",
  "./shared/sound-engine.js",
  "./shared/storage.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        // Cache each asset individually and tolerate any single failure
        // (e.g. an icon that hasn't been added yet) instead of aborting
        // the whole install via cache.addAll().
        Promise.all(
          ASSETS.map((asset) =>
            cache.add(asset).catch((err) => console.warn("SW: failed to cache", asset, err))
          )
        )
      )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});