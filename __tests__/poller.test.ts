// Job pollers used to be setInterval: a slow answer let the next request start
// before the last one finished, and they kept asking while the page was hidden
// or offline. startPoller chains requests (the next waits for the last) and asks
// nothing while it can't run.
import { startPoller } from '../app/lib/poller'

beforeEach(() => { jest.useFakeTimers() })
afterEach(() => { jest.useRealTimers() })

function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>(r => { resolve = r })
    return { promise, resolve }
}

describe('startPoller', () => {
    it('runs once per interval', async () => {
        const run = jest.fn().mockResolvedValue(undefined)
        const stop = startPoller({ run, intervalMs: 1000 })
        await jest.advanceTimersByTimeAsync(3100)
        expect(run).toHaveBeenCalledTimes(3)
        stop()
    })

    it('never overlaps: a slow request holds the next one back', async () => {
        const first = deferred()
        const run = jest.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined)
        const stop = startPoller({ run, intervalMs: 1000 })
        await jest.advanceTimersByTimeAsync(5000)
        expect(run).toHaveBeenCalledTimes(1)
        first.resolve()
        await jest.advanceTimersByTimeAsync(1000)
        expect(run).toHaveBeenCalledTimes(2)
        stop()
    })

    it('asks nothing while canRun is false, and carries on when it turns true', async () => {
        let allowed = false
        const run = jest.fn().mockResolvedValue(undefined)
        const stop = startPoller({ run, intervalMs: 1000, canRun: () => allowed })
        await jest.advanceTimersByTimeAsync(4000)
        expect(run).not.toHaveBeenCalled()
        allowed = true
        await jest.advanceTimersByTimeAsync(1000)
        expect(run).toHaveBeenCalledTimes(1)
        stop()
    })

    it('a failed request does not end the polling', async () => {
        const run = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
        const stop = startPoller({ run, intervalMs: 1000 })
        await jest.advanceTimersByTimeAsync(2100)
        expect(run).toHaveBeenCalledTimes(2)
        stop()
    })

    it('stop ends it, even with a request in flight', async () => {
        const first = deferred()
        const run = jest.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined)
        const stop = startPoller({ run, intervalMs: 1000 })
        await jest.advanceTimersByTimeAsync(1000)
        stop()
        first.resolve()
        await jest.advanceTimersByTimeAsync(5000)
        expect(run).toHaveBeenCalledTimes(1)
    })
})
