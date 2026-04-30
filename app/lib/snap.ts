type Obstacle = { id?: string; start: number; end: number }

function sortByProximity<T extends { start: number; end: number }>(
    obs: T[], center: number,
): T[] {
    return [...obs].sort(
        (a, b) =>
            Math.abs((a.start + a.end) / 2 - center) -
            Math.abs((b.start + b.end) / 2 - center),
    )
}

// Returns the start position if the region [s, s+size] fits within trim, else null.
function tryPlace(s: number, size: number, trimStart: number, trimEnd: number): number | null {
    if (s >= trimStart && s + size <= trimEnd) return s
    return null
}

/**
 * Snap a region within [trimStart, trimEnd], pushing it away from obstacles.
 *
 * preserveSize=false (resize): clamp edges independently — size may shrink.
 * preserveSize=true  (drag):   treat the region as a rigid block; slide it to avoid
 *                               collisions without compressing. When the preferred side
 *                               of an obstacle has no room, try the opposite side.
 */
export function snap(
    rawStart: number,
    rawEnd: number,
    obstacles: Obstacle[],
    id: string | undefined,
    trimStart: number,
    trimEnd: number,
    preserveSize = false,
    origSize?: number,
): { start: number; end: number } {
    const others = obstacles.filter(o => o.id !== id)
    // When preserving size and the caller knows the pre-drag size (avoids using
    // the wall-clipped size that WaveSurfer may have already applied)
    const size = (preserveSize && origSize !== undefined) ? origSize : rawEnd - rawStart
    const rawCenter = (rawStart + rawEnd) / 2

    if (!preserveSize) {
        let s = Math.max(trimStart, rawStart)
        let e = Math.min(trimEnd, rawEnd)
        for (const obs of sortByProximity(others, rawCenter)) {
            if (s >= obs.end || e <= obs.start) continue
            if (rawCenter <= (obs.start + obs.end) / 2) e = obs.start
            else s = obs.end
        }
        return { start: Math.max(trimStart, s), end: Math.min(trimEnd, e) }
    }

    // drag: rigid slide
    // Slide within trim (no compression)
    let s = Math.max(trimStart, Math.min(trimEnd - size, rawStart))
    let e = s + size
    // If region is larger than trim, clamp without size guarantee
    if (e > trimEnd) e = trimEnd
    if (s < trimStart) s = trimStart

    for (const obs of sortByProximity(others, rawCenter)) {
        if (s >= obs.end || e <= obs.start) continue
        const preferRight = rawCenter > (obs.start + obs.end) / 2

        // Try preferred side first, then opposite
        const a = preferRight
            ? tryPlace(obs.end, size, trimStart, trimEnd)
            : tryPlace(obs.start - size, size, trimStart, trimEnd)
        const b = preferRight
            ? tryPlace(obs.start - size, size, trimStart, trimEnd)
            : tryPlace(obs.end, size, trimStart, trimEnd)

        if (a !== null) { s = a; e = a + size }
        else if (b !== null) { s = b; e = b + size }
        // If neither side fits, leave region where it is (no compression)
    }

    return { start: s, end: e }
}
