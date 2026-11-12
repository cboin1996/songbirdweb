// When the app believes the server is gone ("offline") and when it stops believing
// it. A request the app gave up on is not an unreachable server, any answer from
// the server ends the belief, and a paused app asks on its own.
export {}
type Data = typeof import('../app/lib/data')
type Signal = typeof import('../app/lib/offline-signal')

const fetchMock = jest.fn()

async function load(): Promise<{ data: Data; signal: Signal }> {
    let data!: Data
    let signal!: Signal
    await jest.isolateModulesAsync(async () => {
        data = await import('../app/lib/data')
        signal = await import('../app/lib/offline-signal')
    })
    return { data, signal }
}

function answer(status: number, headers: Record<string, string> = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => headers[name] ?? null },
        json: async () => ({}),
    }
}

// A fetch that never answers, and ends the way the real one does when aborted.
function hangUntilAborted(_url: string, opts?: RequestInit) {
    return new Promise((_, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
}

const state = {
    shuffle: false, repeat: 'off' as const, queue: [], queue_index: 0, current_song_uuid: null,
} as unknown as import('../app/lib/data').PlayerState

// Each loaded copy of the app's modules listens on the one shared window; a copy
// left over from an earlier test would answer this test's events too.
const listeners: [string, EventListenerOrEventListenerObject][] = []

beforeEach(() => {
    const add = window.addEventListener.bind(window)
    jest.spyOn(window, 'addEventListener').mockImplementation((type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
        listeners.push([type, fn])
        add(type, fn, opts)
    })
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
    jest.useFakeTimers()
})

afterEach(() => {
    jest.restoreAllMocks()
    for (const [type, fn] of listeners.splice(0)) window.removeEventListener(type, fn)
    jest.useRealTimers()
    delete (window as unknown as Record<string, unknown>).__probeIntervalMs
})

describe('a player write that takes too long', () => {
    it('is given up on without calling the server unreachable', async () => {
        fetchMock.mockImplementation(hangUntilAborted)
        const { data, signal } = await load()

        const saved = data.savePlayerState(() => state)
        const settled = saved.then(() => 'ok', (e: Error) => e.message)
        await jest.advanceTimersByTimeAsync(15000)

        expect(await settled).toMatch(/timed out/)
        expect(signal.isOffline()).toBe(false)
    })
})

describe('what ends "the server is unreachable"', () => {
    it.each([404, 500, 503])('a %i from the server does', async status => {
        fetchMock.mockRejectedValueOnce(new TypeError('failed to fetch'))
        const { data, signal } = await load()
        await expect(data.fetchPlayerState()).rejects.toThrow()
        expect(signal.isOffline()).toBe(true)

        fetchMock.mockResolvedValueOnce(answer(status))
        await expect(data.fetchPlayerState()).rejects.toThrow()
        expect(signal.isOffline()).toBe(false)
    })

    it('a 502 from the proxy does not', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('failed to fetch'))
        const { data, signal } = await load()
        await expect(data.fetchPlayerState()).rejects.toThrow()

        fetchMock.mockResolvedValueOnce(answer(502))
        await expect(data.fetchPlayerState()).rejects.toThrow()
        expect(signal.isOffline()).toBe(true)
    })

    it('a copy the service worker served from its cache does not', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('failed to fetch'))
        const { data, signal } = await load()
        await expect(data.fetchPlayerState()).rejects.toThrow()

        fetchMock.mockResolvedValueOnce(answer(200, { 'X-SW-Stale': '1' }))
        await data.fetchPlayerState()
        expect(signal.isOffline()).toBe(true)
    })
})

describe('asking whether the server is back', () => {
    it('ends offline on its own once the server answers, with nothing else asking', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('failed to fetch'))
        const { data, signal } = await load()
        await expect(data.fetchPlayerState()).rejects.toThrow()
        expect(signal.isOffline()).toBe(true)

        fetchMock.mockResolvedValue(answer(200))
        await jest.advanceTimersByTimeAsync(15000)

        expect(fetchMock).toHaveBeenLastCalledWith(expect.stringMatching(/\/v1\/health$/), expect.anything())
        expect(signal.isOffline()).toBe(false)
    })

    it('keeps asking while the server stays gone, and stops asking once it is back', async () => {
        fetchMock.mockRejectedValue(new TypeError('failed to fetch'))
        const { data, signal } = await load()
        await expect(data.fetchPlayerState()).rejects.toThrow()
        fetchMock.mockClear()

        await jest.advanceTimersByTimeAsync(45000)
        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(signal.isOffline()).toBe(true)

        fetchMock.mockResolvedValue(answer(200))
        await jest.advanceTimersByTimeAsync(15000)
        expect(signal.isOffline()).toBe(false)
        fetchMock.mockClear()

        await jest.advanceTimersByTimeAsync(60000)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('stays quiet while the browser itself says it is offline', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('failed to fetch'))
        const { data } = await load()
        await expect(data.fetchPlayerState()).rejects.toThrow()
        fetchMock.mockClear()
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })

        await jest.advanceTimersByTimeAsync(60000)
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

