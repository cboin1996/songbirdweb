import { test, expect } from '@playwright/test'
import { login } from '../e2e/helpers'

const LIBRARY = '/library'

test.describe('mobile responsive behaviors', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await page.goto(LIBRARY)
    // Ensure first song card is visible before tests start
    await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })
  })

  test('select mode entered via long-press on song card', async ({ page }) => {
    // The Select entry-point button is hidden on mobile (long-press is the
    // canonical entry); it appears only AFTER select mode activates, with
    // text "1 selected" / "Cancel".

    // Long-press (touchStart + wait) on first song card
    const card = page.getByTestId('song-card').first()
    await card.dispatchEvent('touchstart')
    await page.waitForTimeout(500)
    await card.dispatchEvent('touchend')

    // Once in select mode, the toggle button reappears showing the count.
    await expect(page.getByRole('button', { name: /\d+ selected/i })).toBeVisible({ timeout: 3000 })
  })

  test('library toolbar is NOT sticky on mobile', async ({ page }) => {
    // Find toolbar wrapper (contains md:sticky md:top-11 classes)
    // On mobile, md: prefixed styles don't apply, so it should NOT be sticky
    const toolbar = page.locator('div').filter({ has: page.getByRole('button', { name: /songs|artists|albums/ }) }).first()

    if (await toolbar.isVisible()) {
      // Check computed style: position should NOT be sticky on mobile viewport
      const position = await toolbar.evaluate((el) =>
        window.getComputedStyle(el).position
      )
      // Mobile width: md: classes don't apply, so position should be static/relative, not sticky
      expect(position).not.toBe('sticky')
    }
  })

  test('letter rail section dividers do NOT stick on mobile', async ({ page }) => {
    // Scroll down to move past first section divider
    const firstDivider = page.locator('[data-letter]').first()
    await expect(firstDivider).toBeVisible({ timeout: 5000 })

    // Get initial bounding box
    const initialBBox = await firstDivider.boundingBox()
    expect(initialBBox).not.toBeNull()

    // Scroll down 400px
    await page.evaluate(() => window.scrollBy(0, 400))
    await page.waitForTimeout(300)

    // Check divider is no longer in viewport by comparing position
    const afterScrollBBox = await firstDivider.boundingBox()
    expect(afterScrollBBox).not.toBeNull()
    // After scrolling, the divider should be above the viewport (negative or very small y)
    expect(afterScrollBBox!.y).toBeLessThan(0)
  })

  test('song cards render in compact mobile layout (48px artwork)', async ({ page }) => {
    const firstCard = page.getByTestId('song-card').first()
    const artwork = firstCard.locator('img').first()

    await expect(artwork).toBeVisible({ timeout: 5000 })

    const bbox = await artwork.boundingBox()
    expect(bbox).not.toBeNull()

    // Compact mobile layout: ~48px artwork (allow 44-56 range for margin/padding)
    expect(bbox!.width).toBeGreaterThanOrEqual(44)
    expect(bbox!.width).toBeLessThanOrEqual(56)
  })

  test('player bar artwork is 44px on mobile', async ({ page }) => {
    // Trigger playback by clicking first song
    const firstCard = page.getByTestId('song-card').first()
    await firstCard.click()

    // Wait for player bar to show
    await page.waitForTimeout(500)

    // Find artwork img in player bar
    const playerBar = page.getByTestId('player-bar')
    if (await playerBar.isVisible()) {
      const artwork = playerBar.locator('img').first()
      if (await artwork.isVisible()) {
        const bbox = await artwork.boundingBox()
        expect(bbox).not.toBeNull()
        // Mobile player artwork: 44px (w-11 h-11), allow 40-48 for padding/margin
        expect(bbox!.width).toBeGreaterThanOrEqual(40)
        expect(bbox!.width).toBeLessThanOrEqual(48)
      }
    }
  })

  test('mobile player transport buttons have ≥36px tap targets', async ({ page }) => {
    // Trigger playback
    const firstCard = page.getByTestId('song-card').first()
    await firstCard.click()

    // Wait for player to activate
    await page.waitForTimeout(500)

    // Find all transport control buttons (shuffle, prev, play/pause, next, repeat).
    // Each testid resolves to 2 elements (desktop + mobile button in player.tsx);
    // .filter({ visible: true }).first() picks whichever is rendered for the viewport.
    const shuffle = page.getByTestId('player-shuffle').filter({ visible: true }).first()
    const prev = page.getByTestId('player-prev').filter({ visible: true }).first()
    const playPause = page.getByTestId('player-play-pause').filter({ visible: true }).first()
    const next = page.getByTestId('player-next').filter({ visible: true }).first()
    const repeat = page.getByTestId('player-repeat').filter({ visible: true }).first()

    const buttons = [shuffle, prev, playPause, next, repeat]
    for (const btn of buttons) {
      if (await btn.isVisible()) {
        const bbox = await btn.boundingBox()
        expect(bbox).not.toBeNull()
        // Tap targets: ≥36px width and height (ideal 44px with p-2 -m-1, allow some slack)
        expect(bbox!.width).toBeGreaterThanOrEqual(36)
        expect(bbox!.height).toBeGreaterThanOrEqual(36)
      }
    }
  })

  // Regression: on mobile the queue panel takes the full screen, so clicking
  // a per-song source link in the queue must close the panel — otherwise the
  // jumped-to song is hidden behind it and the user can't see the highlight.
  test('clicking a per-song source link in queue closes the queue panel', async ({ page }) => {
    // Start playback so player + queue are populated
    await page.getByTestId('song-card').first().click()
    await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })

    // Open queue
    await page.getByTestId('player-queue-toggle').click()
    const queuePanel = page.getByTestId('player-queue-panel')
    await expect(queuePanel).toBeVisible({ timeout: 3000 })

    // Click the first per-song source link inside the queue (the "Library" label next to a row)
    const sourceLink = queuePanel.locator('a').filter({ hasText: /library|artists|genres|albums/i }).first()
    if (await sourceLink.isVisible()) {
      await sourceLink.click()
      // Queue panel should close so the highlighted song is visible
      await expect(queuePanel).not.toBeVisible({ timeout: 3000 })
    }
  })
})
