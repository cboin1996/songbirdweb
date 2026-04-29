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
        await page.goto('/library')
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })
        const banner = page.locator('.bg-amber-400')
        await expect(banner).toHaveCount(0)
    })

    test('offline banner is shown when offline', async ({ page }) => {
        // Visit while online so the page assets/state load, then flip offline
        // (setOffline before goto blocks the initial navigation).
        await page.goto('/library')
        await page.context().setOffline(true)
        // Trigger the navigator.onLine event the OfflineBanner listens to.
        await page.evaluate(() => window.dispatchEvent(new Event('offline')))
        const banner = page.locator('.bg-amber-400, .bg-sky-500\\/10')
        await expect(banner.first()).toBeVisible({ timeout: 5000 })
        await page.context().setOffline(false)
    })

    // FIXME: SW is disabled in dev (sw-register.tsx skips registration when NODE_ENV != production),
    // so an offline reload can't be served by the SW shell cache. Test only meaningful against a
    // production build (npm run build && npm start). Punch list.
    test.fixme('library loads cached songs when offline', async ({ page }) => {
        await page.goto('/library')
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })
        await page.context().setOffline(true)
        await page.reload()
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })
    })

    test('kebab menu actions are disabled when offline', async ({ page }) => {
        await page.context().setOffline(true)
        await page.goto('/library')
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.hover()
        await card.getByTestId('song-kebab').click()
        const menu = page.getByTestId('song-kebab-menu')
        await expect(menu).toBeVisible({ timeout: 3000 })
        await expect(menu.getByRole('button', { name: 'Download' })).toBeDisabled()
        await expect(menu.getByRole('button', { name: 'Play next' })).toBeDisabled()
        await expect(menu.getByRole('button', { name: 'Edit' })).toBeDisabled()
    })

    test('import dropzone is disabled when offline', async ({ page }) => {
        await page.context().setOffline(true)
        await page.goto('/import')
        const dropzone = page.getByTestId('import-dropzone')
        await expect(dropzone).toBeVisible({ timeout: 5000 })
        await expect(dropzone).toHaveClass(/opacity-40/)
        await expect(dropzone).toHaveClass(/cursor-not-allowed/)
    })

    test('save all offline button is disabled when offline', async ({ page }) => {
        await page.context().setOffline(true)
        await page.goto('/library')
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })
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
        await page.goto('/explore')
        await flipOffline(page)
        await expect(page.getByText(/needs internet/i)).toBeVisible({ timeout: 5000 })
        await expect(page.getByRole('link', { name: /go to library/i })).toBeVisible()
    })

    test('OfflineGuard: /import shows empty state with go-to-library link', async ({ page }) => {
        await page.goto('/import')
        await flipOffline(page)
        await expect(page.getByText(/needs internet/i)).toBeVisible({ timeout: 5000 })
        await expect(page.getByRole('link', { name: /go to library/i })).toBeVisible()
    })

    test('OfflineGuard: /download shows empty state with go-to-library link', async ({ page }) => {
        await page.goto('/download')
        await flipOffline(page)
        await expect(page.getByText(/needs internet/i)).toBeVisible({ timeout: 5000 })
        await expect(page.getByRole('link', { name: /go to library/i })).toBeVisible()
    })

    test('OfflineGuard: clicking "go to library" lands on /library', async ({ page }) => {
        await page.goto('/explore')
        await flipOffline(page)
        const link = page.getByRole('link', { name: /go to library/i })
        await expect(link).toBeVisible({ timeout: 5000 })
        await link.click()
        await expect(page).toHaveURL(/\/library/, { timeout: 5000 })
    })
})
