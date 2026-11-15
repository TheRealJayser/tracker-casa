// Service worker: rende l'app installabile e usabile anche con rete scarsa.
// Ad ogni release cambia CACHE (stesso numero di version.js).
const CACHE = "tracker-casa-1.4.1";
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "version.js", "seed.js",
  "firebase-config.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/icon.svg", "icons/favicon-32.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
  if (url.pathname.startsWith("/__/")) return; // login e configurazione Firebase: mai in cache

  // SDK Firebase dal CDN: cache-first (file versionati, non cambiano)
  if (url.hostname === "www.gstatic.com") {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // File dell'app: prima la rete (sempre aggiornati), poi la cache se offline
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match("index.html")))
    );
  }
});
