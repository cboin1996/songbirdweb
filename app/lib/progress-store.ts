// Where the player keeps playback position for the bar and the time labels.
// Kept outside React state on purpose: an audio element fires timeupdate about
// four times a second, and as player state that re-rendered the provider and
// everything under it every time. Here, only the components that subscribe
// re-render, and only when the whole second changes (or on a seek).

export type Progress = { time: number; duration: number; buffered: number }
type Listener = () => void

export function createProgressStore() {
    let snapshot: Progress = { time: 0, duration: 0, buffered: 0 }
    const listeners = new Set<Listener>()

    function emit() { listeners.forEach(l => l()) }

    return {
        get: () => snapshot,
        subscribe(listener: Listener) {
            listeners.add(listener)
            return () => { listeners.delete(listener) }
        },
        /** `force` for anything the user did (seek): it passes inside the same second. */
        update(next: Partial<Progress>, opts: { force?: boolean } = {}) {
            const merged = { ...snapshot, ...next }
            const moved = opts.force
                || !Object.is(merged.duration, snapshot.duration)
                || !Object.is(Math.floor(merged.time), Math.floor(snapshot.time))
                || !Object.is(Math.floor(merged.buffered), Math.floor(snapshot.buffered))
            if (!moved) return
            snapshot = merged
            emit()
        },
        reset() {
            snapshot = { time: 0, duration: 0, buffered: 0 }
            emit()
        },
    }
}

export type ProgressStore = ReturnType<typeof createProgressStore>
