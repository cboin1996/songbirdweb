// Adds up how long a song has actually been playing since it was loaded, across
// pauses, so a play is recorded once after the threshold rather than again each
// time the song is resumed.
export function createListenClock(now: () => number = Date.now) {
    let listened = 0
    let startedAt: number | null = null
    return {
        start() { if (startedAt === null) startedAt = now() },
        stop() {
            if (startedAt !== null) { listened += now() - startedAt; startedAt = null }
        },
        reset() { listened = 0; startedAt = null },
        remainingMs(thresholdMs: number) {
            const total = listened + (startedAt !== null ? now() - startedAt : 0)
            return Math.max(0, thresholdMs - total)
        },
    }
}
