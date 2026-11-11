// This device's own copy of the player is trusted over the server's at a failed
// launch, so it is read back only when it has the shape a restore needs.
import { readLocalPlayerState } from '../app/lib/data'

beforeEach(() => localStorage.clear())

describe('readLocalPlayerState', () => {
    it('returns a saved copy', () => {
        localStorage.setItem('playerState', JSON.stringify({ queue: ['a', 'b'], queue_index: 1, saved_at: '2026-01-01T00:00:00Z' }))
        expect(readLocalPlayerState()).toMatchObject({ queue: ['a', 'b'], queue_index: 1 })
    })

    it('returns nothing when there is no copy', () => {
        expect(readLocalPlayerState()).toBeUndefined()
    })

    it.each([
        ['text that is not JSON', '{"queue": ['],
        ['a copy with no queue', JSON.stringify({ shuffle: false })],
        ['a queue that is not a list', JSON.stringify({ queue: 'a,b' })],
        ['null', 'null'],
        ['a number', '7'],
    ])('returns nothing for %s', (_name, raw) => {
        localStorage.setItem('playerState', raw)
        expect(readLocalPlayerState()).toBeUndefined()
    })
})
