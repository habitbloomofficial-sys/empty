// The smallest service worker that makes Axis installable.
//
// It deliberately caches almost nothing. Axis is a live thing — every reply,
// every piece of memory and every action comes from the server on this
// machine, and serving any of that from a cache would show you yesterday's
// answer. What the browser wants in order to offer "Install" is a service
// worker with a fetch handler, and a page to show when the server isn't there.

const SHELL = "axis-shell-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll([OFFLINE, "/icon-192.png"]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Only page loads. Everything else — the API, the audio, the memory — goes
  // straight to the network, always.
  if (request.method !== "GET" || request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(async () => (await caches.match(OFFLINE)) ?? Response.error())
  );
});
