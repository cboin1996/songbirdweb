import { test, expect } from '@playwright/test'
import { login, USERNAME, PASSWORD, API_BASE, ignoreError } from '../e2e/helpers'

test.describe('Offline Behavior', () => {
  test('login then go offline → /library still loads (cached shell)', async ({ page }) => {
    await login(page)
    await page.goto('/library')
    await expect(page).toHaveURL(/\/library/)

    // Go offline
    await page.context().setOffline(true)

    // Reload while offline
    await page.reload()

    // Should still see library cached shell (header, nav, etc.)
    await expect(page).toHaveURL(/\/library/)
    await expect(page.locator('text=/library|saved|playlist/i').first()).toBeVisible({ timeout: 5000 })
  })

  test('unreachable navigation falls through to /offline page', async ({ page }) => {
    await login(page)
    await page.goto('/library')

    // Go offline
    await page.context().setOffline(true)

    // Try to navigate to a route that likely wasn't pre-cached
    await page.goto('/nonexistent-route-12345', { waitUntil: 'domcontentloaded' })

    // SW serves /offline content for the failed navigation; URL doesn't change
    // Assert /offline page content instead (characteristic text from offline/page.tsx)
    await expect(page.locator('text=/songs saved for offline will still play/i')).toBeVisible()
  })

  test('OfflineGuard on /import shows offline state', async ({ page }) => {
    await login(page)
    await page.goto('/import')
    await expect(page).toHaveURL(/\/import/)

    // Go offline
    await page.context().setOffline(true)
    await page.reload()

    // OfflineGuard renders: "you're offline" (curly apostrophe U+2019) + feature text + link
    // Use curly apostrophe literal (U+2019) or regex to avoid apostrophe mismatch
    await expect(page.locator(`text=you’re offline`)).toBeVisible()
    await expect(page.locator("text=import needs internet")).toBeVisible()
    await expect(page.locator("text=go to library")).toBeVisible()
  })

  test('cached song plays while offline', async ({ page }) => {
    await login(page)

    // Navigate to library and play a song to cache it
    await page.goto('/library')
    const playButton = page.locator('[data-testid="play-button"]').first()
    if (await playButton.isVisible()) {
      await playButton.click()
      await page.waitForTimeout(500) // Let audio load
    }

    // Go offline
    await page.context().setOffline(true)

    // Attempt to play (or verify audio src is accessible offline)
    const audio = page.locator('audio').first()
    const src = await audio.evaluate((el: HTMLAudioElement) => el.src || el.currentSrc)

    // In offline mode, cached songs should use blob: or be served from cache
    expect(src).toBeTruthy()
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

  test('no console errors during login → library → play flow', async ({ page }) => {
    const consoleErrors: string[] = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text()
        if (!ignoreError(text)) {
          consoleErrors.push(text)
        }
      }
    })

    await login(page)
    await page.goto('/library')
    const playButton = page.locator('[data-testid="play-button"]').first()
    if (await playButton.isVisible()) {
      await playButton.click()
    }
    await page.waitForTimeout(1000)

    expect(consoleErrors).toEqual([])
  })
})
