// Where components read the player's state: the current song, whether it plays,
// the queue and the modes. A React context that held these handed every consumer
// a new value on each track change, play, pause and toast, so all 1000 library
// rows re-rendered. Read through a selector instead, a row re-renders only when
// its own answer changes. The actions (play, pause and the rest) never change and
// live in their own context.
import type { PlayableSong } from './data'

export type RepeatMode = 'off' | 'one' | 'all'
export type PlayContext = { label: string; href: string; id: string }

export type PlayerSnapshot = {
    current: PlayableSong | null
    isPlaying: boolean
    queue: PlayableSong[]
    shuffle: boolean
    repeat: RepeatMode
    playContext: PlayContext | null
}

type Listener = () => void

export function createPlayerStore() {
    let snapshot: PlayerSnapshot = {
        current: null, isPlaying: false, queue: [], shuffle: false, repeat: 'all', playContext: null,
    }
    const listeners = new Set<Listener>()

    return {
        get: () => snapshot,
        subscribe(listener: Listener) {
            listeners.add(listener)
            return () => { listeners.delete(listener) }
        },
        /** A new snapshot, and a word to subscribers, only when a field changed (by identity). */
        set(next: Partial<PlayerSnapshot>) {
            const changed = (Object.keys(next) as (keyof PlayerSnapshot)[])
                .some(k => !Object.is(next[k], snapshot[k]))
            if (!changed) return
            snapshot = { ...snapshot, ...next }
            listeners.forEach(l => l())
        },
    }
}

export type PlayerStore = ReturnType<typeof createPlayerStore>

export function isCurrentSelector(songId: string | undefined) {
    return (s: PlayerSnapshot) => !!songId && s.current?.uuid === songId
}
