import { test, expect } from './fixtures/test'
import { login } from './helpers'
import { LibraryPage, PlayerBar } from './pages'

// Small UI rules: the queue's search sits in its header row, the phone nav menu closes
// after any choice, and the kebab menu goes when the page scrolls.
test.describe('menus and queue header', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('queue search sits in the queue header row when the queue has more than 5 songs', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        await lib.waitForSongs()
        test.skip((await lib.songCards.count()) < 6, 'the search shows only for a queue of 6 or more songs')
        await lib.playAllBtn.click()
        await player.waitForBar()
        await player.openQueue()
        await expect(page.getByTestId('queue-header').getByTestId('queue-search')).toBeVisible()
    })

    test('desktop queue panel has 8px corners, a soft shadow, and no fill on the current song', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        await lib.waitForSongs()
        await lib.playAllBtn.click()
        await player.waitForBar()
        await player.openQueue()
        const panel = page.getByTestId('player-queue-panel')
        await expect(panel).toHaveCSS('border-top-left-radius', '8px')
        const shadow = await panel.evaluate(el => getComputedStyle(el).boxShadow)
        expect(shadow).not.toBe('none')
        expect(shadow).not.toContain('25px 50px')
        const current = panel.locator('[data-dpos]').filter({ has: page.locator('svg.text-sky-500') }).first()
        await expect(current).toBeVisible()
        await expect(current).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    })

    test.describe('nav menu on a phone', () => {
        test.use({ viewport: { width: 390, height: 844 } })

        for (const label of ['download', 'import', 'library', 'explore']) {
            test(`closes after choosing ${label}`, async ({ page }) => {
                await page.goto('/library')
                await page.getByTestId('nav-menu-toggle').click()
                const menu = page.getByTestId('nav-menu')
                await expect(menu).toBeVisible()
                await menu.getByRole('link', { name: label, exact: true }).click()
                await expect(menu).toBeHidden()
            })
        }
    })

    test('the library kebab menu closes when the page scrolls', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()
        const card = lib.songCards.first()
        await card.hover()
        await lib.kebab(card).click()
        await expect(lib.kebabMenu()).toBeVisible()
        await page.evaluate(() => window.scrollBy(0, 50))
        await expect(lib.kebabMenu()).toBeHidden()
    })
})
