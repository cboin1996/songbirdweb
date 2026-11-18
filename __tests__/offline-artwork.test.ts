// Offline artwork: what cacheArtworkUrls stores and where, and what dropStoredArtwork and
// clearOfflineCache remove. The saved cache is separate from the browse cache the service
// worker trims.
import { cacheArtworkUrls, dropStoredArtwork, clearOfflineCache, refreshSavedArtwork, findStoredArtwork, songsMissingSavedArtwork, warmLargeArtwork, forgetIndex } from '../app/lib/offline'
import { BROWSE_ARTWORK_CACHE, OFFLINE_ARTWORK_CACHE } from '../app/lib/artwork'

const stores = new Map<string, Map<string, unknown>>()
const fetched: string[] = []
let keyListings = 0
const path = (k: string) => k.replace(/^https?:\/\/[^/]+/, '')
const picture = (status = 200, body = 'x') => ({ ok: status >= 200 && status < 300, status, clone() { return this }, blob: async () => ({ size: body.length }) })

beforeEach(() => {
    forgetIndex() // the stem index lives in the module: one test's must not answer for the next
    stores.clear()
    fetched.length = 0
    keyListings = 0
    const caches = {
        open: async (name: string) => {
            if (!stores.has(name)) stores.set(name, new Map())
            const store = stores.get(name)!
            return {
                match: async (k: string) => store.get(k) ?? store.get(path(k)),
                put: async (k: string, r: unknown) => { store.set(k, r) },
                keys: async () => { keyListings += 1; return [...store.keys()].map(url => ({ url: `https://songbird.test${url.startsWith('/') ? url : '/x'}` })) },
                delete: async (r: { url: string }) => store.delete(new URL(r.url).pathname),
            }
        },
        match: async (k: string) => { for (const st of stores.values()) { const hit = st.get(k) ?? st.get(path(k)); if (hit) return hit } },
        delete: async (name: string) => stores.delete(name),
    }
    Object.defineProperty(globalThis, 'caches', { value: caches, configurable: true })
    ;(globalThis as unknown as { fetch: unknown }).fetch = async (u: string) => { fetched.push(u); return picture() }
})

describe('cacheArtworkUrls', () => {
    it('stores remote art in the saved cache, asking the optimizer for an allowed width', async () => {
        const a = 'https://is1.mzstatic.com/a/200x200bb.jpg'
        const b = 'https://is1.mzstatic.com/a/600x600bb.jpg'
        await cacheArtworkUrls([a, b])
        expect(fetched.sort()).toEqual([
            `/_next/image?url=${encodeURIComponent(a)}&w=200&q=75`,
            `/_next/image?url=${encodeURIComponent(b)}&w=600&q=75`,
        ].sort())
        expect([...stores.get(OFFLINE_ARTWORK_CACHE)!.keys()].sort()).toEqual([a, b].sort())
        expect(stores.has(BROWSE_ARTWORK_CACHE)).toBe(false)
    })

    it('fetches a local path directly', async () => {
        await cacheArtworkUrls(['/v1/songs/s1/artwork/thumb'])
        expect(fetched).toEqual(['/v1/songs/s1/artwork/thumb'])
    })
})

describe('whole pictures only', () => {
    it('does not store an empty answer', async () => {
        ;(globalThis as unknown as { fetch: unknown }).fetch = async () => picture(200, '')
        await cacheArtworkUrls(['/v1/songs/s1/artwork/thumb/1'])
        expect(stores.get(OFFLINE_ARTWORK_CACHE)?.size ?? 0).toBe(0)
    })

    it('does not store a partial answer', async () => {
        ;(globalThis as unknown as { fetch: unknown }).fetch = async () => picture(206)
        await cacheArtworkUrls(['/v1/songs/s1/artwork/thumb/1'])
        expect(stores.get(OFFLINE_ARTWORK_CACHE)?.size ?? 0).toBe(0)
    })
})

