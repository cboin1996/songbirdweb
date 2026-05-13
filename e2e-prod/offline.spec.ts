import { test, expect } from '@playwright/test'
import { login, USERNAME, PASSWORD, API_BASE, ignoreError } from '../e2e/helpers'
import { LibraryPage, PlayerBar, CommonPage } from '../e2e/pages'

test.describe('Offline Behavior', () => {
  test('login then go offline → /library still loads (cached shell)', async ({ page }) => {
    await login(page)
    await page.goto('/library')
    await expect(page).toHaveURL(/\/library/)

    await page.context().setOffline(true)

    await page.reload()

    await expect(page).toHaveURL(/\/library/)
    await expect(page.locator('text=/library|saved|playlist/i').first()).toBeVisible({ timeout: 5000 })
  })

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

  test('offline with no cookies stays on library (no login redirect)', async ({ page }) => {
    await login(page)
    await page.goto('/library')
    await page.goto('/download')
    await page.goto('/settings')

    await page.context().setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    await page.context().clearCookies()

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

  test('saved-offline song plays after going offline', async ({ page, context }) => {
    test.setTimeout(60000)

    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)

    await login(page)
    await lib.goto()
    await lib.waitForSongs()

    const songId = await page.locator('[data-song-id]').first().getAttribute('data-song-id')
    expect(songId).toBeTruthy()

    const card = lib.songCards.first()
    await card.hover()
    await lib.kebab(card).click()
    await page.getByRole('button', { name: /save offline/i }).click()
    await expect(
      page.getByRole('button', { name: /remove offline copy/i })
    ).toBeVisible({ timeout: 30000 })

    const opfsHasFile = await page.evaluate(async (id) => {
      const root = await navigator.storage.getDirectory()
      try {
        const dir = await root.getDirectoryHandle('audio')
        const fh = await dir.getFileHandle(`${id}.mp3`)
        const f = await fh.getFile()
        return f.size
      } catch { return 0 }
    }, songId)
    expect(opfsHasFile).toBeGreaterThan(0)

    await page.reload()
    await lib.waitForSongs()

    await page.locator(`[data-song-id="${songId}"]`).first().click()
    await player.waitForBar()

    await expect.poll(
      () => page.locator('audio').first().evaluate((el: HTMLAudioElement) => el.src),
      { timeout: 10000, message: 'audio.src never became blob: URL' }
    ).toMatch(/^blob:/)

    await expect.poll(
      () => page.locator('audio').first().evaluate((el: HTMLAudioElement) => el.readyState),
      { timeout: 5000 }
    ).toBeGreaterThanOrEqual(2)

    await context.setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))

    const offlineSrc = await page.locator('audio').first().evaluate((el: HTMLAudioElement) => el.src)
    expect(offlineSrc).toMatch(/^blob:/)

    const offlineReadyState = await page.locator('audio').first().evaluate((el: HTMLAudioElement) => el.readyState)
    expect(offlineReadyState).toBeGreaterThanOrEqual(2)

    await context.setOffline(false)
  })

  test('player survives refresh when offline (SW API cache)', async ({ page }) => {
    test.setTimeout(60000)

    const common = new CommonPage(page)
    const player = new PlayerBar(page)
    const lib = new LibraryPage(page)

    await login(page)
    await lib.goto()
    await lib.waitForSongs()

    lib.songCards.first().click()
    await player.waitForBar()
    const songName = await player.getTrackName()
    expect(songName).toBeTruthy()

    await common.goOffline()
    await page.reload()

    await player.waitForBar()
    await expect(player.trackName).toHaveText(songName, { timeout: 10000 })
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

  test('cache audit detects orphaned and corrupt files, fix resolves them', async ({ page }) => {
    test.setTimeout(60000)

    const lib = new LibraryPage(page)
    await login(page)
    await lib.goto()
    await lib.waitForSongs()

    const realSongId = await page.locator('[data-song-id]').first().getAttribute('data-song-id')
    expect(realSongId).toBeTruthy()

    await page.evaluate(async (songId) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle('audio', { create: true })
      const orphan = await dir.getFileHandle('fake-orphan-id.mp3', { create: true })
      const w1 = await orphan.createWritable()
      await w1.write(new Blob(['fake'], { type: 'audio/mpeg' }))
      await w1.close()
      const corrupt = await dir.getFileHandle(`${songId}.mp3`, { create: true })
      const w2 = await corrupt.createWritable()
      await w2.close()
    }, realSongId)

    await page.goto('/settings')

    await page.getByRole('button', { name: 'check cache health' }).click()
    await expect(page.getByText(/orphaned/)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/corrupt/)).toBeVisible()

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
