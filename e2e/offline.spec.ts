import { routes } from './routes'
import { test, expect, Page } from '@playwright/test'
import { login } from './helpers'

test.describe('offline mode', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test.afterEach(async ({ page }) => {
        await page.context().setOffline(false)
    })

    test('offline banner is hidden when online', async ({ page }) => {
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })
        const banner = page.locator('.bg-amber-400')
        await expect(banner).toHaveCount(0)
    })

    test('offline banner is shown when offline', async ({ page }) => {
        // Visit while online so the page assets/state load, then flip offline
        // (setOffline before goto blocks the initial navigation).
        await page.goto(routes.library)
        await page.context().setOffline(true)
        // Trigger the navigator.onLine event the OfflineBanner listens to.
        await page.evaluate(() => window.dispatchEvent(new Event('offline')))
        const banner = page.locator('.bg-amber-400, .bg-sky-500\\/10')
        await expect(banner.first()).toBeVisible({ timeout: 5000 })
        await page.context().setOffline(false)
    })

    // The two SW-gated offline tests (library loads cached songs, kebab menu disabled when offline)
    // moved to e2e-prod/offline.spec.ts — they need a real production SW to be meaningful.

    test('import dropzone is hidden by OfflineGuard when offline', async ({ page }) => {
        // /import is wrapped in <OfflineGuard feature="import">, which
        // replaces the dropzone with an empty-state message when offline.
        // Verify the dropzone disappears and the guard message appears.
        await page.goto(routes.import)
        const dropzone = page.getByTestId('import-dropzone')
        await expect(dropzone).toBeVisible({ timeout: 5000 })
        await page.context().setOffline(true)
        await page.evaluate(() => window.dispatchEvent(new Event('offline')))
        await expect(dropzone).toBeHidden({ timeout: 5000 })
        await expect(page.getByText(/needs internet/i)).toBeVisible()
    })

    test.fixme('save all offline button is disabled when offline', async ({ page }) => {
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })
        await page.context().setOffline(true)
        await page.evaluate(() => window.dispatchEvent(new Event('offline')))
        const saveAllBtn = page.getByRole('button', { name: /save all offline/i })
        await expect(saveAllBtn).toBeVisible({ timeout: 5000 })
        await expect(saveAllBtn).toBeDisabled()
    })

    // === Tier 1 OfflineGuard pages ===

    // Visit while online so the page bundles can load, then flip offline and
    // dispatch the navigator.onLine 'offline' event so OfflineGuard re-renders.
    async function flipOffline(page: Page) {
        await page.context().setOffline(true)
        await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    }

    test('OfflineGuard: /explore shows empty state with go-to-library link', async ({ page }) => {
        await page.goto(routes.explore)
        await flipOffline(page)
        await expect(page.getByText(/needs internet/i)).toBeVisible({ timeout: 5000 })
        await expect(page.getByRole('link', { name: /go to library/i })).toBeVisible()
    })

    test('OfflineGuard: /import shows empty state with go-to-library link', async ({ page }) => {
        await page.goto(routes.import)
        await flipOffline(page)
        await expect(page.getByText(/needs internet/i)).toBeVisible({ timeout: 5000 })
        await expect(page.getByRole('link', { name: /go to library/i })).toBeVisible()
    })

    test('OfflineGuard: /download shows empty state with go-to-library link', async ({ page }) => {
        await page.goto(routes.download)
        await flipOffline(page)
        await expect(page.getByText(/needs internet/i)).toBeVisible({ timeout: 5000 })
        await expect(page.getByRole('link', { name: /go to library/i })).toBeVisible()
    })

    // FIXME(0.1.0): SW-gated. /library bundle is pre-cached by the SW at
    // install (see public/sw.js: `cache.addAll(['/offline', '/', '/library'])`),
    // but the SW doesn't register in dev mode — so clicking the link while
    // offline navigates to chrome-error. This test belongs in e2e-prod/
    // alongside the other SW-gated cases. Move it there + un-fixme.
    test.fixme('OfflineGuard: clicking "go to library" lands on /library', async ({ page }) => {
        await page.goto(routes.explore)
        await flipOffline(page)
        const link = page.getByRole('link', { name: /go to library/i })
        await expect(link).toBeVisible({ timeout: 5000 })
        await link.click()
        await expect(page).toHaveURL(/\/library/, { timeout: 5000 })
    })
})
