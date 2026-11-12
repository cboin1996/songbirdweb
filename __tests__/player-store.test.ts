// Components read the player's state (current song, playing, queue and the rest)
// from this store through a selector, so a library row re-renders only when its
// own answer changes ("is my song current"), not on every track change or toast.
import { createPlayerStore, isCurrentSelector } from '../app/lib/player-store'

const songA = { uuid: 'a', properties: {} as never }
const songB = { uuid: 'b', properties: {} as never }

function watched() {
    const store = createPlayerStore()
    const heard = jest.fn()
    store.subscribe(heard)
    return { store, heard }
}

describe('player store', () => {
    it('starts with nothing playing', () => {
        expect(createPlayerStore().get()).toEqual({
            current: null, isPlaying: false, queue: [], shuffle: false, repeat: 'all', playContext: null,
        })
    })

    it('tells subscribers when a field changes', () => {
        const { store, heard } = watched()
        store.set({ isPlaying: true })
        expect(heard).toHaveBeenCalledTimes(1)
        expect(store.get().isPlaying).toBe(true)
    })

    it('stays quiet and keeps the same snapshot when nothing changed', () => {
        const { store, heard } = watched()
        const before = store.get()
        store.set({ isPlaying: false, current: null })
        expect(heard).toHaveBeenCalledTimes(0)
        expect(store.get()).toBe(before)
    })

    it('compares by identity, so a new queue array is a change', () => {
        const { store, heard } = watched()
        store.set({ queue: [] })
        expect(heard).toHaveBeenCalledTimes(1)
    })

    it('stops telling a listener after it unsubscribes', () => {
        const store = createPlayerStore()
        const heard = jest.fn()
        const off = store.subscribe(heard)
        off()
        store.set({ shuffle: true })
        expect(heard).toHaveBeenCalledTimes(0)
    })

    it('answers "is this song current" per song', () => {
        const store = createPlayerStore()
        store.set({ current: songA })
        expect(isCurrentSelector('a')(store.get())).toBe(true)
        expect(isCurrentSelector('b')(store.get())).toBe(false)
        store.set({ current: songB })
        expect(isCurrentSelector('a')(store.get())).toBe(false)
        expect(isCurrentSelector('b')(store.get())).toBe(true)
    })

    it('says no song is current when nothing is loaded', () => {
        expect(isCurrentSelector('a')(createPlayerStore().get())).toBe(false)
        expect(isCurrentSelector(undefined)(createPlayerStore().get())).toBe(false)
    })
})
