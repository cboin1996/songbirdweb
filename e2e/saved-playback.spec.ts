import { routes } from './routes'
import { test, expect } from './fixtures/test'
import { login } from './helpers'
import { BENCH_USER, BENCH_PASS } from './seed-bench'
import { LibraryPage, PlayerBar } from './pages'
import { skipWithoutBench } from './bench-gate'

// A song saved on the device plays from its file and does not wait on, or need,
// the token refresh: the device is asked first, the token only for a stream.
skipWithoutBench()
test.use({ storageState: { cookies: [], origins: [] } })

test('a saved song starts on a track change with the token refresh blocked', async ({ page }) => {
    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    await login(page, BENCH_USER, BENCH_PASS)
    await page.goto(routes.library)
    await lib.waitForSongs()

    // Save the first two songs in the list on the device.
    for (let i = 0; i < 2; i++) {
        const card = lib.songCards.nth(i)
        await lib.kebab(card).click()
        await lib.kebabMenu().getByText('Save offline').click()
        await expect(lib.kebabMenu()).toHaveCount(0)
        await expect(page.getByTestId('toast-error')).toHaveCount(0)
        await page.waitForTimeout(1500)
    }

    // Play from the first; once playing, every later load is an advance (not a gesture).
    await lib.playAllBtn.click()
    await player.waitForBar()
    await expect.poll(() => player.getProgressSeconds(), { timeout: 15000 }).toBeGreaterThan(1)
    const firstTrack = await player.getTrackName()

    // From here the refresh endpoint never answers.
    let refreshAsked = 0
    await page.route('**/v1/auth/refresh', () => { refreshAsked++ /* held: never fulfilled */ })
    // The token counts as stale, so any path that waits on a refresh would hang here.
    await page.evaluate(() => { (window as unknown as Record<string, unknown>).__tokenRefreshStaleMs = 0 })
    await page.evaluate(() => { document.querySelector('audio')!.currentTime = 0 })

    await player.next.click()
    await expect.poll(() => player.getTrackName(), { timeout: 5000 }).not.toBe(firstTrack)
    await expect.poll(() => player.getProgressSeconds(), { timeout: 8000 }).toBeGreaterThan(0)
    const playing = await page.evaluate(() => { const a = document.querySelector('audio')!; return !a.paused && a.currentTime > 0 })
    expect(playing).toBe(true)
    expect(refreshAsked).toBe(0)
})
