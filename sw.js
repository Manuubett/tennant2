const CACHE = "sanefi-v1";
const SHELL = [
  "index.html", "login.html", "signup.html", "portal.html", "dashboard.html",
  "app-style.css", "firebase-config.js", "auth-role.js", "mpesa-parser.js",
  "notifications.js", "portal.js", "login.js",
  "icon-192.png", "icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll fails if any file is missing, so add files one by one instead
      .then((c) => Promise.all(SHELL.map((f) => c.add(f).catch(() => {}))))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Firebase scripts from gstatic: cache-first (versioned URLs never change)
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

  // Never touch Firestore / Auth / other API traffic
  if (url.origin !== location.origin) return;

  // Your own files: network-first so edits show up, cache as offline fallback
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req))
  );
});
