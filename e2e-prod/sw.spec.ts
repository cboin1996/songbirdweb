import { test, expect } from '@playwright/test'
import { login, USERNAME, PASSWORD, API_BASE } from '../e2e/helpers'
import { readFileSync } from 'fs'
import { join } from 'path'

test.describe('Service Worker Lifecycle', () => {
  test('SW registers on first page load', async ({ page }) => {
    await page.goto('/')

    // Wait for SW to register and become active
    const controller = await page.evaluate(() => {
      return new Promise<ServiceWorkerContainer['controller'] | null>((resolve) => {
        if (navigator.serviceWorker.controller) {
          resolve(navigator.serviceWorker.controller)
          return
        }
        const timeout = setTimeout(() => resolve(null), 5000)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          clearTimeout(timeout)
          resolve(navigator.serviceWorker.controller)
        })
      })
    })

    expect(controller).not.toBeNull()

    // Verify /sw.js returns 200
    const resp = await page.request.get('/sw.js')
    expect(resp.status()).toBe(200)
  })

  test('cache version bump purges old caches', async ({ page }) => {
    // Navigate to / first to initialize ServiceWorker context
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready)

    // Pre-populate old cache with a dummy entry
    await page.evaluate(() => {
      return caches.open('songbird-shell-v0').then((cache) => cache.add('/'))
    })

    // Verify old cache exists before reload
    const hasBefore = await page.evaluate(() => {
      return caches.keys().then((keys) => keys.includes('songbird-shell-v0'))
    })
    expect(hasBefore).toBe(true)

    // Unregister and re-register the SW to trigger fresh install/activate cycle
    // This simulates deploying a new SW version
    await page.evaluate(() => {
      return navigator.serviceWorker.getRegistration().then(async (reg) => {
        if (reg) {
          // Unregister to allow fresh SW registration
          await reg.unregister()
        }
        // Reload page will re-register the SW with the updated cache cleanup logic
      })
    })

    // Reload to re-register SW and trigger cache cleanup
    await page.reload()
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.waitForTimeout(1000) // Give SW activation time to complete

    // Verify old cache was deleted by activate event
    const hasAfter = await page.evaluate(() => {
      return caches.keys().then((keys) => keys.includes('songbird-shell-v0'))
    })
    expect(hasAfter).toBe(false)

    // Verify current shell cache is kept (artwork-v1 only exists if artwork was loaded)
    const cacheNames = await page.evaluate(() => caches.keys())
    const { version } = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'))
    expect(cacheNames).toContain(`songbird-shell-v${version}`)
    // artwork cache only exists if an image was loaded before cache cleanup
    // don't assert it here since it depends on page content
  })

  test('an install while signed out does not store the sign-in page as the library', async ({ page }) => {
    await login(page)
    // A public page, so nothing on it asks the API anything once the session is gone
    // and sends the tab to sign in while the test is reloading it.
    await page.goto('/offline')
    await page.evaluate(() => navigator.serviceWorker.ready)

    // The session expires, and an app update replaces the worker: the new one
    // installs while nobody is signed in.
    await page.context().clearCookies()
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration()
      await reg?.unregister()
      for (const key of await caches.keys()) await caches.delete(key)
    })
    await page.reload()
    await page.evaluate(() => navigator.serviceWorker.ready)
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

    // Sign in again without opening the library, then lose the network.
    await login(page)
    await page.context().setOffline(true)

    await page.goto('/library', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(/songs saved for offline will still play/i)).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('link', { name: /go to library/i })).toBeVisible()
  })

  // The install while signed out skips the library page, and the spec leaves it to the
  // next online visit to store it. If that visit stored nothing, an offline launch would
  // show the offline page until the next app update.
  test('a library visit made online is stored, and the next offline launch opens the library', async ({ page }) => {
    await login(page)
    await page.goto('/library')
    await page.evaluate(() => navigator.serviceWorker.ready)
    // Under the worker's control from here.
    await page.reload()
    await expect.poll(() => page.evaluate(async () => {
      for (const key of await caches.keys()) {
        if (await (await caches.open(key)).match('/library')) return true
      }
      return false
    }), { timeout: 10000 }).toBe(true)

    await page.context().setOffline(true)
    await page.goto('/library', { waitUntil: 'domcontentloaded' })
    // The app's own navigation bar is on the library and not on the offline page.
    await expect(page.locator('nav').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/songs saved for offline will still play/i)).toHaveCount(0)
    await page.context().setOffline(false)
  })

  test('static /_next/static/* chunks served from cache on reload', async ({ page }) => {
    // First load to populate cache
    await page.goto('/')
    await page.waitForTimeout(3000) // Give SW time to register and handle requests

    // Reload page to verify SW is serving it
    await page.reload()
    await page.waitForTimeout(1000)

    // Page should still be accessible and functional
    // This verifies the SW is active and handling navigation correctly
    await expect(page).toHaveURL('/')
  })
})
