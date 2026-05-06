import { routes } from './routes'
import { test, expect, Page } from '@playwright/test'
import { login } from './helpers'
import { LibraryPage, CommonPage } from './pages'

test.describe('offline mode', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test.afterEach(async ({ page }) => {
        await page.context().setOffline(false)
    })

    test('offline banner is hidden when online', async ({ page }) => {
        const lib = new LibraryPage(page)
        const common = new CommonPage(page)
        await lib.goto()
        await lib.waitForSongs()
        await expect(common.offlineBanner).toHaveCount(0)
    })

    test('offline banner is shown when offline', async ({ page }) => {
        const lib = new LibraryPage(page)
        const common = new CommonPage(page)
        await lib.goto()
        await common.goOffline()
        await expect(common.offlineBanner.first()).toBeVisible({ timeout: 5000 })
        await common.goOnline()
    })

    test('import dropzone is hidden by OfflineGuard when offline', async ({ page }) => {
        const common = new CommonPage(page)
        await page.goto(routes.import)
        await expect(common.importDropzone).toBeVisible({ timeout: 5000 })
        await common.goOffline()
        await expect(common.importDropzone).toBeHidden({ timeout: 5000 })
        await expect(page.getByText(/needs internet/i)).toBeVisible()
    })

    test('save all offline button hidden when offline (no cached songs)', async ({ page }) => {
        const lib = new LibraryPage(page)
        const common = new CommonPage(page)
        await lib.goto()
        await expect(lib.saveAllOfflineBtn).toBeVisible({ timeout: 10000 })
        await expect(lib.saveAllOfflineBtn).not.toBeDisabled()
        await common.goOffline()
        await expect(lib.saveAllOfflineBtn).not.toBeVisible({ timeout: 5000 })
    })

    // === Tier 1 OfflineGuard pages ===

    test('OfflineGuard: /explore shows empty state with go-to-library link', async ({ page }) => {
        const common = new CommonPage(page)
        await page.goto(routes.explore)
        await common.goOffline()
        await expect(page.getByText(/needs internet/i)).toBeVisible({ timeout: 5000 })
        await expect(page.getByRole('link', { name: /go to library/i })).toBeVisible()
    })

    test('OfflineGuard: /import shows empty state with go-to-library link', async ({ page }) => {
        const common = new CommonPage(page)
        await page.goto(routes.import)
        await common.goOffline()
        await expect(page.getByText(/needs internet/i)).toBeVisible({ timeout: 5000 })
        await expect(page.getByRole('link', { name: /go to library/i })).toBeVisible()
    })

    test('OfflineGuard: /download shows empty state with go-to-library link', async ({ page }) => {
        const common = new CommonPage(page)
        await page.goto(routes.download)
        await common.goOffline()
        await expect(page.getByText(/needs internet/i)).toBeVisible({ timeout: 5000 })
        await expect(page.getByRole('link', { name: /go to library/i })).toBeVisible()
    })

    test('OfflineGuard: clicking "go to library" lands on /library', async ({ page }) => {
        const common = new CommonPage(page)
        await page.goto(routes.explore)
        await common.goOffline()
        const link = page.getByRole('link', { name: /go to library/i })
        await expect(link).toBeVisible({ timeout: 5000 })
        await link.click()
        await expect(page).toHaveURL(/\/library/, { timeout: 5000 })
    })
})
