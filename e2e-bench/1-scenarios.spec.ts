import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { routes } from '../e2e/routes'
import { login } from '../e2e/helpers'
import { BENCH_USER, BENCH_PASS } from '../e2e/seed-bench'
import { LibraryPage, PlayerBar } from '../e2e/pages'
import { Cdp, countsAfter, readCounts, resetCounts, watchRequests } from './measure'
import { skipWithoutBench } from '../e2e/bench-gate'

// Records today's numbers for the front-end performance flow: renders per
// component, requests, bytes, layouts, heap, a seek's response and the cost of a
// keystroke or a letter-rail scrub, all on the 1000-song bench library. Results
// land in bench-results/metrics.json. 2-budgets.spec.ts holds the limits.
//
// Counts, never milliseconds: they don't move with the machine's speed.

const PLAYBACK_WINDOW_MS = 20_000
// Ties the file to this run: the budgets refuse a file from an earlier one.
const results: Record<string, unknown> = { runStartedAt: Date.now() }

skipWithoutBench()
const QUEUE_WINDOW_MS = 10_000
test.describe.configure({ mode: 'serial' })

let page: Page
let lib: LibraryPage
let player: PlayerBar

test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    page = await context.newPage()
    await page.addInitScript(() => { (window as unknown as Record<string, unknown>).__SONGBIRD_PERF__ = true })
    await login(page, BENCH_USER, BENCH_PASS)
    lib = new LibraryPage(page)
    player = new PlayerBar(page)
})

test.afterAll(async () => {
    const dir = path.resolve(__dirname, '../bench-results')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'metrics.json'), JSON.stringify(results, null, 2))
    console.log(`BENCH_METRICS ${JSON.stringify(results)}`)
    await page.context().close()
})

test('cold library load', async () => {
    const requests = watchRequests(page)
    await page.goto(routes.library)
    await lib.waitForSongs()
    await page.waitForTimeout(3000)
    const libraryRequests = requests.to('/v1/songs/library', 0).length
    const all = requests.since(0)
    results.coldLoad = { libraryRequests, apiRequests: all.total, byKind: all.byKind }
    expect(libraryRequests).toBeGreaterThan(0)
})

test('playback window', async () => {
    await lib.playAllBtn.click()
    await player.waitForTrackName()
    await expect.poll(() => player.getProgressSeconds(), { timeout: 15000 }).toBeGreaterThan(1)

    const requests = watchRequests(page)
    const cdp = await Cdp.attach(page)
    const startMetrics = await cdp.metrics()
    await resetCounts(page)
    await page.waitForTimeout(PLAYBACK_WINDOW_MS)
    const endMetrics = await cdp.metrics()
    const counts = await readCounts(page)
    const asked = requests.since(0)

    const delta = (name: string) => (endMetrics[name] ?? 0) - (startMetrics[name] ?? 0)
    results.playback = {
        windowSeconds: PLAYBACK_WINDOW_MS / 1000,
        counts,
        requests: asked.byKind,
        requestTotal: asked.total,
        requestBytes: asked.bytes,
        layouts: delta('LayoutCount'),
        styleRecalcs: delta('RecalcStyleCount'),
        heapUsedBytes: endMetrics.JSHeapUsedSize,
        heapGrowthBytes: delta('JSHeapUsedSize'),
    }
})

test('track change', async () => {
    const before = await player.getTrackName()
    // Every range the audio was asked for. A second request that starts late in the file is
    // the browser reading the tail to learn a track's length; only requests that start at
    // the beginning are the app asking for the song again.
    const ranges: string[] = []
    const onRequest = (r: { url(): string; headers(): Record<string, string> }) => {
        if (r.url().includes('/v1/download/')) ranges.push(r.headers()['range'] ?? '')
    }
    page.on('request', onRequest)
    const counts = await countsAfter(page, async () => { await player.next.click() })
    await expect.poll(() => player.getTrackName()).not.toBe(before)
    page.off('request', onRequest)
    results.trackChange = counts
    results.trackChangeAudioRanges = ranges
    results.trackChangeAudioRequests = ranges.filter(r => r === '' || /^bytes=0-/.test(r)).length
})

