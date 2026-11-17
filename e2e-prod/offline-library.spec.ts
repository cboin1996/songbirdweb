import { test, expect } from '@playwright/test'
import { login, libraryIds, saveSongOffline, OFFLINE_LIBRARY_USERNAME, OFFLINE_PASSWORD } from '../e2e/helpers'
import { LibraryPage, CommonPage } from '../e2e/pages'

// The library offline: saved songs by default, "Show all" for the rest, a "Saved" chip online.
// Its own user: saving writes the account's server-side offline list, so a spec saving as
// another worker's user would collide with it.
test.describe('Library offline view', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await login(page, OFFLINE_LIBRARY_USERNAME, OFFLINE_PASSWORD)
  })

  test('offline shows saved songs with a count, Show all reveals the rest dimmed, tapping one says so', async ({ page, context }) => {
    test.setTimeout(120000)
    const lib = new LibraryPage(page)
    const common = new CommonPage(page)

    await lib.goto()
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await lib.waitForSongs()
    const all = await libraryIds(page)
    expect(all.length).toBeGreaterThanOrEqual(3)
    const savedId = all[0]
    const unsavedId = all[1]
    await saveSongOffline(page, savedId)

    await common.goOffline()
    await page.reload()
    await lib.waitForSongs()

    await expect(page.getByTestId('offline-count')).toContainText(/offline — showing \d+ of \d+ saved/)
    await expect(lib.songById(savedId).first()).toBeVisible()
    await expect(lib.songById(unsavedId)).toHaveCount(0)

    await page.getByTestId('show-all-toggle').click()
    await expect(page.getByTestId('offline-count')).toContainText(/offline — showing all \d+, \d+ saved/)
    const card = (id: string) => page.locator(`[data-testid="song-card"][data-song-id="${id}"]`)
    const unsaved = card(unsavedId).first()
    await expect(unsaved).toBeVisible()
    await expect(unsaved).toHaveAttribute('data-unsaved', 'true')
    await expect(unsaved.getByRole('img', { name: 'not saved offline' })).toBeVisible()
    await expect(card(savedId).first()).not.toHaveAttribute('data-unsaved', 'true')

    await unsaved.click()
    await expect(page.getByText('not saved offline').first()).toBeVisible()

    await context.setOffline(false)
  })

  test('online, the Saved chip narrows the library to saved songs', async ({ page }) => {
    test.setTimeout(90000)
    const lib = new LibraryPage(page)

    await lib.goto()
    await lib.waitForSongs()
    const all = await libraryIds(page)
    expect(all.length).toBeGreaterThanOrEqual(3)
    await saveSongOffline(page, all[0])

    await page.getByTestId('saved-chip').click()
    await expect(lib.songById(all[0]).first()).toBeVisible()
    await expect(lib.songById(all[1])).toHaveCount(0)
    await page.getByTestId('saved-chip').click()
    await expect(lib.songById(all[1]).first()).toBeVisible()
  })
})
