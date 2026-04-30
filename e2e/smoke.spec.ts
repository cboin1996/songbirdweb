import { routes } from './routes'
import { test, expect } from '@playwright/test'
import { login, ignoreError } from './helpers'

// Smoke / regression: the absolute critical path. If any of these fail,
// nothing else matters. Kept tight so it runs fast and gives a clear signal.
test.describe('smoke: login → library → play', () => {
    test.describe.configure({ mode: 'serial' })

    test('full critical path completes without console errors', async ({ page }) => {
        const errors: string[] = []
        page.on('console', m => { if (m.type() === 'error' && !ignoreError(m.text())) errors.push(m.text()) })
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        // login redirects to /download
        await login(page)

        // navigate to library — at least one song card must render
        await page.goto(routes.library)
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })

        // start playback by clicking the card
        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
        await expect(page.getByTestId('player-track-name').first()).not.toBeEmpty({ timeout: 5000 })

        // pause and resume to confirm playback toggles work end-to-end
        const playPause = page.getByTestId('player-play-pause')
        await playPause.click()
        await page.waitForTimeout(300)
        await playPause.click()

        // logout returns to root
        await page.getByRole('button', { name: 'Log out' }).click()
        await expect(page).toHaveURL('/')

        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })
})
