import { test, expect, Page } from './fixtures/test'
import { PLAYER_USERNAME, PLAYER_PASSWORD, login } from './helpers'
import { LibraryPage, PlayerBar } from './pages'
import { classifyRequest } from '../app/lib/perf-stats'

// How often the player talks to the API while it plays: position saves, the
// play count. Counted from the requests the page sends.

test.use({ authUser: 'player-user' })
test.setTimeout(90_000)

function count(page: Page) {
    const seen = { position: 0, play: 0 }
    page.on('request', r => {
        const kind = classifyRequest(r.url())
        if (kind === 'position' && r.method() === 'PATCH') seen.position++
        if (kind === 'play' && r.method() === 'POST') seen.play++
    })
    return seen
}

async function startPlayback(page: Page) {
    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    await login(page, PLAYER_USERNAME, PLAYER_PASSWORD)
    await lib.goto()
    await lib.songCards.first().click()
    await player.waitForBar()
    await expect.poll(() => player.getProgressSeconds(), { timeout: 15000 }).toBeGreaterThan(1)
    return player
}

test('pausing saves the position once, and playing saves again every 10 s', async ({ page }) => {
    const seen = count(page)
    const player = await startPlayback(page)
    const before = seen.position
    await page.waitForTimeout(10_500)
    expect(seen.position - before).toBe(1)

    const beforePause = seen.position
    await player.playPause.click()
    await page.waitForTimeout(1500)
    expect(seen.position - beforePause).toBe(1)

    // Paused: nothing more goes out.
    const paused = seen.position
    await page.waitForTimeout(11_000)
    expect(seen.position).toBe(paused)
})

test('no position saves while the browser is offline', async ({ page, context }) => {
    const seen = count(page)
    await startPlayback(page)
    await context.setOffline(true)
    await page.waitForTimeout(500)
    const before = seen.position
    await page.waitForTimeout(11_000)
    expect(seen.position).toBe(before)
    await context.setOffline(false)
})

test('pausing and resuming past 30 s of listening records one play', async ({ page }) => {
    const seen = count(page)
    const player = await startPlayback(page)
    await page.waitForTimeout(15_000)
    await player.playPause.click()
    await page.waitForTimeout(2000)
    await player.playPause.click()
    await page.waitForTimeout(17_000)
    await player.playPause.click()
    await page.waitForTimeout(2000)
    await player.playPause.click()
    await page.waitForTimeout(3000)
    expect(seen.play).toBe(1)
})
