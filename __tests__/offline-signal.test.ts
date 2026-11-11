// "Offline" for the player and the library is one question with one answer: the
// browser says so, or the last call to the API found the server unreachable.
import { EVENTS } from '../app/lib/events'

type Signal = typeof import('../app/lib/offline-signal')

async function load(): Promise<Signal> {
    let mod!: Signal
    await jest.isolateModulesAsync(async () => { mod = await import('../app/lib/offline-signal') })
    return mod
}

function setBrowserOnline(value: boolean) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
}

beforeEach(() => setBrowserOnline(true))

describe('isOffline', () => {
    it('is false while the browser is online and the server answers', async () => {
        const { isOffline } = await load()
        expect(isOffline()).toBe(false)
    })

    it('is true when the browser reports offline', async () => {
        const { isOffline } = await load()
        setBrowserOnline(false)
        expect(isOffline()).toBe(true)
    })

    it('is true when the server was unreachable although the browser still reports a connection', async () => {
        const { isOffline } = await load()
        window.dispatchEvent(new CustomEvent(EVENTS.serverUnreachable))
        expect(isOffline()).toBe(true)
    })

    it('ends when the server answers again', async () => {
        const { isOffline } = await load()
        window.dispatchEvent(new CustomEvent(EVENTS.serverUnreachable))
        window.dispatchEvent(new CustomEvent(EVENTS.serverReachable))
        expect(isOffline()).toBe(false)
    })

    it('does not end while the browser itself is offline, whatever the server last said', async () => {
        const { isOffline } = await load()
        window.dispatchEvent(new CustomEvent(EVENTS.serverUnreachable))
        setBrowserOnline(false)
        window.dispatchEvent(new CustomEvent(EVENTS.serverReachable))
        expect(isOffline()).toBe(true)
    })

    it('ends when the browser reports a connection coming back', async () => {
        const { isOffline } = await load()
        window.dispatchEvent(new CustomEvent(EVENTS.serverUnreachable))
        window.dispatchEvent(new Event('online'))
        expect(isOffline()).toBe(false)
    })
})

describe('subscribeOffline', () => {
    it('tells a listener each time the answer can have changed, until it unsubscribes', async () => {
        const { subscribeOffline } = await load()
        const seen: string[] = []
        const unsubscribe = subscribeOffline(() => seen.push('changed'))
        window.dispatchEvent(new CustomEvent(EVENTS.serverUnreachable))
        window.dispatchEvent(new CustomEvent(EVENTS.serverReachable))
        expect(seen).toEqual(['changed', 'changed'])
        unsubscribe()
        window.dispatchEvent(new CustomEvent(EVENTS.serverUnreachable))
        expect(seen).toEqual(['changed', 'changed'])
    })
})
