// Settings that belong to this device, not the account: kept in this browser's
// storage, never sent to the server.

const FROSTED_KEY = 'songbird-frosted-bars'
const PERF_KEY = 'songbird-perf'
const PERF_SESSION_KEY = 'songbird:perf'

// Phones: the blur costs the most there. Measured on an iPhone with bars on and off: no
// difference in dropped frames or lag, so the default stays on (today's look).
export const PHONE_FROSTED_DEFAULT = true

export interface FrostedContext {
    desktop: boolean
    reduceTransparency: boolean
}

/** The default when the user has not chosen: off when the system asks for less transparency. */
export function defaultFrostedBars(ctx: FrostedContext): boolean {
    if (ctx.reduceTransparency) return false
    return ctx.desktop ? true : PHONE_FROSTED_DEFAULT
}

function readStored(): 'on' | 'off' | null {
    try {
        const v = localStorage.getItem(FROSTED_KEY)
        return v === 'on' || v === 'off' ? v : null
    } catch { return null }
}

function currentContext(): FrostedContext {
    const media = (q: string) => { try { return window.matchMedia(q).matches } catch { return false } }
    return { desktop: media('(min-width: 768px)'), reduceTransparency: media('(prefers-reduced-transparency: reduce)') }
}

/** The stored choice if there is one, otherwise the default for this device. */
export function getFrostedBars(): boolean {
    const stored = readStored()
    if (stored) return stored === 'on'
    return defaultFrostedBars(currentContext())
}

export function setFrostedBars(on: boolean): void {
    try { localStorage.setItem(FROSTED_KEY, on ? 'on' : 'off') } catch { /* applied for this page only */ }
    applyFrostedBars(on)
}

/** The css hook: the bars read `data-frosted` on the root element. */
export function applyFrostedBars(on: boolean = getFrostedBars()): void {
    document.documentElement.dataset.frosted = on ? 'on' : 'off'
}

/** Whether this device asked for the performance overlay (it is read once, when a page loads). */
export function getPerfOverlay(): boolean {
    try { return localStorage.getItem(PERF_KEY) === '1' } catch { return false }
}

/** Remembers the choice. Turning it off also drops the session flag a `?perf=1` visit leaves. */
export function setPerfOverlay(on: boolean): void {
    try {
        if (on) localStorage.setItem(PERF_KEY, '1')
        else {
            localStorage.removeItem(PERF_KEY)
            sessionStorage.removeItem(PERF_SESSION_KEY)
        }
    } catch { /* the choice lasts only if storage works */ }
}
