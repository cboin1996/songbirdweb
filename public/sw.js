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

// Navigation requests: network first, fall back to /offline on failure or non-ok response
self.addEventListener('fetch', event => {
    if (event.request.mode !== 'navigate') return
    event.respondWith(
        fetch(event.request)
            .then(r => (r.ok ? r : caches.match('/offline').then(c => c ?? r)))
            .catch(() => caches.match('/offline'))
    )
})
