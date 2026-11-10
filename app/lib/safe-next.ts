// The login page's `next` parameter says where to go after signing in. It is
// attacker-controllable, so only a path on our own origin may be followed.
// Parsing with URL, as the browser will, catches the spellings a prefix check
// misses: `/\host` and `/<tab>/host` both normalise to `//host`.
export function safeNext(next: string | null, origin: string): string | null {
    if (!next || !next.startsWith('/')) return null
    try {
        const url = new URL(next, origin)
        if (url.origin !== origin) return null
        return url.pathname + url.search + url.hash
    } catch {
        return null
    }
}
