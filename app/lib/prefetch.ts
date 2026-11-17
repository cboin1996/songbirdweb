// The next queue entry's audio, fetched ahead into one in-memory slot.
//
// It is a held download, not a saved song: nothing here touches the offline store, so
// the song never counts as saved, and the slot holds at most one blob, released when the
// song plays or the queue stops pointing at it.

import type { RepeatMode } from './player-store'

export interface NextInput {
    uuids: string[]
    index: number
    shuffle: boolean
    shuffleOrder: number[]
    shufflePos: number
    repeat: RepeatMode
    // Songs queued "play next" by hand; they go first under shuffle.
    manualNextCount: number
}

/**
 * The uuid the player will advance to, without moving anything. Null when the queue ends,
 * or when the answer is a coin toss (a new shuffle lap picks its song at random).
 */
export function peekNextUuid(i: NextInput): string | null {
    const { uuids, index } = i
    if (uuids.length === 0 || index < 0) return null
    if (i.shuffle) {
        if (i.manualNextCount > 0) return index + 1 < uuids.length ? uuids[index + 1] : null
        const pos = i.shufflePos + 1
        if (pos < i.shuffleOrder.length) return uuids[i.shuffleOrder[pos]] ?? null
        return null
    }
    if (index + 1 < uuids.length) return uuids[index + 1]
    return i.repeat === 'all' && uuids.length > 1 ? uuids[0] : null
}

export function createPrefetchSlot() {
    let held: { uuid: string; blob: Blob } | null = null
    return {
        holds(uuid: string) { return held?.uuid === uuid },
        hold(uuid: string, blob: Blob) { held = { uuid, blob } },
        // Hands the blob over and empties the slot, if it holds this song.
        take(uuid: string): Blob | null {
            if (!held || held.uuid !== uuid) return null
            const blob = held.blob
            held = null
            return blob
        },
        // Empties the slot unless it holds `keep`.
        release(keep?: string | null) {
            if (held && held.uuid !== keep) held = null
        },
    }
}
