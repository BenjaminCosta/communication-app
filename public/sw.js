// ── Firebase Messaging (background push notifications) ─────────────────────
// Uses the compat CDN build so it works in Service Worker context (no ES modules needed).
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAt2oVZ9ec3bc_b6QjCBn6ZZ-4IxgVpn8o",
  authDomain: "svc-comms.firebaseapp.com",
  projectId: "svc-comms",
  storageBucket: "svc-comms.firebasestorage.app",
  messagingSenderId: "56869436768",
  appId: "1:56869436768:web:c19a0c0d6825fc309af205",
});

const messaging = firebase.messaging();

// Handle messages received while the app is in the background.
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'SVC';
  const body  = payload.notification?.body  || 'New message';
  return self.registration.showNotification(title, {
    body,
    icon : '/icon-192x192.png',
    badge: '/icon-192x192.png',
    tag  : payload.data?.messageId || 'svc-message',
    data : payload.data,
  });
});

// Bring an existing SVC window forward when a notification is tapped. If there
// is no app window yet, open the app instead of leaving the notification inert.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const requestedUrl = event.notification.data?.link || '/';
  let targetUrl = new URL('/', self.location.origin);
  try {
    const candidate = new URL(requestedUrl, self.location.origin);
    if (candidate.origin === self.location.origin) targetUrl = candidate;
  } catch {
    // Invalid notification data falls back safely to the SVC home screen.
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existingClient = clientList.find((client) => new URL(client.url).origin === self.location.origin);
      if (existingClient) return existingClient.focus();
      return self.clients.openWindow(targetUrl.href);
    })
  );
});

// ── PWA caching ─────────────────────────────────────────────────────────────
const CACHE_PREFIX = 'svc-';
const CACHE_NAME = `${CACHE_PREFIX}v5`;
const OFFLINE_URL = '/offline.html';
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/icon-192x192.png',
  '/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip cross-origin requests (Firebase, analytics, etc.)
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Never serve Next/Turbopack chunks from the app cache. They are versioned by
  // Next and must revalidate normally or stale module factories can crash.
  if (url.pathname.startsWith('/_next/')) {
    return;
  }

  // Stale-while-revalidate for static assets. This keeps the UI quick without
  // pinning logo/icon updates forever as the former cache-first policy did.
  if (
    url.pathname.match(/\.(png|jpg|jpeg|svg|ico|webp|woff2?)$/)
  ) {
    const updateCache = fetch(event.request)
      .then((response) => {
        if (!response.ok || response.type !== 'basic') return response;
        const clone = response.clone();
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clone);
          return response;
        });
      });

    event.respondWith(
      caches.match(event.request).then((cached) => cached || updateCache)
    );
    event.waitUntil(updateCache.catch(() => undefined));
  }
});
