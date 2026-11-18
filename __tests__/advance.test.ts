import { decideAdvance, type AdvanceInput } from '../app/lib/advance'

const base: AdvanceInput = {
    queueLength: 4, index: 1, shuffle: false, shuffleOrder: [], shufflePos: 0,
    repeat: 'off', manualNextCount: 0, random: () => 0,
}
const at = (o: Partial<AdvanceInput>) => decideAdvance({ ...base, ...o })

describe('decideAdvance, shuffle off', () => {
    it('goes to the next entry', () => expect(at({})).toEqual({ kind: 'linear', idx: 2 }))
    it('stops at the end without repeat', () => expect(at({ index: 3 })).toBeNull())
    it('stops at the end on repeat one (the audio element loops that itself)', () => expect(at({ index: 3, repeat: 'one' })).toBeNull())
    it('wraps to the top on repeat all', () => expect(at({ index: 3, repeat: 'all' })).toEqual({ kind: 'linear', idx: 0 }))
    it('an empty queue has nowhere to go', () => expect(at({ queueLength: 0, index: 0 })).toBeNull())
})

describe('decideAdvance, shuffle on', () => {
    const shuffle = { shuffle: true, shuffleOrder: [1, 3, 0, 2], shufflePos: 0 }
    it('follows the shuffle order', () => expect(at(shuffle)).toEqual({ kind: 'shuffle', idx: 3, shufflePos: 1 }))
    it('ends with the order, without repeat', () => expect(at({ ...shuffle, shufflePos: 3, index: 2 })).toBeNull())
    it('starts a new lap on repeat all, never on the song that just ended', () => {
        const spent = { ...shuffle, shufflePos: 3, index: 2, repeat: 'all' as const }
        expect(at({ ...spent, random: () => 0 })).toEqual({ kind: 'newLap', idx: 0 })
        expect(at({ ...spent, random: () => 0.99 })).toEqual({ kind: 'newLap', idx: 3 })
        for (const r of [0, 0.3, 0.6, 0.99]) {
            expect((at({ ...spent, random: () => r }) as { idx: number }).idx).not.toBe(2)
        }
    })
    it('a one-song queue on repeat all replays that song', () => {
        expect(at({ shuffle: true, shuffleOrder: [0], shufflePos: 0, queueLength: 1, index: 0, repeat: 'all' }))
            .toEqual({ kind: 'newLap', idx: 0 })
    })
    it('a song queued next goes first, and the shuffle position moves to it', () => {
        expect(at({ ...shuffle, manualNextCount: 1 })).toEqual({ kind: 'manual', idx: 2, shufflePos: 3 })
    })
    it('a manual next past the end of the queue ends it', () => {
        expect(at({ ...shuffle, manualNextCount: 1, index: 3 })).toBeNull()
    })
    it('a manual next whose index is missing from the order keeps the position', () => {
        expect(at({ shuffle: true, shuffleOrder: [], manualNextCount: 1 })).toEqual({ kind: 'manual', idx: 2, shufflePos: null })
    })
})
