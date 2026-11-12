import { routes } from './routes'
import { test, expect } from './fixtures/test'
import { login } from './helpers'
import { BENCH_USER, BENCH_PASS } from './seed-bench'
import { LibraryPage, PlayerBar } from './pages'
import { skipWithoutBench } from './bench-gate'

// The ?perf=1 overlay and the render counter behind it. They read the bench
// user's 1000-song library, so they only run where that is seeded.
skipWithoutBench()

type PerfWindow = { __songbirdPerf?: { counts: Record<string, number> } }
const counts = (page: import('@playwright/test').Page) =>
    page.evaluate(() => (window as unknown as PerfWindow).__songbirdPerf?.counts)

test.describe('perf overlay', () => {
    test.use({ storageState: { cookies: [], origins: [] } })

    test.beforeEach(async ({ page }) => {
        await login(page, BENCH_USER, BENCH_PASS)
    })

    test('nothing shows or runs without the flag', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()
        await expect(page.getByTestId('perf-overlay')).toHaveCount(0)
        expect(await counts(page)).toBeUndefined()
    })

    test('?perf=1 shows the panel with the base lines', async ({ page }) => {
        await page.goto(`${routes.library}?perf=1`)
        await expect(page.getByTestId('perf-overlay')).toBeVisible()
        for (const line of ['renders', 'api', 'bytes', 'frames', 'lag', 'taps', 'load', 'audio']) {
            await expect(page.getByTestId(`perf-line-${line}`)).toBeVisible()
        }
    })

    test('the flag lasts for the session across in-app navigation', async ({ page }) => {
        await page.goto(`${routes.library}?perf=1`)
        await expect(page.getByTestId('perf-overlay')).toBeVisible()
        await page.getByRole('link', { name: /explore/i }).first().click()
        await expect(page).toHaveURL(/explore/)
        await expect(page.getByTestId('perf-overlay')).toBeVisible()
    })

    test('the render counter counts library rows and the player, and reset zeroes it', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await page.goto(`${routes.library}?perf=1`)
        await lib.waitForSongs()
        await lib.playAllBtn.click()
        await player.waitForTrackName()

        await expect.poll(async () => (await counts(page))?.row ?? 0).toBeGreaterThan(0)
        await expect.poll(async () => (await counts(page))?.player ?? 0).toBeGreaterThan(0)
        await expect.poll(async () => (await counts(page))?.list ?? 0).toBeGreaterThan(0)

        // Pause so nothing renders while reset is read back.
        await player.playPause.click()
        const before = (await counts(page))!.row
        await page.getByTestId('perf-reset').click()
        await expect.poll(async () => (await counts(page))!.row).toBeLessThan(before)
    })

    test('the settings switch turns the overlay on for later page loads and off again', async ({ page }) => {
        await page.goto(routes.settings)
        await page.getByTestId('perf-setting-switch').click()
        await expect(page.getByTestId('perf-overlay')).toBeVisible()
        await page.goto(routes.library)
        await expect(page.getByTestId('perf-overlay')).toBeVisible()
        await page.goto(routes.settings)
        await page.getByTestId('perf-setting-switch').click()
        await expect(page.getByTestId('perf-overlay')).toHaveCount(0)
        await page.goto(routes.library)
        await expect(page.getByTestId('perf-overlay')).toHaveCount(0)
    })

    test('copy still works where the clipboard API is missing (plain http on a LAN address)', async ({ page }) => {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
            document.execCommand = () => {
                ;(window as unknown as Record<string, unknown>).__copied = document.querySelector('textarea')?.value
                return true
            }
        })
        await page.goto(`${routes.library}?perf=1`)
        await expect(page.getByTestId('perf-overlay')).toBeVisible()
        await page.getByTestId('perf-copy').click()
        await expect(page.getByTestId('perf-copy')).toHaveText('copied')
        const copied = await page.evaluate(() => (window as unknown as Record<string, string>).__copied)
        expect(copied).toContain('renders/min')
    })

    test('Alt+Shift+P flips the overlay', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()
        await expect(page.getByTestId('perf-overlay')).toHaveCount(0)
        await page.keyboard.press('Alt+Shift+KeyP')
        await expect(page.getByTestId('perf-overlay')).toBeVisible()
        await page.keyboard.press('Alt+Shift+KeyP')
        await expect(page.getByTestId('perf-overlay')).toHaveCount(0)
    })

    test('the test override turns the counter on without the overlay flag', async ({ page }) => {
        await page.addInitScript(() => { (window as unknown as Record<string, unknown>).__SONGBIRD_PERF__ = true })
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()
        await expect.poll(async () => (await counts(page))?.row ?? 0).toBeGreaterThan(0)
    })

    test('Chrome-only lines show where the browser has the API and hide where it does not', async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'long animation frames are a Chromium API')
        await page.goto(`${routes.library}?perf=1`)
        await expect(page.getByTestId('perf-line-longframes')).toBeVisible()
    })

    test('Chrome-only lines are absent when the API is missing', async ({ page }) => {
        await page.addInitScript(() => {
            const types = PerformanceObserver.supportedEntryTypes.filter(t => t !== 'long-animation-frame')
            Object.defineProperty(PerformanceObserver, 'supportedEntryTypes', { value: types })
            delete (window as unknown as Record<string, unknown>).PressureObserver
        })
        await page.goto(`${routes.library}?perf=1`)
        await expect(page.getByTestId('perf-overlay')).toBeVisible()
        await expect(page.getByTestId('perf-line-longframes')).toHaveCount(0)
        await expect(page.getByTestId('perf-line-cpu')).toHaveCount(0)
    })
})