describe('removal', () => {
    it('dropStoredArtwork clears one song from both caches', async () => {
        await cacheArtworkUrls(['/v1/songs/s1/artwork/thumb', '/v1/songs/s2/artwork/thumb'])
        const browse = await caches.open(BROWSE_ARTWORK_CACHE)
        await browse.put('/v1/songs/s1/artwork/full', {} as Response)
        await dropStoredArtwork('s1')
        expect([...stores.get(OFFLINE_ARTWORK_CACHE)!.keys()]).toEqual(['/v1/songs/s2/artwork/thumb'])
        expect(stores.get(BROWSE_ARTWORK_CACHE)!.size).toBe(0)
    })

    it('clearOfflineCache deletes both caches', async () => {
        await cacheArtworkUrls(['/v1/songs/s1/artwork/thumb'])
        await (await caches.open(BROWSE_ARTWORK_CACHE)).put('/x', {} as Response)
        await clearOfflineCache()
        expect(stores.has(OFFLINE_ARTWORK_CACHE)).toBe(false)
        expect(stores.has(BROWSE_ARTWORK_CACHE)).toBe(false)
    })
})

describe('refreshSavedArtwork', () => {
    const saved = () => [...(stores.get(OFFLINE_ARTWORK_CACHE)?.keys() ?? [])].sort()
    const seed = async (...urls: string[]) => { for (const u of urls) await (await caches.open(OFFLINE_ARTWORK_CACHE)).put(u, {} as Response) }
    const song = (uuid: string, v: number | null, artwork_cached = true) => ({ uuid, artwork_cached, artwork_updated_at: v })

    it('stores art saved before versions existed at the versioned url, then drops the old copy', async () => {
        await seed('/v1/songs/a/artwork/thumb', '/v1/songs/a/artwork/full')
        await refreshSavedArtwork([song('a', null)], new Set(['a']))
        expect(saved()).toEqual(['/v1/songs/a/artwork/full/0', '/v1/songs/a/artwork/thumb/0'])
    })

    it('replaces a saved song\'s old version with the new one', async () => {
        await seed('/v1/songs/a/artwork/thumb/100', '/v1/songs/a/artwork/full/100')
        await refreshSavedArtwork([song('a', 200)], new Set(['a']))
        expect(saved()).toEqual(['/v1/songs/a/artwork/full/200', '/v1/songs/a/artwork/thumb/200'])
    })

    it('does nothing when the saved art is at the current version', async () => {
        await seed('/v1/songs/a/artwork/thumb/200', '/v1/songs/a/artwork/full/200')
        await refreshSavedArtwork([song('a', 200)], new Set(['a']))
        expect(fetched).toEqual([])
    })

    it('keeps the old copy when the new one cannot be fetched', async () => {
        await seed('/v1/songs/a/artwork/thumb/100', '/v1/songs/a/artwork/full/100')
        ;(globalThis as unknown as { fetch: unknown }).fetch = async () => picture(500)
        await refreshSavedArtwork([song('a', 200)], new Set(['a']))
        expect(saved()).toEqual(['/v1/songs/a/artwork/full/100', '/v1/songs/a/artwork/thumb/100'])
    })

    it('leaves songs that are not saved, other songs, and songs with remote art alone', async () => {
        await seed('/v1/songs/b/artwork/thumb/1', '/v1/songs/c/artwork/thumb/1')
        await refreshSavedArtwork([song('a', 5), song('b', 9), song('c', 9, false)], new Set(['b', 'c']).add('x'))
        expect(saved()).toEqual(['/v1/songs/b/artwork/full/9', '/v1/songs/b/artwork/thumb/9', '/v1/songs/c/artwork/thumb/1'])
    })
})

