// The timing knobs the e2e specs shorten. A spec sets one after the page is up,
// so the value has to be read when it is used, not when the module loads.
import { readTestOverride } from '../app/lib/test-overrides'

afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__tokenRefreshStaleMs
})

describe('readTestOverride', () => {
    it('returns the fallback when nothing is set', () => {
        expect(readTestOverride('__tokenRefreshStaleMs', 600000)).toBe(600000)
    })

    it('returns what a spec set after the module loaded', () => {
        ;(window as unknown as Record<string, unknown>).__tokenRefreshStaleMs = 5
        expect(readTestOverride('__tokenRefreshStaleMs', 600000)).toBe(5)
    })

    it('honours zero, which means "always stale", not "unset"', () => {
        ;(window as unknown as Record<string, unknown>).__tokenRefreshStaleMs = 0
        expect(readTestOverride('__tokenRefreshStaleMs', 600000)).toBe(0)
    })

    it('ignores a value that is not a number', () => {
        ;(window as unknown as Record<string, unknown>).__tokenRefreshStaleMs = '5'
        expect(readTestOverride('__tokenRefreshStaleMs', 600000)).toBe(600000)
    })
})
