import { routes } from './routes'
import { test, expect } from '@playwright/test'
import { login, ignoreError } from './helpers'
import { LibraryPage, PlayerBar, CommonPage } from './pages'

test.describe('smoke: login → library → play', () => {
    test.describe.configure({ mode: 'serial' })

    test('full critical path completes without console errors', async ({ page }) => {
        const errors: string[] = []
        page.on('console', m => { if (m.type() === 'error' && !ignoreError(m.text())) errors.push(m.text()) })
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        const common = new CommonPage(page)

        await login(page)

        await lib.goto()
        await lib.waitForSongs()

        await lib.songCards.first().click()
        await player.waitForBar()
        await player.waitForTrackName()

        await player.playPause.click()
        await player.playPause.click()

        await common.logoutBtn.click()
        await expect(page).toHaveURL('/')

        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })
})
