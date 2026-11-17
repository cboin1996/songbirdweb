import { peekNextUuid, createPrefetchSlot, type NextInput } from '../app/lib/prefetch'

const base: NextInput = { uuids: ['a', 'b', 'c'], index: 0, shuffle: false, shuffleOrder: [], shufflePos: 0, repeat: 'off', manualNextCount: 0 }

describe('peekNextUuid', () => {
    it('is the next entry in order', () => expect(peekNextUuid(base)).toBe('b'))
    it('is null at the end of a queue that does not repeat', () => expect(peekNextUuid({ ...base, index: 2 })).toBeNull())
    it('wraps to the first entry with repeat all', () => expect(peekNextUuid({ ...base, index: 2, repeat: 'all' })).toBe('a'))
    it('does not name the current song as its own next', () => expect(peekNextUuid({ ...base, uuids: ['a'], repeat: 'all' })).toBeNull())
    it('follows the shuffle order', () => expect(peekNextUuid({ ...base, shuffle: true, shuffleOrder: [0, 2, 1], shufflePos: 0 })).toBe('c'))
    it('is null at a shuffle lap boundary, where the next song is picked at random', () =>
        expect(peekNextUuid({ ...base, shuffle: true, shuffleOrder: [0, 2, 1], shufflePos: 2, repeat: 'all' })).toBeNull())
    it('looks at the entry after the current one when songs are queued by hand under shuffle', () =>
        expect(peekNextUuid({ ...base, shuffle: true, shuffleOrder: [0, 2, 1], shufflePos: 0, manualNextCount: 1 })).toBe('b'))
    it('is null for an empty queue or no current song', () => {
        expect(peekNextUuid({ ...base, uuids: [] })).toBeNull()
        expect(peekNextUuid({ ...base, index: -1 })).toBeNull()
    })
})

describe('createPrefetchSlot', () => {
    const blob = { size: 3 } as Blob
    it('hands the blob over once and then is empty', () => {
        const slot = createPrefetchSlot()
        slot.hold('b', blob)
        expect(slot.holds('b')).toBe(true)
        expect(slot.take('b')).toBe(blob)
        expect(slot.take('b')).toBeNull()
        expect(slot.holds('b')).toBe(false)
    })
    it('gives nothing for a different song', () => {
        const slot = createPrefetchSlot()
        slot.hold('b', blob)
        expect(slot.take('c')).toBeNull()
        expect(slot.holds('b')).toBe(true)
    })
    it('holds one song: a new one replaces the old', () => {
        const slot = createPrefetchSlot()
        slot.hold('b', blob)
        slot.hold('c', blob)
        expect(slot.holds('b')).toBe(false)
        expect(slot.holds('c')).toBe(true)
    })
    it('release empties the slot unless it holds the song to keep', () => {
        const slot = createPrefetchSlot()
        slot.hold('b', blob)
        slot.release('b')
        expect(slot.holds('b')).toBe(true)
        slot.release('c')
        expect(slot.holds('b')).toBe(false)
        slot.hold('b', blob)
        slot.release()
        expect(slot.holds('b')).toBe(false)
    })
})
