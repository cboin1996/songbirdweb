const SHELL_CACHE = 'songbird-shell-v__SW_VERSION__'
// Artwork seen while browsing: capped, oldest first out. Same names as
// app/lib/artwork.ts (BROWSE_ARTWORK_CACHE, OFFLINE_ARTWORK_CACHE).
const ARTWORK_CACHE = 'songbird-artwork-v1'
// Artwork stored on purpose for offline songs: never trimmed here.
const SAVED_ARTWORK_CACHE = 'songbird-artwork-saved-v1'
// Newest entries win: cache.keys() lists oldest first, so the front is trimmed.
const ARTWORK_MAX_ENTRIES = 2000
// cache.keys() is O(n), so trim once per this many puts, not on every one.
const ARTWORK_TRIM_EVERY = 25
let artworkPuts = 0
async function trimCache(cache, max) {
    const keys = await cache.keys()
    await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map(k => cache.delete(k)))
}
function storeArtwork(cache, request, response) {
    return cache.put(request, response).then(() => {
        artworkPuts += 1
        if (artworkPuts % ARTWORK_TRIM_EVERY === 0) return trimCache(cache, ARTWORK_MAX_ENTRIES)
    })
}
// Saved copies win over browsed ones.
async function matchArtwork(request) {
    const saved = await caches.open(SAVED_ARTWORK_CACHE)
    const hit = await saved.match(request)
    if (hit) return hit
    const browse = await caches.open(ARTWORK_CACHE)
    return browse.match(request)
}
// Unlike the shell cache, this name is not versioned with the app. Rename it when
// copies already stored under the old name must go: activate deletes every cache
// that is not in its keep list.
const API_CACHE = 'songbird-api-v2'
const CACHED_API_PATHS = ['/v1/player/state', '/v1/songs/library', '/v1/library']
const SHELL_PAGES = ['/offline', '/', '/library']

// Stores each shell page on its own. A page the server answers with a redirect
// (signed out, /library goes to the sign-in page) or an error is skipped, not
// stored under the wrong URL: addAll would store the sign-in page as /library, which
// a later offline launch then cannot use. Only /offline is required. It is the
// fallback for every page that is not stored, and activating without it would delete
// the previous version's copy and leave nothing to show, so an install that cannot
// get it fails and the previous version stays.
async function precacheShell() {
    const cache = await caches.open(SHELL_CACHE)
    const offline = await fetch('/offline')
    if (!storable(offline)) throw new Error('/offline could not be stored')
    await cache.put('/offline', offline)
    await Promise.all(SHELL_PAGES.filter(path => path !== '/offline').map(async path => {
        try {
            const r = await fetch(path)
            if (storable(r)) await cache.put(path, r)
        } catch { /* stored on its first online visit instead */ }
    }))
}

// A success that did not come by redirect: a redirected answer is the sign-in page,
// not the page that was asked for.
function storable(r) {
    return r.ok && !r.redirected
}

self.addEventListener('install', event => {
    event.waitUntil(precacheShell())
    self.skipWaiting()
})

self.addEventListener('activate', event => {
    const keep = new Set([SHELL_CACHE, ARTWORK_CACHE, SAVED_ARTWORK_CACHE, API_CACHE])
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
                const cached = await matchArtwork(event.request)
                if (cached) return cached

                const rawUrl = url.searchParams.get('url')
                if (rawUrl) {
                    const rawCached = await matchArtwork(rawUrl)
                    if (rawCached) return rawCached
                }

                return fetch(event.request).then(r => {
                    if (r.ok) storeArtwork(cache, event.request, r.clone())
                    return r
                }).catch(async () => {
                    if (rawUrl) {
                        const rawCached = await matchArtwork(rawUrl)
                        if (rawCached) return rawCached
                    }
                    return Response.error()
                })
            })
        )
        return
    }

    // Local artwork API: cache-first, store on network success
    if (url.pathname.match(/^\/v1\/songs\/[^/]+\/artwork\//)) {
        event.respondWith(
            caches.open(ARTWORK_CACHE).then(async cache => {
                const cached = await matchArtwork(event.request)
                if (cached) return cached
                return fetch(event.request).then(r => {
                    if (r.ok) storeArtwork(cache, event.request, r.clone())
                    return r
                }).catch(() => Response.error())
            })
        )
        return
    }

    // Static JS/CSS chunks: cache-first (content-addressed in prod, safe to cache forever)
    if (url.pathname.startsWith('/_next/static/')) {
        event.respondWith(
            caches.open(SHELL_CACHE).then(async cache => {
                const cached = await cache.match(event.request)
                if (cached) return cached
                return fetch(event.request).then(r => {
                    if (r.ok) cache.put(event.request, r.clone())
                    return r
                }).catch(() => Response.error())
            })
        )
        return
    }

    // API data: network-first, serve stale when API is unreachable (502) or browser offline
    if (event.request.method === 'GET' && url.origin === self.location.origin && CACHED_API_PATHS.includes(url.pathname)) {
        event.respondWith(
            caches.open(API_CACHE).then(async cache => {
                try {
                    const r = await fetch(event.request)
                    if (storable(r)) {
                        cache.put(url.pathname, r.clone())
                        return r
                    }
                    if (r.status === 502) {
                        const c = await cache.match(url.pathname)
                        if (c) return new Response(c.body, { status: c.status, statusText: c.statusText, headers: [...c.headers.entries(), ['X-SW-Stale', '1']] })
                    }
                    return r
                } catch {
                    const c = await cache.match(url.pathname)
                    if (c) return new Response(c.body, { status: c.status, statusText: c.statusText, headers: [...c.headers.entries(), ['X-SW-Stale', '1']] })
                    return Response.error()
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
                    if (storable(r)) {
                        // Copied now, before the page starts reading the answer: a copy
                        // made after the open below finds the body already in use, throws,
                        // and nothing is stored.
                        const copy = r.clone()
                        caches.open(SHELL_CACHE).then(cache => cache.put(event.request, copy)).catch(() => {})
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
