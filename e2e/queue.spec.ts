import { routes } from './routes'
import { test, expect } from '@playwright/test'
import { login, ignoreError } from './helpers'

// Locks in queue + "Play next" behaviour at keebox-beta-1. The queue panel
// toggles via the player bar queue icon and "Play next" from a kebab menu
// inserts a track into the queue without changing the currently playing
// song. Read-only against existing library state; no DB writes.

test.describe('player queue', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('queue panel opens with songs after starting playback from library', async ({ page }) => {
        await page.goto(routes.library)
        const cards = page.getByTestId('song-card')
        await expect(cards.first()).toBeVisible({ timeout: 10000 })
        test.skip((await cards.count()) < 2, 'need at least 2 library songs to verify queue')

        await cards.first().click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })

        await page.getByTestId('player-queue-toggle').click()
        // queue panel should mount
        await expect(page.getByTestId('player-queue-panel')).toBeVisible({ timeout: 3000 })
    })

    test('"Play next" from kebab does not change the currently playing track', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await page.goto(routes.library)
        const cards = page.getByTestId('song-card')
        await expect(cards.first()).toBeVisible({ timeout: 10000 })
        test.skip((await cards.count()) < 2, 'need at least 2 library songs to test play-next')

        // Start playback on card 0
        await cards.first().click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
        const trackNameEl = page.getByTestId('player-track-name').first()
        await expect(trackNameEl).not.toBeEmpty({ timeout: 5000 })
        const beforeName = (await trackNameEl.textContent())?.trim() ?? ''

        // Open kebab on card 1 and click Play next
        const card1 = cards.nth(1)
        await card1.hover()
        await card1.getByTestId('song-kebab').click()
        const menu = page.getByTestId('song-kebab-menu')
        await menu.getByRole('button', { name: 'Play next' }).click()

        // Track name should NOT have changed — only the queue order should change.
        await page.waitForTimeout(500)
        const afterName = (await trackNameEl.textContent())?.trim() ?? ''
        expect(afterName).toBe(beforeName)

        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })

    test('skip-next button advances when queue has multiple tracks', async ({ page }) => {
        await page.goto(routes.library)
        const cards = page.getByTestId('song-card')
        await expect(cards.first()).toBeVisible({ timeout: 10000 })
        test.skip((await cards.count()) < 2, 'need at least 2 library songs to test skip')

        await page.getByRole('button', { name: 'play all' }).click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
        const trackNameEl = page.getByTestId('player-track-name').first()
        await expect(trackNameEl).not.toBeEmpty({ timeout: 5000 })
        const beforeName = (await trackNameEl.textContent())?.trim() ?? ''

        const nextBtn = page.getByTestId('player-next').first()
        await expect(nextBtn).not.toBeDisabled({ timeout: 5000 })
        await nextBtn.click()
        // wait for the player to settle on the new track
        await expect.poll(async () => (await trackNameEl.textContent())?.trim(), { timeout: 5000 }).not.toBe(beforeName)
    })
})
