import { routes } from './routes'
import { test, expect, Page } from '@playwright/test'
import { USERNAME, PASSWORD, login, ignoreError } from './helpers'


async function startPlayback(page: Page) {
    await page.goto(routes.library)
    const card = page.getByTestId('song-card').first()
    await expect(card).toBeVisible({ timeout: 10000 })
    await card.click()
    await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
}

test.describe('player bar', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('player bar appears after clicking a song', async ({ page }) => {
        await page.goto(routes.library)
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
    })

    test('player shows track name of clicked song', async ({ page }) => {
        await page.goto(routes.library)
        // pick the first card that has a non-empty track name displayed
        const card = page.getByTestId('song-card').filter({ hasText: /\w/ }).first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
        // wait for track name to populate (may be async)
        await expect(page.getByTestId('player-track-name').first()).not.toBeEmpty({ timeout: 5000 })
    })

    test('play/pause button toggles playback', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await startPlayback(page)
        const btn = page.getByTestId('player-play-pause')
        await expect(btn).toBeVisible()

        // click to pause
        await btn.click()
        await page.waitForTimeout(400)
        // click to resume
        await btn.click()
        await page.waitForTimeout(400)

        expect(errors).toHaveLength(0)
    })

    test('shuffle button toggles active class', async ({ page }) => {
        await startPlayback(page)
        // Player has compact + full bars in the DOM (one hidden via CSS at desktop/mobile breakpoint).
        const btn = page.getByTestId('player-shuffle').filter({ visible: true }).first()
        await expect(btn).toBeVisible()

        const before = await btn.getAttribute('class')
        await btn.click()
        await page.waitForTimeout(200)
        const after = await btn.getAttribute('class')
        expect(after).not.toEqual(before)

        // toggle back off
        await btn.click()
    })

    // Toggling shuffle off and back on must NOT reshuffle the queue —
    // the same seed/order is preserved so users don't repeat songs they've heard.
    test('shuffle toggle off+on preserves shuffle order (no reshuffle)', async ({ page }) => {
        await startPlayback(page)
        const btn = page.getByTestId('player-shuffle').filter({ visible: true }).first()
        await expect(btn).toBeVisible()

        // Ensure shuffle is ON. If currently off, click once.
        const cls0 = await btn.getAttribute('class') ?? ''
        if (!cls0.includes('text-sky-500')) await btn.click()
        await page.waitForTimeout(300)

        // Capture the saved shuffle_seed (server-side state via API once it saves).
        // Easier: read it from localStorage where the player mirrors state.
        const seedBefore = await page.evaluate(() => {
            try {
                const raw = localStorage.getItem('playerState')
                if (!raw) return null
                return (JSON.parse(raw) as { shuffle_seed?: number | null }).shuffle_seed ?? null
            } catch { return null }
        })
        expect(seedBefore, 'shuffle_seed should exist while shuffle is on').not.toBeNull()

        // Toggle OFF
        await btn.click()
        await page.waitForTimeout(300)
        // Toggle ON
        await btn.click()
        await page.waitForTimeout(300)

        const seedAfter = await page.evaluate(() => {
            try {
                const raw = localStorage.getItem('playerState')
                if (!raw) return null
                return (JSON.parse(raw) as { shuffle_seed?: number | null }).shuffle_seed ?? null
            } catch { return null }
        })
        expect(seedAfter, 'shuffle_seed must be unchanged after off→on toggle').toBe(seedBefore)
    })

    test('repeat cycles off → one → all → off', async ({ page }) => {
        await startPlayback(page)
        const btn = page.getByTestId('player-repeat').filter({ visible: true }).first()
        await expect(btn).toBeVisible()

        // Reset to 'off' state (player persists last state, initial is 'all')
        for (let i = 0; i < 3; i++) {
            const cls = await btn.getAttribute('class') ?? ''
            if (cls.includes('text-gray-400')) break
            await btn.click()
            await page.waitForTimeout(100)
        }

        // off → one (shows "1" superscript)
        await btn.click()
        await expect(btn).toHaveClass(/text-sky-500/, { timeout: 2000 })
        await expect(btn.locator('span')).toBeVisible({ timeout: 2000 })

        // one → all (superscript disappears)
        await btn.click()
        await expect(btn).toHaveClass(/text-sky-500/, { timeout: 2000 })
        await expect(btn.locator('span')).toHaveCount(0)

        // all → off
        await btn.click()
        await expect(btn).toHaveClass(/text-gray-400/, { timeout: 2000 })
    })

    test('queue toggle shows and hides queue panel', async ({ page }) => {
        await startPlayback(page)
        const btn = page.getByTestId('player-queue-toggle')
        await expect(btn).toBeVisible()

        // open queue
        await btn.click()
        await expect(btn).toHaveClass(/text-sky-500/, { timeout: 2000 })
        // panel may be present if queue has songs
        await page.waitForTimeout(200)

        // close queue
        await btn.click()
        await expect(btn).toHaveClass(/text-gray-400/, { timeout: 2000 })
    })

    test('progress bar click seeks without error', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await startPlayback(page)
        await page.waitForTimeout(500)

        const progressBar = page.getByTestId('player-progress')
        await expect(progressBar).toBeVisible({ timeout: 5000 })

        const box = await progressBar.boundingBox()
        if (box) {
            await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
        }
        await page.waitForTimeout(300)
        expect(errors).toHaveLength(0)
    })

    test('timestamps render in M:SS format', async ({ page }) => {
        await startPlayback(page)
        await page.waitForTimeout(500)

        const progress = page.getByTestId('player-progress')
        await expect(progress).toBeVisible({ timeout: 5000 })
        const text = await progress.textContent()
        expect(text).toMatch(/\d+:\d{2}/)
    })

    test('player shows "from Library" context link', async ({ page }) => {
        await page.goto(routes.library)
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await expect(page.getByText(/from Library/i)).toBeVisible({ timeout: 5000 })
    })

    test('no console errors during playback', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error' && !ignoreError(msg.text())) errors.push(msg.text()) })
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await startPlayback(page)
        await page.waitForTimeout(2000)

        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })

    // === Tier 2 player position persistence ===

    // Plays a song for ~5s, captures the track name + the m:ss displayed in
    // the progress bar, reloads the page, then asserts the same track resumes
    // and the progress is at least 4s in.
    test('position persists across reload (>=4s into the same track)', async ({ page }) => {
        await startPlayback(page)
        const initialName = await page.getByTestId('player-track-name').first().textContent()
        // Wait for ~5s of playback.
        await page.waitForTimeout(5500)

        await page.reload()

        // Player bar reappears (last-played fallback restores playback state).
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })
        const restoredName = await page.getByTestId('player-track-name').first().textContent()
        expect(restoredName?.trim()).toBe(initialName?.trim())

        // Read the m:ss from progress text and assert >= 4s elapsed.
        const text = await page.getByTestId('player-progress').textContent()
        const match = text?.match(/(\d+):(\d{2})/)
        expect(match, `progress text didn't match m:ss: ${text}`).not.toBeNull()
        const m = parseInt(match![1])
        const s = parseInt(match![2])
        const totalSec = m * 60 + s
        expect(totalSec, `expected >=4s elapsed, got ${totalSec}`).toBeGreaterThanOrEqual(4)
    })

    // === Tier 2 per-song deep-linking (queue_sources) ===

    test('library songs: player link includes ?song=<uuid>', async ({ page }) => {
        await page.goto(routes.library)
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })

        // Get the song UUID from the card's data attribute
        const songId = await card.getAttribute('data-song-id')
        expect(songId).toBeTruthy()

        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })

        // Hover player bar bottom-left to see the context link
        const contextLink = page.getByText(/from library/i)
        await expect(contextLink).toBeVisible({ timeout: 5000 })

        // Check that the link parent contains the song UUID
        const link = contextLink.locator('..')
        const href = await link.locator('a').getAttribute('href')
        expect(href).toContain(`?song=${songId}`)
    })

    test('library genres: player link includes ?view=genres&song=<uuid>', async ({ page }) => {
        await page.goto(routes.libraryGenres)
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })

        const songId = await card.getAttribute('data-song-id')
        expect(songId).toBeTruthy()

        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })

        // The context link should reflect the genres view + song UUID
        const link = page.locator('a[href*="genres"]').first()
        const href = await link.getAttribute('href')
        expect(href).toContain(`genres`)
        expect(href).toContain(`song=${songId}`)
    })

    test('library albums: player link includes ?view=albums&album=<id>', async ({ page }) => {
        await page.goto(routes.libraryAlbums)
        // In albums view, click a song card
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })

        const albumId = await card.getAttribute('data-album-id')
        expect(albumId).toBeTruthy()

        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })

        // Check the context link for album query param (NOT song param)
        const link = page.locator('a[href*="albums"]').first()
        const href = await link.getAttribute('href')
        expect(href).toContain(`albums`)
        expect(href).toContain(`album=${albumId}`)
        expect(href).not.toContain(`song=`) // albums use album param, not song
    })

    test('queue_sources persists across reload (cross-session)', async ({ page }) => {
        // Play a song from library
        await page.goto(routes.library)
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })

        const songId = await card.getAttribute('data-song-id')
        expect(songId).toBeTruthy()

        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })

        // Capture the context link href before reload
        const linkBefore = page.locator('a[href*="library"]').first()
        const hrefBefore = await linkBefore.getAttribute('href')
        expect(hrefBefore).toContain(`song=${songId}`)

        // Reload the page — queue_sources should be restored server-side
        await page.reload()

        // Player bar should still show (persisted via queue_sources)
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })

        // The context link should still have the same song UUID
        const linkAfter = page.locator('a[href*="library"]').first()
        const hrefAfter = await linkAfter.getAttribute('href')
        expect(hrefAfter).toContain(`song=${songId}`)
    })
})
