// Sutradhar — Minimal Service Worker for Offline Shell Caching
// Strategy: Cache-first for static shell routes, network-first for API calls.

const CACHE_NAME = "sutradhar-shell-v1";

// App shell routes to pre-cache on install
const SHELL_URLS = [
  "/",
  "/copilot",
  "/ingestion",
  "/graph-explorer",
];

// Install: pre-cache the app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SW] Pre-caching app shell");
      return cache.addAll(SHELL_URLS).catch((err) => {
        // Non-fatal: shell caching may fail in dev (HMR URLs differ)
        console.warn("[SW] Shell pre-cache partial failure:", err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log("[SW] Deleting old cache:", key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for shell
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Always go to network for:
  // 1. API calls (backend)
  // 2. Non-GET requests
  // 3. Browser extensions / chrome-extension
  if (
    event.request.method !== "GET" ||
    url.pathname.startsWith("/api/") ||
    url.port === "8000" ||
    url.protocol === "chrome-extension:"
  ) {
    return; // Let browser handle it normally
  }

  // Cache-first for static shell navigation
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      // Not in cache — fetch from network and cache the response
      return fetch(event.request)
        .then((response) => {
          // Only cache valid responses
          if (response && response.status === 200 && response.type === "basic") {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Offline fallback: return cached root shell for navigation requests
          if (event.request.mode === "navigate") {
            return caches.match("/");
          }
        });
    })
  );
});
