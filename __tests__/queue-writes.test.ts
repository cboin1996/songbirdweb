// The player's server writes: insert, remove and reorder each describe the queue
// as it was when the user acted, and the whole-state save describes everything. They
// only mean the same thing if they reach the server in the order they were made.
import { createWriteChain } from '../app/lib/queue-writes'

const LIMIT = 15000

function deferred<T = void>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

beforeEach(() => {
    jest.useFakeTimers()
    // A failed write is logged; these tests fail writes on purpose.
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
})

type State = { n: number }
// A chain whose whole-state save records the body it was sent.
function makeChain(sendGate?: () => Promise<void>) {
    const sent: State[] = []
    const chain = createWriteChain<State>(LIMIT, async state => {
        sent.push(state)
        if (sendGate) await sendGate()
    })
    return { chain, sent }
}

describe('createWriteChain', () => {
    it('starts a write only after the one before it has settled', async () => {
        const chain = makeChain().chain
        const log: string[] = []
        const first = deferred()
        const a = chain.enqueue(async () => { log.push('a:start'); await first.promise; log.push('a:end') })
        const b = chain.enqueue(async () => { log.push('b:start') })
        await jest.advanceTimersByTimeAsync(1000)
        expect(log).toEqual(['a:start'])
        first.resolve()
        await Promise.all([a, b])
        expect(log).toEqual(['a:start', 'a:end', 'b:start'])
    })

    it('runs the next write after one fails, and reports the failure to its own caller only', async () => {
        const chain = makeChain().chain
        const ran: string[] = []
        const a = chain.enqueue(async () => { throw new Error('boom') })
        const b = chain.enqueue(async () => { ran.push('b') })
        await expect(a).rejects.toThrow('boom')
        await b
        expect(ran).toEqual(['b'])
    })

    it('gives up on a write that takes longer than the limit, and runs the next', async () => {
        const chain = makeChain().chain
        const ran: string[] = []
        let aborted = false
        const a = chain.enqueue(signal => {
            signal.addEventListener('abort', () => { aborted = true })
            return new Promise<void>(() => {})
        })
        const b = chain.enqueue(async () => { ran.push('b') })
        const settled = expect(a).rejects.toThrow(/timed out/)
        await jest.advanceTimersByTimeAsync(LIMIT - 1)
        expect(ran).toEqual([])
        await jest.advanceTimersByTimeAsync(1)
        await settled
        await b
        expect(aborted).toBe(true)
        expect(ran).toEqual(['b'])
    })

    it('does not time a write that is still waiting its turn', async () => {
        const chain = makeChain().chain
        const first = deferred()
        const a = chain.enqueue(() => first.promise)
        const ran: string[] = []
        const b = chain.enqueue(async () => { ran.push('b') })
        await jest.advanceTimersByTimeAsync(LIMIT - 1)
        first.resolve()
        await Promise.all([a, b])
        expect(ran).toEqual(['b'])
    })

    describe('the whole-state save', () => {
        it('is built when it is sent, not when it is asked for', async () => {
            const { chain, sent } = makeChain()
            const slow = deferred()
            const a = chain.enqueue(() => slow.promise)
            let n = 1
            const saved = chain.enqueueState(() => ({ n }))
            n = 2
            slow.resolve()
            await Promise.all([a, saved])
            expect(sent).toEqual([{ n: 2 }])
        })

        it('is replaced by a newer one while it waits, so one goes out', async () => {
            const { chain, sent } = makeChain()
            const slow = deferred()
            const a = chain.enqueue(() => slow.promise)
            const first = chain.enqueueState(() => ({ n: 1 }))
            const second = chain.enqueueState(() => ({ n: 2 }))
            slow.resolve()
            await Promise.all([a, first, second])
            expect(sent).toEqual([{ n: 2 }])
        })

        it('drops the queue changes waiting beside it, those before and after', async () => {
            const { chain, sent } = makeChain()
            const slow = deferred()
            const ran: string[] = []
            const a = chain.enqueue(() => slow.promise)
            const before = chain.enqueue(async () => { ran.push('before') })
            const saved = chain.enqueueState(() => ({ n: 1 }))
            const after = chain.enqueue(async () => { ran.push('after') })
            slow.resolve()
            await Promise.all([a, before, saved, after])
            expect(ran).toEqual([])
            expect(sent).toEqual([{ n: 1 }])
        })

        it('does not drop the change that is already in flight', async () => {
            const { chain, sent } = makeChain()
            const slow = deferred()
            const order: string[] = []
            const a = chain.enqueue(async () => { order.push('a:start'); await slow.promise; order.push('a:end') })
            const saved = chain.enqueueState(() => ({ n: 1 }))
            await jest.advanceTimersByTimeAsync(100)
            expect(sent).toEqual([])
            slow.resolve()
            await Promise.all([a, saved])
            expect(order).toEqual(['a:start', 'a:end'])
            expect(sent).toEqual([{ n: 1 }])
        })
    })

    describe('after a queue change fails', () => {
        it('ends with a fresh whole-state save, built then and not the one sent before', async () => {
            const { chain, sent } = makeChain()
            let n = 1
            await chain.enqueueState(() => ({ n }))
            sent.length = 0
            n = 2
            const failing = chain.enqueue(async () => { throw new Error('boom') })
            await expect(failing).rejects.toThrow('boom')
            await jest.advanceTimersByTimeAsync(0)
            expect(sent).toEqual([{ n: 2 }])
        })

        it('does so after a timeout as well', async () => {
            const { chain, sent } = makeChain()
            await chain.enqueueState(() => ({ n: 1 }))
            sent.length = 0
            const hung = chain.enqueue(() => new Promise<void>(() => {}))
            const settled = expect(hung).rejects.toThrow(/timed out/)
            await jest.advanceTimersByTimeAsync(LIMIT)
            await settled
            await jest.advanceTimersByTimeAsync(0)
            expect(sent).toEqual([{ n: 1 }])
        })

        it('does not follow a failed whole-state save with another, so an offline player does not loop', async () => {
            const sent: State[] = []
            const chain = createWriteChain<State>(LIMIT, async state => { sent.push(state); throw new Error('offline') })
            await expect(chain.enqueueState(() => ({ n: 1 }))).rejects.toThrow('offline')
            await jest.advanceTimersByTimeAsync(LIMIT * 2)
            expect(sent).toEqual([{ n: 1 }])
        })
    })

    describe('pending', () => {
        it('is true from the first write being asked for until the last has settled', async () => {
            const { chain } = makeChain()
            expect(chain.pending()).toBe(false)
            const slow = deferred()
            const a = chain.enqueue(() => slow.promise)
            const saved = chain.enqueueState(() => ({ n: 1 }))
            expect(chain.pending()).toBe(true)
            slow.resolve()
            await Promise.all([a, saved])
            expect(chain.pending()).toBe(false)
        })
    })
})

