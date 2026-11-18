// The service worker's rules for what it stores and what it answers. The worker is
// plain script with no exports, so the template is run against stand-ins for the
// browser's cache, fetch and Response.
import { readFileSync } from 'fs'
import { join } from 'path'

type Handler = (event: unknown) => void

class FakeResponse {
    ok: boolean
    status: number
    redirected: boolean
    headers: Map<string, string>
    body: unknown
    constructor(body: unknown, init: { status?: number; redirected?: boolean; headers?: [string, string][] } = {}) {
        this.body = body
        this.status = init.status ?? 200
        this.ok = this.status >= 200 && this.status < 300
        this.redirected = init.redirected ?? false
        this.headers = new Map(init.headers ?? [])
    }
    clone() { return this }
    static error() { return new FakeResponse(null, { status: 0 }) }
}

function boot(fetchImpl: (url: string) => Promise<FakeResponse>) {
    const stores = new Map<string, Map<string, FakeResponse>>()
    const keyListings = { count: 0 }
    const keyOf = (k: unknown) => typeof k === 'string' ? k : (k as { url: string }).url
    const caches = {
        open: async (name: string) => {
            if (!stores.has(name)) stores.set(name, new Map())
            const store = stores.get(name)!
            return {
                put: async (k: unknown, r: FakeResponse) => { store.set(keyOf(k), r) },
                match: async (k: unknown) => store.get(keyOf(k)),
                keys: async () => { keyListings.count += 1; return [...store.keys()].map(url => ({ url })) },
                delete: async (k: unknown) => store.delete(keyOf(k)),
            }
        },
        match: async (k: unknown) => { for (const s of stores.values()) if (s.has(keyOf(k))) return s.get(keyOf(k)) },
        keys: async () => [...stores.keys()],
        delete: async (name: string) => stores.delete(name),
    }
    const handlers: Record<string, Handler> = {}
    const self = {
        addEventListener: (type: string, fn: Handler) => { handlers[type] = fn },
        skipWaiting: () => {},
        clients: { claim: () => {} },
        location: { origin: 'https://songbird.test' },
    }
    const code = readFileSync(join(__dirname, '..', 'public', 'sw.template.js'), 'utf8')
    new Function('self', 'caches', 'fetch', 'Response', code)(self, caches, fetchImpl, FakeResponse)

    return {
        stores,
        keyListings,
        open: (name: string) => caches.open(name),
        async activate() {
            let work: Promise<unknown> = Promise.resolve()
            handlers.activate({ waitUntil: (p: Promise<unknown>) => { work = p } })
            await work
        },
        async install(): Promise<'installed' | Error> {
            let work: Promise<unknown> = Promise.resolve()
            handlers.install({ waitUntil: (p: Promise<unknown>) => { work = p } })
            try { await work; return 'installed' } catch (e) { return e as Error }
        },
        // Whether the worker took the request over, and what it answered.
        async request(path: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}) {
            let answered: Promise<FakeResponse> | undefined
            handlers.fetch({
                request: { url: `https://songbird.test${path}`, method: init.method ?? 'GET', mode: init.mode ?? 'cors', headers: { get: (h: string) => init.headers?.[h] ?? null } },
                respondWith: (p: Promise<FakeResponse>) => { answered = p },
            })
            return answered ? { handled: true as const, response: await answered } : { handled: false as const }
        },
    }
}

const ok = () => new FakeResponse('<html>')
const redirected = () => new FakeResponse('<html>sign in', { redirected: true })

describe('install', () => {
    it('stores each shell page that came back as a success, and the no-art music note', async () => {
        const sw = boot(async () => ok())
        expect(await sw.install()).toBe('installed')
        const shell = [...sw.stores.values()][0]
        // The note is what the lock screen shows offline for a song with no stored art.
        expect([...shell.keys()].sort()).toEqual(['/', '/icon-no-art.png', '/library', '/offline'])
    })

    it('does not store a page that came by redirect, and still installs', async () => {
        const sw = boot(async path => path === '/library' ? redirected() : ok())
        expect(await sw.install()).toBe('installed')
        const shell = [...sw.stores.values()][0]
        expect([...shell.keys()].sort()).toEqual(['/', '/icon-no-art.png', '/offline'])
    })

    it('still installs when a page other than /offline cannot be fetched', async () => {
        const sw = boot(async path => { if (path === '/') throw new TypeError('network'); return ok() })
        expect(await sw.install()).toBe('installed')
    })

    it.each([
        ['cannot be fetched', async () => { throw new TypeError('network') }],
        ['came back as an error', async () => new FakeResponse('', { status: 503 })],
        ['came by redirect', async () => redirected()],
    ])('fails when /offline %s, so the previous version stays', async (_name, answerOffline) => {
        const sw = boot(async path => path === '/offline' ? answerOffline() : ok())
        expect(await sw.install()).toBeInstanceOf(Error)
    })
})

