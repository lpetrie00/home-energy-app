// Home Energy: keeps the page working offline, and shows push notifications once they're set up.
// Version 10 (2026-11-24): four full-screen pages, swiped sideways. The page is still fetched
// fresh whenever there's internet. With no internet, or a very slow connection, the saved copy shows.
// If caching or alerts fail, the page itself still loads.
const SHELL = "home-energy-shell-v10";
const DATA = "home-energy-data";
const FILES = ["./", "index.html", "setup.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
const PAGE_WAIT = 4000;     // milliseconds to wait for a fresh page before showing the saved one

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// a fresh copy, saved for next time; refused if it takes longer than `wait`
function fresh(request, wait) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("slow")), wait);
    fetch(request).then(response => {
      clearTimeout(timer);
      // an error page from the host (e.g. GitHub Pages answering 503) isn't a fresh copy: show the saved one
      if (!response.ok && response.type !== "opaqueredirect") return reject(new Error("status " + response.status));
      if (response.ok) { const copy = response.clone(); caches.open(SHELL).then(cache => cache.put(request, copy)); }
      resolve(response);
    }, error => { clearTimeout(timer); reject(error); });
  });
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;     // e.g. the private figures from GitHub: never cached here
  if (url.pathname.endsWith("app-data.json") || url.pathname.endsWith("live.json")) {
    // the figures (and, away from GitHub, the live link): always try the network first, fall back to the last copy
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(DATA).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }
  if (event.request.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith(".html")) {
    // the page: fresh when there's internet, the saved copy when there isn't
    event.respondWith(fresh(event.request, PAGE_WAIT).catch(() =>
      caches.match(event.request, { ignoreSearch: true }).then(saved => saved || caches.match("index.html"))
        .then(saved => saved || fetch(event.request))));
    return;
  }
  // icons and the like: the saved copy straight away, refreshed in the background
  event.respondWith(caches.match(event.request).then(saved => {
    const update = fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(SHELL).then(cache => cache.put(event.request, copy)); }
      return response;
    }).catch(() => saved);
    return saved || update;
  }));
});

self.addEventListener("push", event => {
  // Declarative Web Push ({"web_push": 8030, "notification": {...}}) or a plain {"title", "body"}.
  // Chrome 138 understands both. A bad payload, or a tablet that can't raise a notification,
  // must not break the page: try a plain note, and ignore a failure to remember it.
  let message = { title: "Home energy", body: "", navigate: "./" };
  try {
    const data = event.data ? event.data.json() : {};
    message = Object.assign(message, data.notification || data);
  } catch (e) {
    try { message.body = event.data ? event.data.text() : ""; } catch (e2) {}
  }
  const title = message.title || "Home energy";
  const data = { navigate: message.navigate || "./" };
  function show(options) { return self.registration.showNotification(title, options); }
  event.waitUntil(show({
    body: message.body, icon: "icon-192.png", badge: "icon-192.png", tag: message.tag || undefined, data: data,
  }).catch(() => show({ body: message.body || "New alert", data: data })).then(() =>
    caches.open(DATA).then(cache => cache.put("last-alert",
      new Response(JSON.stringify({ at: Date.now(), body: message.body }), { headers: { "Content-Type": "application/json" } }))).catch(() => {})
  ));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.navigate) || "./";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    if (!list.length) return self.clients.openWindow(target);
    return list[0].focus().catch(() => self.clients.openWindow(target));
  }).catch(() => {}));
});
