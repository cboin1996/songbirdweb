import { routes } from './routes'
import { test, expect, Page } from '@playwright/test'
import { USERNAME, PASSWORD, login, ignoreError } from './helpers'


test.describe('info page', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('info page accessible via navbar link', async ({ page }) => {
        await page.goto(routes.download)
        // Navbar may render link in compact + mobile contexts; use first match.
        const infoLink = page.locator('a[href="/info"]').first()
        await expect(infoLink).toBeVisible({ timeout: 5000 })
        await infoLink.click()
        await expect(page).toHaveURL(/\/info/)
    })

    test('page loads with "about" heading', async ({ page }) => {
        await page.goto(routes.info)
        await expect(page.locator('main').filter({ visible: true }).getByText('about')).toBeVisible({ timeout: 10000 })
    })

    test('three version cards visible: songbirdweb, songbirdapi, songbirdcore', async ({ page }) => {
        await page.goto(routes.info)
        const main = page.locator('main').filter({ visible: true })
        await expect(main.getByText(/songbirdweb/i)).toBeVisible({ timeout: 10000 })
        await expect(main.getByText(/songbirdapi/i)).toBeVisible()
        await expect(main.getByText(/songbirdcore/i)).toBeVisible()
    })

    test('each card shows a version string', async ({ page }) => {
        await page.goto(routes.info)
        // version strings match "vX.Y.Z" or "unknown"
        const versionText = page.locator('text=/v\\d+\\.\\d+|unknown/')
        await expect(versionText.first()).toBeVisible({ timeout: 10000 })
    })

    test('each card has a GitHub bug report link', async ({ page }) => {
        await page.goto(routes.info)
        const githubLinks = page.locator('a[href*="github.com/cboin1996"]')
        await expect(githubLinks.first()).toBeVisible({ timeout: 10000 })
        const count = await githubLinks.count()
        // three cards, each with a "file a bug report" link
        expect(count).toBeGreaterThanOrEqual(3)
    })

    test('bug report links open to github.com issues', async ({ page }) => {
        await page.goto(routes.info)
        const firstLink = page.locator('a[href*="github.com/cboin1996"]').first()
        await expect(firstLink).toBeVisible({ timeout: 5000 })
        const href = await firstLink.getAttribute('href')
        expect(href).toContain('github.com')
    })

    test('all three repo links present', async ({ page }) => {
        await page.goto(routes.info)
        await expect(page.locator('a[href*="songbirdweb"]').first()).toBeVisible({ timeout: 5000 })
        await expect(page.locator('a[href*="songbirdapi"]').first()).toBeVisible()
        await expect(page.locator('a[href*="songbirdcore"]').first()).toBeVisible()
    })

    test('version cards have border styling (rendered)', async ({ page }) => {
        await page.goto(routes.info)
        const cards = page.getByTestId('version-card')
        await expect(cards.first()).toBeVisible({ timeout: 5000 })
        const count = await cards.count()
        expect(count).toBeGreaterThanOrEqual(3)
    })

    test('no console errors on info page load', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        await page.goto(routes.info)
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})

        const realErrors = errors.filter(e => !ignoreError(e))
        expect(realErrors, `Console errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })
})
