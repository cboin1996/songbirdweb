import { routes } from './routes'
import { test, expect } from './fixtures/test'
import { login } from './helpers'

// Typing in a search box changes the URL text. It must not ask the Next server
// to render the page again on every keystroke (those requests carry ?_rsc=).
test.describe('typing in search', () => {
    test.beforeEach(async ({ page }) => { await login(page) })

    test('explore search sends no page render per keystroke but keeps the URL in step', async ({ page }) => {
        await page.goto(routes.explore)
        const input = page.locator('main').first().getByPlaceholder(/search/i)
        await expect(input).toBeVisible({ timeout: 10000 })
        await page.waitForTimeout(1000)

        const renders: string[] = []
        page.on('request', r => { if (r.url().includes('_rsc=')) renders.push(r.url()) })
        await input.click()
        await page.keyboard.type('abcdef', { delay: 80 })
        await expect(page).toHaveURL(/q=abcdef/)
        await page.waitForTimeout(500)
        expect(renders).toHaveLength(0)
    })

    test('download search sends no page render per keystroke but keeps the URL in step', async ({ page }) => {
        await page.goto(routes.download)
        const input = page.getByTestId('download-search')
        await expect(input).toBeVisible({ timeout: 10000 })
        await page.waitForTimeout(1000)

        const renders: string[] = []
        page.on('request', r => { if (r.url().includes('_rsc=')) renders.push(r.url()) })
        await input.click()
        await page.keyboard.type('abcdef', { delay: 80 })
        await expect(page).toHaveURL(/query=abcdef/)
        await page.waitForTimeout(500)
        expect(renders).toHaveLength(0)
    })
})
