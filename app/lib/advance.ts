// Where the player goes next, as a pure decision. The player applies the answer to its
// refs; keeping the choice here lets every branch be tested without a component.
import type { RepeatMode } from './player-store'

export interface AdvanceInput {
    queueLength: number
    index: number
    shuffle: boolean
    shuffleOrder: number[]
    shufflePos: number
    repeat: RepeatMode
    manualNextCount: number
    /** Returns a number in [0, 1); injected so a test can pin the new-lap pick. */
    random: () => number
}

export type Advance =
    /** A song queued "play next" by hand: take it, and move the shuffle position to where it sits. */
    | { kind: 'manual'; idx: number; shufflePos: number | null }
    /** The next entry of the shuffle order. */
    | { kind: 'shuffle'; idx: number; shufflePos: number }
    /** The shuffle order is spent and repeat is on: start a fresh lap on a different song. */
    | { kind: 'newLap'; idx: number }
    /** The next queue entry with shuffle off, or the wrap to the top under repeat all. */
    | { kind: 'linear'; idx: number }

/** Null when the queue ends. */
export function decideAdvance(i: AdvanceInput): Advance | null {
    const { queueLength, index } = i
    if (i.shuffle) {
        if (i.manualNextCount > 0) {
            const idx = index + 1
            if (idx >= queueLength) return null
            const pos = i.shuffleOrder.indexOf(idx)
            return { kind: 'manual', idx, shufflePos: pos >= 0 ? pos : null }
        }
        const pos = i.shufflePos + 1
        if (pos >= i.shuffleOrder.length) {
            if (i.repeat !== 'all') return null
            // Pinning the song that just ended would replay it back to back, so pick another.
            const others: number[] = []
            for (let n = 0; n < queueLength; n++) if (n !== index) others.push(n)
            const idx = others.length > 0 ? others[Math.floor(i.random() * others.length)] : index
            return { kind: 'newLap', idx }
        }
        return { kind: 'shuffle', idx: i.shuffleOrder[pos], shufflePos: pos }
    }
    const idx = index + 1
    if (idx >= queueLength) return i.repeat === 'all' ? { kind: 'linear', idx: 0 } : null
    return { kind: 'linear', idx }
}
