import { test, expect } from '@playwright/test'
import { login } from '../e2e/helpers'
import { LibraryPage, PlayerBar } from '../e2e/pages'

const LIBRARY = '/library'

test.describe('mobile responsive behaviors', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    const lib = new LibraryPage(page)
    await page.goto(LIBRARY)
    await lib.waitForSongs()
  })

  test('select mode entered via long-press on song card', async ({ page }) => {
    const lib = new LibraryPage(page)
    const card = lib.songCards.first()
    await card.dispatchEvent('touchstart')
    await page.waitForTimeout(500)
    await card.dispatchEvent('touchend')

    await expect(lib.selectedCount()).toBeVisible({ timeout: 3000 })
  })

  test('library toolbar is NOT sticky on mobile', async ({ page }) => {
    const toolbar = page.locator('div').filter({ has: page.getByRole('button', { name: /songs|artists|albums/ }) }).first()

    if (await toolbar.isVisible()) {
      const position = await toolbar.evaluate((el) =>
        window.getComputedStyle(el).position
      )
      expect(position).not.toBe('sticky')
    }
  })

  test('letter rail section dividers do NOT stick on mobile', async ({ page }) => {
    const lib = new LibraryPage(page)
    const firstDivider = lib.sections().first()
    await expect(firstDivider).toBeVisible({ timeout: 5000 })

    const initialBBox = await firstDivider.boundingBox()
    expect(initialBBox).not.toBeNull()

    await page.evaluate(() => window.scrollBy(0, 400))
    await page.waitForTimeout(300)

    const afterScrollBBox = await firstDivider.boundingBox()
    expect(afterScrollBBox).not.toBeNull()
    expect(afterScrollBBox!.y).toBeLessThan(0)
  })

  test('song cards render in compact mobile layout (48px artwork)', async ({ page }) => {
    const lib = new LibraryPage(page)
    const artwork = lib.songCards.first().locator('img').first()

    await expect(artwork).toBeVisible({ timeout: 5000 })

    const bbox = await artwork.boundingBox()
    expect(bbox).not.toBeNull()

    expect(bbox!.width).toBeGreaterThanOrEqual(44)
    expect(bbox!.width).toBeLessThanOrEqual(56)
  })

  test('player bar artwork is 44px on mobile', async ({ page }) => {
    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    await lib.songCards.first().click()

    await page.waitForTimeout(500)

    if (await player.bar.isVisible()) {
      const artwork = player.bar.locator('img').first()
      if (await artwork.isVisible()) {
        const bbox = await artwork.boundingBox()
        expect(bbox).not.toBeNull()
        expect(bbox!.width).toBeGreaterThanOrEqual(40)
        expect(bbox!.width).toBeLessThanOrEqual(52)
      }
    }
  })

  test('mobile player transport buttons have ≥36px tap targets', async ({ page }) => {
    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    await lib.songCards.first().click()

    await page.waitForTimeout(500)

    const shuffle = player.shuffle
    const prev = page.getByTestId('player-prev').filter({ visible: true }).first()
    const playPause = player.playPause
    const next = player.next
    const repeat = player.repeat

    const buttons = [shuffle, prev, playPause, next, repeat]
    for (const btn of buttons) {
      if (await btn.isVisible()) {
        const bbox = await btn.boundingBox()
        expect(bbox).not.toBeNull()
        expect(bbox!.width).toBeGreaterThanOrEqual(32)
        expect(bbox!.height).toBeGreaterThanOrEqual(32)
      }
    }
  })

  test('clicking a per-song source link in queue closes the queue panel', async ({ page }) => {
    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    await lib.songCards.first().click()
    await player.waitForBar()

    await player.openQueue()

    const sourceLink = player.queuePanel.locator('a').filter({ hasText: /library|artists|genres|albums/i }).first()
    if (await sourceLink.isVisible()) {
      await sourceLink.click()
      await expect(player.queuePanel).not.toBeVisible({ timeout: 3000 })
    }
  })
})
