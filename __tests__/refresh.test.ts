// The refresh state machine in app/lib/data.ts. Module state (the freshness
// timestamp, the cooldown) is the thing under test, so every test loads a fresh
// copy of the module.
type Data = typeof import('../app/lib/data')

const fetchMock = jest.fn()

async function load(): Promise<Data> {
    let mod!: Data
    await jest.isolateModulesAsync(async () => { mod = await import('../app/lib/data') })
    return mod
}

function respond(status: number) {
    fetchMock.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status })
}

beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'))
})

afterEach(() => {
    jest.useRealTimers()
})

describe('tryRefresh', () => {
    it('is ok on a 200', async () => {
        respond(200)
        expect(await (await load()).tryRefresh()).toBe('ok')
    })

    it.each([401, 403])('is rejected on a %i', async status => {
        respond(status)
        expect(await (await load()).tryRefresh()).toBe('rejected')
    })

    it.each([500, 502, 503])('is unavailable on a %i', async status => {
        respond(status)
        expect(await (await load()).tryRefresh()).toBe('unavailable')
    })

    it('is unavailable when the network fails', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('failed to fetch'))
        expect(await (await load()).tryRefresh()).toBe('unavailable')
    })

    it('shares one request between concurrent callers', async () => {
        respond(200)
        const data = await load()
        const [a, b] = await Promise.all([data.tryRefresh(), data.tryRefresh()])
        expect([a, b]).toEqual(['ok', 'ok'])
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('gives up on a request that never answers, without AbortSignal.timeout', async () => {
        const original = AbortSignal.timeout
        // @ts-expect-error simulating a browser that lacks it
        delete AbortSignal.timeout
        try {
            fetchMock.mockImplementationOnce((_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init.signal!.addEventListener('abort', () => reject(new Error('aborted')))
                }))
            const pending = (await load()).tryRefresh()
            await jest.advanceTimersByTimeAsync(8000)
            expect(await pending).toBe('unavailable')
        } finally {
            AbortSignal.timeout = original
        }
    })
})

describe('ensureFreshToken', () => {
    it('refreshes on the first call of a page, which has no idea how old its token is', async () => {
        respond(200)
        expect(await (await load()).ensureFreshToken()).toBe('ok')
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does not refresh again while the token is fresh', async () => {
        respond(200)
        const data = await load()
        await data.ensureFreshToken()
        jest.advanceTimersByTime(9 * 60 * 1000)
        expect(await data.ensureFreshToken()).toBe('ok')
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('refreshes again once the token is stale', async () => {
        respond(200)
        respond(200)
        const data = await load()
        await data.ensureFreshToken()
        jest.advanceTimersByTime(10 * 60 * 1000)
        await data.ensureFreshToken()
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('does not ask again for 30 seconds after a failure, then does', async () => {
        respond(503)
        respond(200)
        const data = await load()
        expect(await data.ensureFreshToken()).toBe('unavailable')
        jest.advanceTimersByTime(29_000)
        expect(await data.ensureFreshToken()).toBe('unavailable')
        expect(fetchMock).toHaveBeenCalledTimes(1)
        jest.advanceTimersByTime(2_000)
        expect(await data.ensureFreshToken()).toBe('ok')
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('reports a rejection from the cooldown too', async () => {
        respond(401)
        const data = await load()
        expect(await data.ensureFreshToken()).toBe('rejected')
        expect(await data.ensureFreshToken()).toBe('rejected')
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('leaves the reactive path alone: a real 401 always gets an attempt', async () => {
        respond(503)
        respond(200)
        const data = await load()
        await data.ensureFreshToken()
        expect(await data.tryRefresh()).toBe('ok')
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })
})
