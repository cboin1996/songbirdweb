// A request that is slow makes the app ask the server something small. Two rules:
// a request answered while that question is out leaves the server reachable, and slow
// requests share one question instead of asking one each.
import { EVENTS } from '../app/lib/events'

type Data = typeof import('../app/lib/data')

async function load(): Promise<Data> {
    let mod!: Data
    await jest.isolateModulesAsync(async () => { mod = await import('../app/lib/data') })
    return mod
}

const json = (body: unknown) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body, text: async () => JSON.stringify(body), clone() { return this } })

let healthCalls: number
let healthDone: (r: unknown) => void
let libraryDone: (r: unknown) => void
let unreachable: number

beforeEach(() => {
    jest.useFakeTimers()
    healthCalls = 0
    unreachable = 0
    window.addEventListener(EVENTS.serverUnreachable, () => { unreachable += 1 })
    ;(window as unknown as { __slowRequestMs: number }).__slowRequestMs = 100
    ;(globalThis as unknown as { fetch: unknown }).fetch = (url: string) => {
        if (url.includes('/health')) { healthCalls += 1; return new Promise(r => { healthDone = r }) }
        return new Promise(r => { libraryDone = r })
    }
})
afterEach(() => { jest.useRealTimers() })

describe('watchForSilence', () => {
    it('does not call the server unreachable when the slow request is answered while the question is out', async () => {
        const { fetchLibrarySongs } = await load()
        const pending = fetchLibrarySongs()
        await jest.advanceTimersByTimeAsync(150) // slow: the question goes out
        expect(healthCalls).toBe(1)
        libraryDone(json([]))
        await pending
        // the question times out unanswered afterwards
        healthDone(Promise.reject(new Error('timeout')))
        await jest.advanceTimersByTimeAsync(5000)
        expect(unreachable).toBe(0)
    })

    it('asks once for several slow requests', async () => {
        const { fetchLibrarySongs } = await load()
        void fetchLibrarySongs(); void fetchLibrarySongs(); void fetchLibrarySongs()
        await jest.advanceTimersByTimeAsync(150)
        expect(healthCalls).toBe(1)
    })
})