test('play and pause', async () => {
    const pause = await countsAfter(page, async () => { await player.playPause.click() })
    const resume = await countsAfter(page, async () => { await player.playPause.click() })
    results.playPause = { pause, resume }
})

test('a toast', async () => {
    // A 500 gives a failure toast. Aborting the request would read as a lost
    // connection and flip the app offline, which changes what the next test does.
    await page.route('**/v1/share/songs/*', route => route.fulfill({ status: 500, body: 'fail' }))
    const card = lib.songCards.first()
    await card.scrollIntoViewIfNeeded()
    await lib.kebab(card).click()
    const counts = await countsAfter(page, async () => { await page.getByText('Copy share link').click() })
    await expect(page.getByTestId('toast-error')).toBeVisible()
    results.toast = counts
    await page.unroute('**/v1/share/songs/*')
    // Close the kebab menu so it doesn't swallow the next click.
    // The menu sits on a full-screen backdrop; a click anywhere closes it.
    if (await lib.kebabMenu().count()) await page.mouse.click(5, 300)
    await expect(lib.kebabMenu()).toHaveCount(0)
})

test('a seek', async () => {
    type Seen = { status: number; range: string | null; contentRange: string | null; contentLength: string | null; acceptRanges: string | null }
    const seen: Seen[] = []
    page.on('response', r => {
        if (!r.url().includes('/v1/download/')) return
        const h = r.headers()
        seen.push({
            status: r.status(),
            range: r.request().headers()['range'] ?? null,
            contentRange: h['content-range'] ?? null,
            contentLength: h['content-length'] ?? null,
            acceptRanges: h['accept-ranges'] ?? null,
        })
    })

    // Seek to 90% the moment the next track's metadata is known, before the bulk
    // of the file can have arrived, so the seek has to ask for data it lacks.
    await page.evaluate(() => {
        const audio = document.querySelector('audio')!
        audio.addEventListener('loadedmetadata', () => {
            if (Number.isFinite(audio.duration)) audio.currentTime = audio.duration * 0.9
        }, { once: true })
    })
    const mark = seen.length
    const before = await player.getTrackName()
    await player.next.click()
    await expect.poll(() => player.getTrackName()).not.toBe(before)
    await page.waitForTimeout(6000)
    // Where the player ended up, so a surprising request offset can be read against it.
    const played = await page.evaluate(() => {
        const a = document.querySelector('audio')!
        return { currentTime: a.currentTime, duration: a.duration }
    })
    results.seek = { all: seen.slice(mark), played }
})

test('search keystrokes', async () => {
    await lib.searchInput.click()
    const perKey: Record<string, number>[] = []
    for (const ch of 'aeio') {
        perKey.push(await countsAfter(page, async () => { await page.keyboard.type(ch) }, 1200))
    }
    results.searchKeystrokes = perKey
    await lib.searchInput.fill('')
})

test('letter rail scrub', async () => {
    await page.waitForTimeout(1000)
    const rail = lib.letterRail
    if (!(await rail.isVisible())) { results.letterRailScrub = null; return }
    const box = (await rail.boundingBox())!
    const x = box.x + box.width / 2
    const counts = await countsAfter(page, async () => {
        await page.mouse.move(x, box.y + 4)
        await page.mouse.down()
        for (let i = 1; i <= 12; i++) await page.mouse.move(x, box.y + (box.height * i) / 13)
        await page.mouse.up()
    })
    results.letterRailScrub = counts
})

test('playback window with the queue open', async () => {
    await player.queueToggle.click()
    await expect(player.queuePanel).toBeVisible()
    // Start the window early in the song: a track ending inside it would count as renders.
    await page.evaluate(() => { document.querySelector('audio')!.currentTime = 1 })
    await page.waitForTimeout(1500)
    await resetCounts(page)
    await page.waitForTimeout(QUEUE_WINDOW_MS)
    const counts = await readCounts(page)
    results.queueOpen = { windowSeconds: QUEUE_WINDOW_MS / 1000, counts }
    await player.queueToggle.click()
    await expect(player.queuePanel).toBeHidden()
})
