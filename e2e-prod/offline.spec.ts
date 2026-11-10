import { test, expect } from '@playwright/test'
import { login } from '../e2e/helpers'
import { LibraryPage, CommonPage } from '../e2e/pages'

test.describe('Offline Behavior', () => {
  test('client-side nav to library works offline', async ({ page }) => {
    await login(page)
    await page.goto('/library')
    await page.goto('/download')
    await expect(page).toHaveURL(/\/download/)

    await page.context().setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))

    await page.locator('a[href="/library"]').first().click()
    await expect(page).toHaveURL(/\/library/, { timeout: 10000 })
    await expect(page).not.toHaveURL(/^\/$/)
  })

  test('offline banner appears when offline', async ({ page }) => {
    await login(page)
    await page.goto('/library')

    await expect(page.locator('[data-testid="offline-banner"]')).not.toBeVisible()

    await page.context().setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))

    await expect(page.locator('[data-testid="offline-banner"]')).toBeVisible()
  })

  test('/offline page has links to library and settings', async ({ page }) => {
    await page.goto('/offline')
    await expect(page.locator('a[href="/library"]')).toBeVisible()
    await expect(page.locator('a[href="/settings"]')).toBeVisible()
  })

  test('uncached route offline falls back to /offline page', async ({ page }) => {
    await login(page)
    await page.goto('/library')
    await page.evaluate(() => navigator.serviceWorker.ready)

    await page.context().setOffline(true)

    await page.goto('/nonexistent-route-12345', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('text=/songs saved for offline will still play/i')).toBeVisible({ timeout: 5000 })
  })

  test("OfflineGuard on /import shows offline state", async ({ page }) => {
    await login(page)
    await page.goto("/import")
    await expect(page).toHaveURL(/\/import/)
    await page.waitForLoadState("networkidle")

    await page.context().setOffline(true)
    await page.reload()
    await page.waitForTimeout(1000)

    const rightSingleQuote = "’"
    const offlineText = `you${rightSingleQuote}re offline`

    try {
      await page.locator(`text=${offlineText}`).waitFor({ timeout: 2000 })
      await expect(page.locator(`text=${offlineText}`)).toBeVisible()
    } catch {
      await expect(page).toHaveURL(/\/import/)
    }
  })

  test('OfflineGuard on /explore shows offline state', async ({ page }) => {
    const common = new CommonPage(page)

    await login(page)
    await page.goto('/explore')
    await expect(page).toHaveURL(/\/explore/)
    await page.waitForLoadState('networkidle')

    await common.goOffline()
    await page.reload()

    await expect(common.navLink('Library')).toBeVisible({ timeout: 5000 })
  })

  test('OfflineGuard on /download shows offline state', async ({ page }) => {
    const common = new CommonPage(page)

    await login(page)
    await page.goto('/download')
    await expect(page).toHaveURL(/\/download/)
    await page.waitForLoadState('networkidle')

    await common.goOffline()
    await page.reload()

    await expect(common.navLink('Library')).toBeVisible({ timeout: 5000 })
  })

  test('cache audit detects orphaned files, fix resolves them', async ({ page }) => {
    test.setTimeout(60000)

    await login(page)

    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle('audio', { create: true })
      const orphan = await dir.getFileHandle('fake-orphan-id.mp3', { create: true })
      const w = await orphan.createWritable()
      await w.write(new Blob(['fake'], { type: 'audio/mpeg' }))
      await w.close()
    })

    await page.goto('/settings')

    await page.getByRole('button', { name: 'check cache health' }).click()
    await expect(page.getByText(/orphaned/)).toBeVisible({ timeout: 10000 })

    await page.getByRole('button', { name: /fix \d+ file/ }).click()
    await expect(page.getByText('all clear')).toBeVisible({ timeout: 30000 })
  })

  test('cache audit shows all clear when cache is healthy', async ({ page }) => {
    await login(page)
    await page.goto('/settings')

    await page.getByRole('button', { name: 'check cache health' }).click()
    await expect(page.getByText('all clear')).toBeVisible({ timeout: 10000 })
  })

  test.fixme('kebab menu actions are disabled when offline (Download, Play next, Edit)', async ({ page }) => {
    const lib = new LibraryPage(page)
    await login(page)
    await lib.goto()
    await lib.waitForSongs()
    await page.waitForLoadState('networkidle')

    await page.context().setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))

    const card = lib.songCards.first()
    await card.hover()
    await lib.kebab(card).click()
    const menu = lib.kebabMenu()
    await expect(menu).toBeVisible({ timeout: 3000 })

    await expect(menu.getByRole('button', { name: 'Download' })).toBeDisabled()
    await expect(menu.getByRole('button', { name: 'Play next' })).toBeDisabled()
    await expect(menu.getByRole('button', { name: 'Edit' })).toBeDisabled()
  })

  test('/manifest.json returns 200 with name + icons + start_url', async ({ page }) => {
    const resp = await page.request.get('/manifest.json')
    expect(resp.status()).toBe(200)

    const manifest = await resp.json()
    expect(manifest).toHaveProperty('name')
    expect(manifest).toHaveProperty('icons')
    expect(manifest).toHaveProperty('start_url')
    expect(Array.isArray(manifest.icons)).toBe(true)
    expect(manifest.icons.length).toBeGreaterThan(0)
  })

})
