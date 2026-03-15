const CACHE_NAME = 'tachoprufung-v3';
const API_CACHE = 'tachoprufung-api-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icon.svg',
];

// API paths that should be cached for offline use
const CACHEABLE_API = [
  '/api/drivers',
  '/api/dashboard',
  '/api/driver-config',
  '/api/sync-status',
];

// Cache static assets on install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Clean old caches on activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== API_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

function isCacheableApi(pathname) {
  return CACHEABLE_API.some((p) => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '?'));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, POST, upload, portal
  if (request.method !== 'GET' || url.pathname.startsWith('/upload') || url.pathname.startsWith('/portal')) {
    return;
  }

  // API requests: network-first with offline fallback
  if (url.pathname.startsWith('/api/') && isCacheableApi(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(API_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.open(API_CACHE).then((cache) => cache.match(request)).then((cached) => {
            if (cached) {
              // Add offline header so the app knows this is cached data
              const headers = new Headers(cached.headers);
              headers.set('X-Offline-Cache', '1');
              return new Response(cached.body, { status: cached.status, headers });
            }
            return new Response(JSON.stringify({ error: 'offline', offline: true }), {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            });
          })
        )
    );
    return;
  }

  // Skip non-cacheable API requests
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Network-first strategy for HTML navigation (SPA)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match('/') || caches.match(request))
    );
    return;
  }

  // Cache-first for static assets (JS, CSS, images, fonts)
  if (url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf)$/)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Stale-while-revalidate for everything else
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || fetched;
    })
  );
});