describe('shell assets', () => {
    it('stores the no-art note on its first online request when install could not fetch it', async () => {
        let reachable = false
        const sw = boot(async path => String(path).endsWith('/icon-no-art.png') && !reachable ? Promise.reject(new Error('net')) : ok())
        expect(await sw.install()).toBe('installed')
        const shell = [...sw.stores.values()][0]
        expect([...shell.keys()].some(k => k.endsWith('/icon-no-art.png'))).toBe(false)
        reachable = true
        const first = await sw.request('/icon-no-art.png')
        expect(first.handled).toBe(true)
        expect([...shell.keys()].some(k => k.endsWith('/icon-no-art.png'))).toBe(true)
        // Offline later, the stored copy answers.
        reachable = false
        const again = await sw.request('/icon-no-art.png')
        expect(again.handled && again.response.ok).toBe(true)
    })
})

describe('lock-screen art check', () => {
    it('goes to the server past a stored copy: the OS fetch never sees the stored one', async () => {
        const sw = boot(async () => new FakeResponse('', { status: 404 }))
        await (await sw.open('songbird-artwork-saved-v1')).put('https://songbird.test/v1/songs/a/artwork/full/1', new FakeResponse('stored'))
        const plain = await sw.request('/v1/songs/a/artwork/full/1')
        expect(plain.handled && plain.response.ok).toBe(true)
        const checked = await sw.request('/v1/songs/a/artwork/full/1', { headers: { 'x-songbird-art-check': '1' } })
        expect(checked.handled && checked.response.status).toBe(404)
    })
})

describe('API answers', () => {
    it('keeps a copy of a GET and serves it when the network fails', async () => {
        let up = true
        const sw = boot(async () => { if (!up) throw new TypeError('network'); return ok() })
        expect((await sw.request('/v1/player/state')).handled).toBe(true)
        up = false
        const offline = await sw.request('/v1/player/state')
        expect(offline.handled && offline.response.headers.get('X-SW-Stale')).toBe('1')
    })

    it('leaves a write alone: it goes to the network and its answer is not stored as the GET copy', async () => {
        const sw = boot(async () => ok())
        expect((await sw.request('/v1/player/state', { method: 'PUT' })).handled).toBe(false)
        expect((await sw.request('/v1/player/queue', { method: 'POST' })).handled).toBe(false)
        expect(sw.stores.size).toBe(0)
    })

    it('does not store an answer that came by redirect', async () => {
        const sw = boot(async () => redirected())
        await sw.request('/v1/player/state')
        expect([...sw.stores.values()].every(store => store.size === 0)).toBe(true)
    })
})

describe('in-app page data', () => {
    it('is left to the network: a page that cannot load it falls back to a full page load', async () => {
        const sw = boot(async () => ok())
        expect((await sw.request('/library?_rsc=abc123')).handled).toBe(false)
    })
})

