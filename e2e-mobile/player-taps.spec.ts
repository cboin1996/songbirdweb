import { test, expect } from '../e2e/fixtures/test'
import { login } from '../e2e/helpers'
import { LibraryPage, PlayerBar } from '../e2e/pages'

// The phone's player bar by touch: what a tap on each control does. The bar renders a
// phone set of controls and a wide set, so each is taken as the one that is visible.
const control = (page: import('@playwright/test').Page, id: string) =>
  page.getByTestId(id).filter({ visible: true }).first()

test.describe('mobile player taps', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    const lib = new LibraryPage(page)
    await page.goto('/library')
    await lib.waitForSongs()
    test.skip((await lib.songCards.count()) < 3, 'needs at least 3 library songs')
    await lib.playAllBtn.click()
    await new PlayerBar(page).waitForTrackName()
  })

  test('tapping play/pause toggles the title between pause and play', async ({ page }) => {
    await expect(control(page, 'player-play-pause-mobile')).toHaveAttribute('title', 'pause')
    await control(page, 'player-play-pause-mobile').tap()
    await expect(control(page, 'player-play-pause-mobile')).toHaveAttribute('title', 'play')
    await control(page, 'player-play-pause-mobile').tap()
    await expect(control(page, 'player-play-pause-mobile')).toHaveAttribute('title', 'pause')
  })

  test('tapping next moves to another song, tapping previous right after returns', async ({ page }) => {
    const player = new PlayerBar(page)
    const first = await player.getTrackName()
    await control(page, 'player-next').tap()
    await expect.poll(() => player.getTrackName()).not.toBe(first)
    await control(page, 'player-prev').tap()
    await expect.poll(() => player.getTrackName()).toBe(first)
  })

  test('tapping shuffle turns it on and a second tap turns it off', async ({ page }) => {
    const shuffle = control(page, 'player-shuffle')
    await expect(shuffle).toHaveAttribute('aria-pressed', 'false')
    await shuffle.tap()
    await expect(shuffle).toHaveAttribute('aria-pressed', 'true')
    await shuffle.tap()
    await expect(shuffle).toHaveAttribute('aria-pressed', 'false')
  })
})
