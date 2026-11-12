import { type Page, type CDPSession } from '@playwright/test'
import { classifyRequest, type RequestKind } from '../app/lib/perf-stats'

// Helpers that read the numbers the benchmark records: render counts from the
// app's own counter, requests from the network, layout and heap from the browser.

type PerfWindow = { __songbirdPerf?: { counts: Record<string, number> } }

export async function readCounts(page: Page): Promise<Record<string, number>> {
    return page.evaluate(() => ({ ...((window as unknown as PerfWindow).__songbirdPerf?.counts ?? {}) }))
}

export async function resetCounts(page: Page): Promise<void> {
    await page.evaluate(() => {
        const counts = (window as unknown as PerfWindow).__songbirdPerf?.counts
        if (counts) for (const key of Object.keys(counts)) counts[key] = 0
    })
}

/** Counts since the last reset, with a settle wait so late renders are included. */
export async function countsAfter(page: Page, act: () => Promise<void>, settleMs = 1500): Promise<Record<string, number>> {
    await resetCounts(page)
    await act()
    await page.waitForTimeout(settleMs)
    return readCounts(page)
}

export type Metrics = Record<string, number>

export class Cdp {
    private constructor(private session: CDPSession) {}
    static async attach(page: Page): Promise<Cdp> {
        const session = await page.context().newCDPSession(page)
        await session.send('Performance.enable')
        return new Cdp(session)
    }
    async metrics(): Promise<Metrics> {
        const { metrics } = await this.session.send('Performance.getMetrics')
        return Object.fromEntries(metrics.map(m => [m.name, m.value]))
    }
}

export type RequestLog = {
    mark(): number
    since(mark: number): { total: number; byKind: Record<RequestKind, number>; urls: string[]; bytes: number }
    /** Requests to a path fragment since the mark. */
    to(fragment: string, mark: number): string[]
}

export function watchRequests(page: Page): RequestLog {
    // `bytes` is the declared content-length of the API answers: a size the budget does not
    // gate on, recorded so a payload that grows shows up in the numbers.
    const seen: { url: string; bytes: number }[] = []
    const byRequest = new WeakMap<object, { url: string; bytes: number }>()
    page.on('request', r => { const e = { url: r.url(), bytes: 0 }; seen.push(e); byRequest.set(r, e) })
    page.on('response', res => {
        const e = byRequest.get(res.request())
        if (e) e.bytes = Number(res.headers()['content-length'] ?? 0) || 0
    })
    return {
        mark: () => seen.length,
        since(mark) {
            const entries = seen.slice(mark)
            const byKind: Record<RequestKind, number> = { position: 0, state: 0, play: 0, audio: 0, other: 0 }
            let total = 0
            let bytes = 0
            for (const { url, bytes: b } of entries) {
                const kind = classifyRequest(url)
                if (kind) { byKind[kind]++; total++; bytes += b }
            }
            return { total, byKind, urls: entries.map(e => e.url), bytes }
        },
        to: (fragment, mark) => seen.slice(mark).filter(e => e.url.includes(fragment)).map(e => e.url),
    }
}
