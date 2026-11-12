// Offline artwork: what cacheArtworkUrls stores and where, and what dropStoredArtwork and
// clearOfflineCache remove. The saved cache is separate from the browse cache the service
// worker trims.
import { cacheArtworkUrls, dropStoredArtwork, clearOfflineCache } from '../app/lib/offline'
import { BROWSE_ARTWORK_CACHE, OFFLINE_ARTWORK_CACHE } from '../app/lib/artwork'

const stores = new Map<string, Map<string, unknown>>()
const fetched: string[] = []

beforeEach(() => {
    stores.clear()
    fetched.length = 0
    const caches = {
        open: async (name: string) => {
            if (!stores.has(name)) stores.set(name, new Map())
            const store = stores.get(name)!
            return {
                match: async (k: string) => store.get(k),
                put: async (k: string, r: unknown) => { store.set(k, r) },
                keys: async () => [...store.keys()].map(url => ({ url: `https://songbird.test${url.startsWith('/') ? url : '/x'}` })),
                delete: async (r: { url: string }) => store.delete(new URL(r.url).pathname),
            }
        },
        delete: async (name: string) => stores.delete(name),
    }
    Object.defineProperty(globalThis, 'caches', { value: caches, configurable: true })
    ;(globalThis as unknown as { fetch: unknown }).fetch = async (u: string) => { fetched.push(u); return { ok: true } }
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
