const SHELL_CACHE = 'songbird-shell-v3'
const ARTWORK_CACHE = 'songbird-artwork-v1'

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(SHELL_CACHE).then(cache => cache.addAll(['/offline']))
    )
    self.skipWaiting()
})

self.addEventListener('activate', event => {
    const keep = new Set([SHELL_CACHE, ARTWORK_CACHE])
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k)))
        )
    )
    self.clients.claim()
})

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url)

    // Artwork: check cache first, fall back to network, store on success
    // For /_next/image requests, also check the raw URL we pre-cached
    if (url.pathname.startsWith('/_next/image')) {
        event.respondWith(
            caches.open(ARTWORK_CACHE).then(async cache => {
                const cached = await cache.match(event.request)
                if (cached) return cached

                const rawUrl = url.searchParams.get('url')
                if (rawUrl) {
                    const rawCached = await cache.match(rawUrl)
                    if (rawCached) return rawCached
                }

                return fetch(event.request).then(r => {
                    if (r.ok) cache.put(event.request, r.clone())
                    return r
                }).catch(async () => {
                    if (rawUrl) {
                        const rawCached = await cache.match(rawUrl)
                        if (rawCached) return rawCached
                    }
                    return Response.error()
                })
            })
        )
        return
    }

    // Next.js RSC payload fetches (client-side routing) — keyed by pathname only
    if (url.origin === self.location.origin && url.searchParams.has('_rsc')) {
        event.respondWith(
            caches.open(SHELL_CACHE).then(async cache => {
                try {
                    const r = await fetch(event.request)
                    if (r.ok) cache.put(url.pathname, r.clone())
                    return r
                } catch {
                    return cache.match(url.pathname).then(c => c ?? Response.error())
                }
            })
        )
        return
    }

    // Page navigations: network first, cache only on 200, fall back to cache/offline only when network is unreachable
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(r => {
                    if (r.ok) {
                        caches.open(SHELL_CACHE).then(cache => cache.put(event.request, r.clone()))
                    }
                    return r
                })
                .catch(() =>
                    caches.match(event.request).then(c => c ?? caches.match('/offline'))
                )
        )
        return
    }
})