describe('the probe while the browser has no network', () => {
    it('stops its timer instead of ticking, and a later failed request starts it again', async () => {
        fetchMock.mockRejectedValue(new TypeError('failed to fetch'))
        const { data, signal } = await load()
        await expect(data.fetchPlayerState()).rejects.toThrow()
        fetchMock.mockClear()

        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
        await jest.advanceTimersByTimeAsync(15000)
        expect(jest.getTimerCount()).toBe(0)
        expect(fetchMock).not.toHaveBeenCalled()

        // Network back: the browser's event ends the belief; the next failure re-arms the probe.
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
        window.dispatchEvent(new Event('online'))
        expect(signal.isOffline()).toBe(false)
        await expect(data.fetchPlayerState()).rejects.toThrow()
        fetchMock.mockClear()
        await jest.advanceTimersByTimeAsync(15000)
        expect(fetchMock).toHaveBeenLastCalledWith(expect.stringMatching(/\/v1\/health$/), expect.anything())
    })
})

describe('a player save that failed because the server was gone', () => {
    it('is sent again when the server is back, with nothing else asking', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('failed to fetch'))
        const { data, signal } = await load()
        await expect(data.savePlayerState(() => state)).rejects.toThrow()
        expect(signal.isOffline()).toBe(true)
        fetchMock.mockClear()

        fetchMock.mockResolvedValue(answer(200))
        await jest.advanceTimersByTimeAsync(15000)

        const puts = fetchMock.mock.calls.filter(([url, opts]) => /\/player\/state$/.test(url) && opts?.method === 'PUT')
        expect(puts).toHaveLength(1)
        expect(signal.isOffline()).toBe(false)
    })

    it('is not sent again when the server answered with an error', async () => {
        fetchMock.mockResolvedValue(answer(500))
        const { data } = await load()
        await expect(data.savePlayerState(() => state)).rejects.toThrow()
        fetchMock.mockClear()

        await jest.advanceTimersByTimeAsync(60000)
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

describe('a request retried after a token refresh', () => {
    // The first answer is a 401; the refresh succeeds; the retry is what the caller gets.
    function after401(retry: () => unknown) {
        fetchMock.mockImplementation((url: string) => {
            if (/\/auth\/refresh$/.test(url)) return Promise.resolve(answer(200))
            if (fetchMock.mock.calls.filter(([u]) => u === url).length === 1) return Promise.resolve(answer(401))
            return retry()
        })
    }

    it('is not taken for fresh when the service worker answered it with a stored copy', async () => {
        after401(() => Promise.resolve(answer(200, { 'X-SW-Stale': '1' })))
        const { data } = await load()
        expect(await data.fetchPlayerStateAtLaunch()).toMatchObject({ stale: true })
    })

    it('that the network drops is an unreachable server, not a raw error', async () => {
        after401(() => Promise.reject(new TypeError('failed to fetch')))
        const { data, signal } = await load()
        await expect(data.fetchPlayerState()).rejects.toMatchObject({ status: 0 })
        expect(signal.isOffline()).toBe(true)
    })
})

describe('the library when the server is struggling', () => {
    it.each([503, 504])('at launch, a %i does not skip the restore of the player', async status => {
        fetchMock.mockResolvedValue(answer(status))
        const { data } = await load()
        // No copy kept in this test: an empty library, not a thrown error.
        await expect(data.fetchLibrarySongsAtLaunch()).resolves.toEqual([])
    })

    it.each([503, 404])('on the library page, a %i is still an error to show', async status => {
        fetchMock.mockResolvedValue(answer(status))
        const { data } = await load()
        await expect(data.fetchLibrarySongs()).rejects.toMatchObject({ status })
    })
})
