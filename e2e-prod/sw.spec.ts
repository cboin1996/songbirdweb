import { test, expect } from '@playwright/test'
import { login, USERNAME, PASSWORD, API_BASE } from '../e2e/helpers'

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

    // Verify songbird-shell-v7 is kept (artwork-v1 only exists if artwork was loaded)
    const cacheNames = await page.evaluate(() => caches.keys())
    expect(cacheNames).toContain('songbird-shell-v7')
    // artwork cache only exists if an image was loaded before cache cleanup
    // don't assert it here since it depends on page content
  })

  test('static /_next/static/* chunks served from cache on reload', async ({ page }) => {
    // First load to populate cache and ensure SW is controlling the page
    await page.goto('/')
    await page.evaluate(() => navigator.serviceWorker.ready)

    // Wait for SW to actively control the page (not just ready)
    const isControlling = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        if (navigator.serviceWorker.controller) {
          resolve(true)
          return
        }
        const timeout = setTimeout(() => resolve(false), 5000)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          clearTimeout(timeout)
          resolve(true)
        })
      })
    })
    expect(isControlling).toBe(true)

    // Ensure SW update is complete before measuring cache hits
    await page.waitForTimeout(1000)

    // Collect network requests on the reload
    const networkRequests: string[] = []
    page.on('response', (resp) => {
      if (resp.url().includes('/_next/static/') && resp.ok()) {
        networkRequests.push(resp.url())
      }
    })

    // Reload page — SW should serve cached static chunks
    await page.reload()

    // After reload, /_next/static/* should come from cache (not network)
    // In prod, these are served with immutable headers, so cached requests
    // should drastically reduce or reach zero.
    await page.waitForTimeout(2000)

    // Check that we have very few network hits on static chunks (typically 0 on reload)
    const staticNetworkHits = networkRequests.filter((url) =>
      url.includes('/_next/static/') && url.includes('.js'),
    ).length

    expect(staticNetworkHits).toBeLessThan(3)
  })
})
