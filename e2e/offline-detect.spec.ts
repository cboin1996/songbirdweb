import { test, expect, Page } from './fixtures/test'
import { LibraryPage } from './pages'

// Airplane mode on a phone does not always say so: the browser may keep reporting a
// connection while every request fails. The app must show offline within a couple of
// seconds anyway, not whenever its next request happens to fail.
// The library asks the server for nothing more by itself once it has loaded, so these tests
// make the app ask: a draft change makes it fetch the drafts list again.
async function askTheServerSomething(page: Page) {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('songbird:draft-changed')))
}

test.describe('offline is shown quickly', () => {
    test('when the browser says offline', async ({ page, context }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()
        const started = Date.now()
        await context.setOffline(true)
        await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 5000 })
        expect(Date.now() - started).toBeLessThan(5000)
    })

    test('when the browser keeps saying online but nothing is answered', async ({ page, context }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()
        const started = Date.now()
        await context.route('**/v1/**', route => route.abort('internetdisconnected'))
        await askTheServerSomething(page)
        await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 5000 })
        expect(Date.now() - started).toBeLessThan(5000)
    })

    test('when the browser keeps saying online and requests hang unanswered', async ({ page, context }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()
        const started = Date.now()
        // Held open and never answered: the connection died without being closed.
        await context.route('**/v1/**', () => new Promise(() => {}))
        await askTheServerSomething(page)
        await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 10000 })
        expect(Date.now() - started).toBeLessThan(8000)
    })
})
