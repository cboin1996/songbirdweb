import { isValidShuffleOrder } from '../app/lib/shuffle-order'

// The queue panel indexes the queue with each entry of the shuffle order, so an
// order that is not a permutation of 0..length-1 — a stale index, a duplicate —
// takes the panel down on open.
describe('isValidShuffleOrder', () => {
    it('accepts a permutation of the queue indices', () => {
        expect(isValidShuffleOrder([1, 3, 2, 0, 4, 5, 6], 7)).toBe(true)
        expect(isValidShuffleOrder([0], 1)).toBe(true)
        expect(isValidShuffleOrder([], 0)).toBe(true)
    })

    it.each([
        ['an index past the end', [1, 3, 2, 0, 4, 5, 7], 7],
        ['a duplicate', [0, 1, 1, 3], 4],
        ['a negative index', [0, 1, -1], 3],
        ['a fractional index', [0, 1.5, 2], 3],
        ['too short', [0, 1], 3],
        ['too long', [0, 1, 2, 3], 3],
    ])('rejects %s', (_label, order, length) => {
        expect(isValidShuffleOrder(order, length)).toBe(false)
    })

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['a string', '0,1,2'],
        ['an object', { 0: 0, 1: 1, length: 2 }],
        ['entries that are not numbers', ['0', '1']],
    ])('rejects %s', (_label, value) => {
        expect(isValidShuffleOrder(value, 2)).toBe(false)
    })
})
