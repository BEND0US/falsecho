// Service Worker version - used to manage cache
const CACHE_VERSION = 'v1';
const CACHE_NAME = 'pwa-cache-' + CACHE_VERSION;

// Resources to cache
const urlsToCache = [
  '/',
  '/index.html',
  '/static/hook.min.js',
  '/static/style.css',
  '/static/img/icon-192x192.png',
  '/static/img/icon-512x512.png'
];

// Service Worker setup
self.addEventListener('install', event => {
  //console.log('Service Worker loading...');
  
  // Cache resources
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        //console.log('Cache opened');
        return cache.addAll(urlsToCache);
      })
  );
});

// Service Worker activated
self.addEventListener('activate', event => {
  //console.log('Service Worker activating...');
  
  // Clean old caches
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            //console.log('Cleaning old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Request capture strategy: first network, then cache
self.addEventListener('fetch', event => {
  // Skip caching API requests
  if (event.request.url.includes('/api/')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // If cache exists, return it
        if (response) {
          return response;
        }
        // Otherwise fetch from network
        return fetch(event.request);
      })
  );
});

// Push notifications
self.addEventListener('push', event => {
  if (!event.data) {
    //console.log('Empty push notification received');
    return;
  }
  
  const notificationData = event.data.json();
  const options = {
    body: notificationData.body || 'New notification',
    icon: notificationData.icon || '/static/img/icon-192x192.png',
    badge: '/static/img/icon-192x192.png',
    data: {
      url: notificationData.url || '/'
    }
  };
  
  event.waitUntil(
    self.registration.showNotification(notificationData.title || 'New Notification', options)
  );
});

// Notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});

// Register Service Worker for PWA
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function() {
            navigator.serviceWorker.register('/static/sw.js')
                .then(function(registration) {
                    debugLog('ServiceWorker registration successful: ', registration.scope);
                }).catch(function(err) {
                    debugLog('ServiceWorker registration failed: ', err);
                    //console.error('ServiceWorker registration failed: ', err);
                });
        });
    } else {
        debugLog('Service Worker not supported in this browser');
    }
}