describe('findStoredArtwork', () => {
    const seed = async (cache: string, ...urls: string[]) => { for (const u of urls) await (await caches.open(cache)).put(u, picture() as unknown as Response) }

    it('answers the exact url, and otherwise another version of the same song and size', async () => {
        await seed(OFFLINE_ARTWORK_CACHE, '/v1/songs/a/artwork/thumb/4', '/v1/songs/a/artwork/full/4')
        expect(await findStoredArtwork('/v1/songs/a/artwork/thumb/4')).toBeDefined()
        expect(await findStoredArtwork('/v1/songs/a/artwork/thumb/9')).toBeDefined()
        expect(await findStoredArtwork('/v1/songs/a/artwork/full')).toBeDefined()
        expect(await findStoredArtwork('/v1/songs/b/artwork/thumb/9')).toBeUndefined()
        expect(await findStoredArtwork('/v1/songs/ab/artwork/thumb/9')).toBeUndefined()
    })

    it('lists a cache once for many misses', async () => {
        await seed(OFFLINE_ARTWORK_CACHE, '/v1/songs/a/artwork/thumb/4')
        for (let i = 0; i < 30; i++) await findStoredArtwork(`/v1/songs/none${i}/artwork/thumb/1`)
        expect(keyListings).toBeLessThanOrEqual(2)
    })

    // Performance: an offline library page asks for the art of hundreds of songs at once, most
    // of them misses when the saved cache holds a few. One listing serves them all; the cost
    // of each miss is a map lookup, not a scan of the cache.
    it('answers 200 misses over a 2000-key cache from one listing, fast', async () => {
        const urls = Array.from({ length: 2000 }, (_, i) => `/v1/songs/s${i}/artwork/thumb/${i}`)
        await seed(OFFLINE_ARTWORK_CACHE, ...urls)
        const started = performance.now()
        for (let i = 0; i < 200; i++) await findStoredArtwork(`/v1/songs/gone${i}/artwork/thumb/1`)
        const ms = performance.now() - started
        expect(keyListings).toBeLessThanOrEqual(2)
        expect(ms).toBeLessThan(1000) // loose: shared CI runners are slow; keyListings above is the real guard
        expect(await findStoredArtwork('/v1/songs/s1999/artwork/thumb/7')).toBeDefined()
    })

    it('sees a copy the page stored after the index was built', async () => {
        await seed(OFFLINE_ARTWORK_CACHE, '/v1/songs/a/artwork/thumb/4')
        await findStoredArtwork('/v1/songs/zzz/artwork/thumb/1') // builds the index
        await cacheArtworkUrls(['/v1/songs/c/artwork/thumb/2'])
        expect(await findStoredArtwork('/v1/songs/c/artwork/thumb/9')).toBeDefined()
    })

    it('forgets a song dropped from the cache', async () => {
        await seed(OFFLINE_ARTWORK_CACHE, '/v1/songs/a/artwork/thumb/4')
        expect(await findStoredArtwork('/v1/songs/a/artwork/thumb/9')).toBeDefined()
        await dropStoredArtwork('a')
        expect(await findStoredArtwork('/v1/songs/a/artwork/thumb/9')).toBeUndefined()
    })
})

describe('songsMissingSavedArtwork', () => {
    const song = (uuid: string, v: number) => ({ uuid, artwork_cached: true, artwork_updated_at: v })

    it('lists the saved songs without both sizes at the current url', async () => {
        const cache = await caches.open(OFFLINE_ARTWORK_CACHE)
        for (const u of ['/v1/songs/a/artwork/thumb/1', '/v1/songs/a/artwork/full/1', '/v1/songs/b/artwork/thumb/1']) await cache.put(u, picture() as unknown as Response)
        expect(await songsMissingSavedArtwork([song('a', 1), song('b', 1), song('c', 1)], new Set(['a', 'b']))).toEqual(['b'])
    })

    it('says unknown (null), not none, when there is no Cache API', async () => {
        Object.defineProperty(globalThis, 'caches', { value: undefined, configurable: true })
        delete (globalThis as { caches?: unknown }).caches
        expect(await songsMissingSavedArtwork([song('a', 1)], new Set(['a']))).toBeNull()
    })
})

describe('warmLargeArtwork', () => {
    it('fetches the large art when only an older version is stored', async () => {
        await (await caches.open(BROWSE_ARTWORK_CACHE)).put('/v1/songs/a/artwork/full/1', picture() as unknown as Response)
        await warmLargeArtwork({ uuid: 'a', artwork_cached: true, artwork_updated_at: 2 })
        expect(fetched).toEqual(['/v1/songs/a/artwork/full/2'])
    })

    it('does not fetch when the current url is stored', async () => {
        await (await caches.open(BROWSE_ARTWORK_CACHE)).put('/v1/songs/a/artwork/full/2', picture() as unknown as Response)
        await warmLargeArtwork({ uuid: 'a', artwork_cached: true, artwork_updated_at: 2 })
        expect(fetched).toEqual([])
    })
})