describe('artwork', () => {
    const SAVED = 'songbird-artwork-saved-v1'
    const BROWSE = 'songbird-artwork-v1'

    it('answers from the saved cache before the network, and offline', async () => {
        let up = true
        const sw = boot(async () => { if (!up) throw new TypeError('network'); return new FakeResponse('net') })
        const saved = await (sw as unknown as { open(n: string): Promise<{ put(k: string, r: FakeResponse): Promise<void> }> }).open(SAVED)
        await saved.put('https://is1.mzstatic.com/a/200x200bb.jpg', new FakeResponse('saved'))
        up = false
        const r = await sw.request(`/_next/image?url=${encodeURIComponent('https://is1.mzstatic.com/a/200x200bb.jpg')}&w=200&q=75`)
        expect(r.handled && r.response.body).toBe('saved')
    })

    describe('whole pictures only', () => {
        const U = (path: string) => `https://songbird.test${path}`
        const put = async (sw: ReturnType<typeof boot>, name: string, path: string, r: FakeResponse) => {
            const cache = await (sw as unknown as { open(n: string): Promise<{ put(k: string, r: FakeResponse): Promise<void> }> }).open(name)
            await cache.put(U(path), r)
        }

        it('does not store a partial answer', async () => {
            const sw = boot(async () => new FakeResponse('part', { status: 206 }))
            await sw.request('/v1/songs/a/artwork/thumb/1')
            await new Promise(r => setTimeout(r, 0))
            expect(sw.stores.get(BROWSE)?.size ?? 0).toBe(0)
        })

        it('does not store an empty answer', async () => {
            const sw = boot(async () => new FakeResponse('', { headers: [['content-length', '0']] }))
            await sw.request('/v1/songs/a/artwork/thumb/1')
            await new Promise(r => setTimeout(r, 0))
            expect(sw.stores.get(BROWSE)?.size ?? 0).toBe(0)
        })

        it('does not answer from an empty stored copy: the network answers instead', async () => {
            const sw = boot(async () => new FakeResponse('real'))
            await put(sw, SAVED, '/v1/songs/a/artwork/thumb/1', new FakeResponse('', { headers: [['content-length', '0']] }))
            const r = await sw.request('/v1/songs/a/artwork/thumb/1')
            expect(r.handled && r.response.body).toBe('real')
        })

        it('offline, an empty stored copy is an error, not a blank picture', async () => {
            const sw = boot(async () => { throw new TypeError('network') })
            await put(sw, SAVED, '/v1/songs/a/artwork/thumb/1', new FakeResponse('', { headers: [['content-length', '0']] }))
            const r = await sw.request('/v1/songs/a/artwork/thumb/1')
            expect(r.handled && r.response.status).toBe(0)
        })

        it('an empty live answer with nothing stored is an error, not a blank picture', async () => {
            const sw = boot(async () => new FakeResponse('', { headers: [['content-length', '0']] }))
            const r = await sw.request('/v1/songs/a/artwork/thumb/9')
            expect(r.handled && r.response.status).toBe(0)
        })

        it('an empty live answer falls back to a stored version', async () => {
            const sw = boot(async () => new FakeResponse('', { headers: [['content-length', '0']] }))
            await put(sw, SAVED, '/v1/songs/a/artwork/thumb/0', new FakeResponse('old'))
            const r = await sw.request('/v1/songs/a/artwork/thumb/9')
            expect(r.handled && r.response.body).toBe('old')
        })
    })

    describe('versioned song artwork', () => {
        const U = (path: string) => `https://songbird.test${path}`
        async function seed(sw: ReturnType<typeof boot>, name: string, entries: Record<string, string>) {
            const cache = await (sw as unknown as { open(n: string): Promise<{ put(k: string, r: FakeResponse): Promise<void> }> }).open(name)
            for (const [path, body] of Object.entries(entries)) await cache.put(U(path), new FakeResponse(body))
        }

        it('answers the exact url when it is stored', async () => {
            const sw = boot(async () => { throw new TypeError('network') })
            await seed(sw, SAVED, { '/v1/songs/a/artwork/thumb/5': 'v5', '/v1/songs/a/artwork/thumb/4': 'v4' })
            const r = await sw.request('/v1/songs/a/artwork/thumb/5')
            expect(r.handled && r.response.body).toBe('v5')
        })

        it('offline, a url with no stored copy gets any stored version of the same song and size', async () => {
            const sw = boot(async () => { throw new TypeError('network') })
            await seed(sw, SAVED, { '/v1/songs/a/artwork/thumb/4': 'v4', '/v1/songs/a/artwork/full/4': 'full4', '/v1/songs/b/artwork/thumb/9': 'other' })
            const r = await sw.request('/v1/songs/a/artwork/thumb/7')
            expect(r.handled && r.response.body).toBe('v4')
        })

        it('offline, art saved before versions existed (no version in the url) still answers a versioned url', async () => {
            const sw = boot(async () => { throw new TypeError('network') })
            await seed(sw, SAVED, { '/v1/songs/a/artwork/thumb': 'old' })
            const r = await sw.request('/v1/songs/a/artwork/thumb/0')
            expect(r.handled && r.response.body).toBe('old')
        })

        it('does not answer another size or another song', async () => {
            const sw = boot(async () => { throw new TypeError('network') })
            await seed(sw, SAVED, { '/v1/songs/a/artwork/full/4': 'full', '/v1/songs/ab/artwork/thumb/4': 'ab' })
            const r = await sw.request('/v1/songs/a/artwork/thumb/7')
            expect(r.handled && r.response.status).toBe(0)
        })

        it('online, a new version is fetched, not answered with the old one', async () => {
            const sw = boot(async () => new FakeResponse('new'))
            await seed(sw, SAVED, { '/v1/songs/a/artwork/thumb/4': 'v4' })
            const r = await sw.request('/v1/songs/a/artwork/thumb/7')
            expect(r.handled && r.response.body).toBe('new')
        })

        it('with the server down (502), the stored version answers instead of the error', async () => {
            const sw = boot(async () => new FakeResponse('bad gateway', { status: 502 }))
            await seed(sw, SAVED, { '/v1/songs/a/artwork/thumb/4': 'v4' })
            const r = await sw.request('/v1/songs/a/artwork/thumb/7')
            expect(r.handled && r.response.body).toBe('v4')
        })

        it('offline misses list each cache\'s keys once, not once per request', async () => {
            const sw = boot(async () => { throw new TypeError('network') })
            await seed(sw, SAVED, { '/v1/songs/a/artwork/thumb/4': 'v4' })
            await seed(sw, BROWSE, { '/v1/songs/b/artwork/thumb/4': 'b4' })
            for (let i = 0; i < 20; i++) await sw.request(`/v1/songs/none${i}/artwork/thumb/1`)
            const first = await sw.request('/v1/songs/a/artwork/thumb/9')
            expect(first.handled && first.response.body).toBe('v4')
            expect(sw.keyListings.count).toBeLessThanOrEqual(2)
        })

        it('an index built before a copy was stored finds it after the reindex pause', async () => {
            jest.useFakeTimers({ doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] })
            try {
                const sw = boot(async () => { throw new TypeError('network') })
                await sw.request('/v1/songs/a/artwork/thumb/1') // builds the (empty) index
                await seed(sw, SAVED, { '/v1/songs/a/artwork/thumb/4': 'v4' })
                const early = await sw.request('/v1/songs/a/artwork/thumb/9')
                expect(early.handled && early.response.status).toBe(0)
                jest.setSystemTime(Date.now() + 6000)
                const later = await sw.request('/v1/songs/a/artwork/thumb/9')
                expect(later.handled && later.response.body).toBe('v4')
            } finally { jest.useRealTimers() }
        })

        it('prefers a saved copy over a browsed one', async () => {
            const sw = boot(async () => { throw new TypeError('network') })
            await seed(sw, BROWSE, { '/v1/songs/a/artwork/thumb/3': 'browsed' })
            await seed(sw, SAVED, { '/v1/songs/a/artwork/thumb/4': 'saved' })
            const r = await sw.request('/v1/songs/a/artwork/thumb/7')
            expect(r.handled && r.response.body).toBe('saved')
        })

        it('storing a fetched version removes nothing: eviction is the page\'s job', async () => {
            const sw = boot(async () => new FakeResponse('new'))
            await seed(sw, BROWSE, { '/v1/songs/a/artwork/thumb/4': 'v4' })
            await sw.request('/v1/songs/a/artwork/thumb/7')
            await new Promise(r => setTimeout(r, 0))
            expect(sw.stores.get(BROWSE)!.size).toBe(2)
        })
    })

    it('keeps the saved cache when the worker activates', async () => {
        const sw = boot(async () => ok())
        sw.stores.set(SAVED, new Map([['x', ok()]]))
        await sw.activate()
        expect(sw.stores.has(SAVED)).toBe(true)
    })

    it('trims browsed artwork to the cap every 25th put and never touches saved copies', async () => {
        const sw = boot(async () => new FakeResponse('img'))
        sw.stores.set(SAVED, new Map([['/v1/songs/keep/artwork/full', ok()]]))
        for (let i = 0; i < 2025; i++) {
            await sw.request(`/v1/songs/s${i}/artwork/thumb`)
            await Promise.resolve()
        }
        await new Promise(r => setTimeout(r, 0))
        expect(sw.stores.get(BROWSE)!.size).toBeLessThanOrEqual(2000 + 24)
        expect(sw.stores.get(BROWSE)!.size).toBeGreaterThan(1990)
        expect(sw.stores.get(SAVED)!.size).toBe(1)
    })
})