describe('resendIfFailed', () => {
    it('sends the state again when the last save of it failed', async () => {
        let fail = true
        const { chain, sent } = makeChain(async () => { if (fail) throw new Error('unreachable') })
        const first = chain.enqueueState(() => ({ n: 1 }))
        await expect(first).rejects.toThrow('unreachable')

        fail = false
        chain.resendIfFailed()
        await jest.advanceTimersByTimeAsync(0)

        expect(sent).toEqual([{ n: 1 }, { n: 1 }])
        expect(chain.pending()).toBe(false)
    })

    it('sends what the player holds now, not what it held when the save failed', async () => {
        let n = 1
        let fail = true
        const { chain, sent } = makeChain(async () => { if (fail) throw new Error('unreachable') })
        await expect(chain.enqueueState(() => ({ n }))).rejects.toThrow()

        n = 2
        fail = false
        chain.resendIfFailed()
        await jest.advanceTimersByTimeAsync(0)

        expect(sent[sent.length - 1]).toEqual({ n: 2 })
    })

    it('does nothing when the last save of the state went through', async () => {
        const { chain, sent } = makeChain()
        await chain.enqueueState(() => ({ n: 1 }))
        chain.resendIfFailed()
        await jest.advanceTimersByTimeAsync(0)
        expect(sent).toHaveLength(1)
    })

    it('does nothing when no save of the state has been tried', async () => {
        const { chain, sent } = makeChain()
        chain.resendIfFailed()
        await jest.advanceTimersByTimeAsync(0)
        expect(sent).toHaveLength(0)
    })

    it('does not queue a second save while one is already waiting', async () => {
        const gate = deferred()
        let calls = 0
        const { chain, sent } = makeChain(async () => {
            calls++
            if (calls === 1) throw new Error('unreachable')
            await gate.promise
        })
        await expect(chain.enqueueState(() => ({ n: 1 }))).rejects.toThrow()
        chain.resendIfFailed()
        chain.resendIfFailed()
        gate.resolve()
        await jest.advanceTimersByTimeAsync(0)
        expect(sent).toHaveLength(2)
    })

    it('stops once a resend goes through', async () => {
        let fail = true
        const { chain, sent } = makeChain(async () => { if (fail) throw new Error('unreachable') })
        await expect(chain.enqueueState(() => ({ n: 1 }))).rejects.toThrow()
        fail = false
        chain.resendIfFailed()
        await jest.advanceTimersByTimeAsync(0)
        chain.resendIfFailed()
        await jest.advanceTimersByTimeAsync(0)
        expect(sent).toHaveLength(2)
    })
})

describe('what a write that did not reach the server leaves behind', () => {
    it('is logged, because its caller usually ignores it', async () => {
        const { chain } = makeChain(async () => { throw new Error('unreachable') })
        await expect(chain.enqueueState(() => ({ n: 1 }))).rejects.toThrow()
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('state write failed'), 'unreachable')
    })
})
