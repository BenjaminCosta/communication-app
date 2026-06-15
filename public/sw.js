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

// ── PWA caching ─────────────────────────────────────────────────────────────
const CACHE_NAME = 'svc-v4';
const OFFLINE_URL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([OFFLINE_URL]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
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

  // Cache-first for static assets
  if (
    url.pathname.match(/\.(png|jpg|jpeg|svg|ico|webp|woff2?)$/)
  ) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((response) => {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            return response;
          })
      )
    );
  }
});
