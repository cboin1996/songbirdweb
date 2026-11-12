// Polling that cannot pile up. Each request starts one interval after the last
// one finished (setInterval started the next regardless), and nothing is sent
// while `canRun` says no, which callers use for a hidden page or no network.

export function startPoller(opts: {
    run: () => Promise<unknown>
    intervalMs: number
    canRun?: () => boolean
}): () => void {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function tick() {
        if (stopped) return
        if (!opts.canRun || opts.canRun()) {
            try { await opts.run() } catch { /* the next tick tries again */ }
        }
        if (!stopped) timer = setTimeout(tick, opts.intervalMs)
    }

    timer = setTimeout(tick, opts.intervalMs)
    return () => {
        stopped = true
        if (timer !== undefined) clearTimeout(timer)
    }
}

/** True when a poll should go out: page in view and the browser online. */
export function pageActive(): boolean {
    if (typeof document === 'undefined') return true
    return document.visibilityState !== 'hidden' && navigator.onLine
}
