const CACHE = "vidya-final-2026-08-27-v2";
const CORE = ["./", "./index.html", "./styles.css", "./auth.js", "./app.js", "./assistant.js", "./config.js", "./manifest.json", "./icon-180.png", "./icon-192.png", "./icon-512.png", "./vendor/pdf.min.js", "./vendor/pdf.worker.min.js", "./vendor/mammoth.browser.min.js"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response;
  }).catch(() => caches.match(event.request).then(response => response || caches.match("./index.html"))));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const taskId = event.notification.data?.taskId || "";
  const suffix = taskId ? `#action=reminder&task=${encodeURIComponent(taskId)}` : "#action=brief&kind=morning";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    const existing = windows[0];
    if (existing) return existing.navigate(`./index.html${suffix}`).then(client => client.focus());
    return clients.openWindow(`./index.html${suffix}`);
  }));
});
