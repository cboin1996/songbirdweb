const SHELL_CACHE = 'songbird-shell-v1'

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(SHELL_CACHE).then(cache => cache.addAll(['/offline']))
    )
    self.skipWaiting()
})

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== SHELL_CACHE).map(k => caches.delete(k)))
        )
    )
    self.clients.claim()
})

// Navigation requests: network first, fall back to /offline when network is gone
self.addEventListener('fetch', event => {
    if (event.request.mode !== 'navigate') return
    event.respondWith(
        fetch(event.request).catch(() => caches.match('/offline'))
    )
})
