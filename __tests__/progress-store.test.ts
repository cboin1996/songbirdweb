// The player bar and the time labels read playback position from this store, not
// from the player's React state, so a timeupdate (about 4 a second) no longer
// re-renders the whole player. Subscribers hear about a change at most once per
// whole second of playback, and always when the user seeks.
import { createProgressStore } from '../app/lib/progress-store'

function watched() {
    const store = createProgressStore()
    const heard = jest.fn()
    store.subscribe(heard)
    return { store, heard }
}

describe('progress store', () => {
    it('starts at zero', () => {
        expect(createProgressStore().get()).toEqual({ time: 0, duration: 0, buffered: 0 })
    })

    it('tells subscribers when the whole second changes', () => {
        const { store, heard } = watched()
        store.update({ time: 1.1 })
        expect(heard).toHaveBeenCalledTimes(1)
        expect(store.get().time).toBe(1.1)
    })

    it('stays quiet for ticks inside the same second', () => {
        const { store, heard } = watched()
        store.update({ time: 1.1 })
        store.update({ time: 1.4 })
        store.update({ time: 1.9 })
        expect(heard).toHaveBeenCalledTimes(1)
        expect(store.get().time).toBe(1.1)
    })

    it('speaks again at the next second', () => {
        const { store, heard } = watched()
        store.update({ time: 1.1 })
        store.update({ time: 2.0 })
        expect(heard).toHaveBeenCalledTimes(2)
    })

    it('a seek always passes, even inside the same second', () => {
        const { store, heard } = watched()
        store.update({ time: 1.1 })
        store.update({ time: 1.8 }, { force: true })
        expect(heard).toHaveBeenCalledTimes(2)
        expect(store.get().time).toBe(1.8)
    })

    it('a duration change always passes', () => {
        const { store, heard } = watched()
        store.update({ duration: 241.5 })
        expect(heard).toHaveBeenCalledTimes(1)
        expect(store.get().duration).toBe(241.5)
    })

    it('buffered moves with the whole second too', () => {
        const { store, heard } = watched()
        store.update({ buffered: 10.2 })
        store.update({ buffered: 10.7 })
        store.update({ buffered: 11.0 })
        expect(heard).toHaveBeenCalledTimes(2)
    })

    it('reset zeroes everything and tells subscribers', () => {
        const { store, heard } = watched()
        store.update({ time: 30, duration: 200, buffered: 90 }, { force: true })
        heard.mockClear()
        store.reset()
        expect(store.get()).toEqual({ time: 0, duration: 0, buffered: 0 })
        expect(heard).toHaveBeenCalledTimes(1)
    })

    it('hands back the same snapshot object when nothing changed (useSyncExternalStore needs that)', () => {
        const { store } = watched()
        store.update({ time: 1.1 })
        const a = store.get()
        store.update({ time: 1.3 })
        expect(store.get()).toBe(a)
    })

    it('unsubscribe stops notifications', () => {
        const store = createProgressStore()
        const heard = jest.fn()
        const off = store.subscribe(heard)
        off()
        store.update({ time: 5 })
        expect(heard).not.toHaveBeenCalled()
    })

    it('does not emit again for a duration that stays NaN', () => {
        const { store, heard } = watched()
        store.update({ duration: NaN })
        heard.mockClear()
        store.update({ duration: NaN })
        store.update({ time: NaN, buffered: NaN })
        heard.mockClear()
        store.update({ time: NaN, buffered: NaN })
        expect(heard).not.toHaveBeenCalled()
    })
})
