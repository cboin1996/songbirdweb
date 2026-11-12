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
    const keyOf = (k: unknown) => typeof k === 'string' ? k : (k as { url: string }).url
    const caches = {
        open: async (name: string) => {
            if (!stores.has(name)) stores.set(name, new Map())
            const store = stores.get(name)!
            return {
                put: async (k: unknown, r: FakeResponse) => { store.set(keyOf(k), r) },
                match: async (k: unknown) => store.get(keyOf(k)),
                keys: async () => [...store.keys()].map(url => ({ url })),
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
        async request(path: string, init: { method?: string; mode?: string } = {}) {
            let answered: Promise<FakeResponse> | undefined
            handlers.fetch({
                request: { url: `https://songbird.test${path}`, method: init.method ?? 'GET', mode: init.mode ?? 'cors' },
                respondWith: (p: Promise<FakeResponse>) => { answered = p },
            })
            return answered ? { handled: true as const, response: await answered } : { handled: false as const }
        },
    }
}

const ok = () => new FakeResponse('<html>')
const redirected = () => new FakeResponse('<html>sign in', { redirected: true })

describe('install', () => {
    it('stores each shell page that came back as a success', async () => {
        const sw = boot(async () => ok())
        expect(await sw.install()).toBe('installed')
        const shell = [...sw.stores.values()][0]
        expect([...shell.keys()].sort()).toEqual(['/', '/library', '/offline'])
    })

    it('does not store a page that came by redirect, and still installs', async () => {
        const sw = boot(async path => path === '/library' ? redirected() : ok())
        expect(await sw.install()).toBe('installed')
        const shell = [...sw.stores.values()][0]
        expect([...shell.keys()].sort()).toEqual(['/', '/offline'])
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
