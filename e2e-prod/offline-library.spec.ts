import { test, expect } from '@playwright/test'
import { login, libraryIds, saveSongOffline, OFFLINE_LIBRARY_USERNAME, OFFLINE_PASSWORD } from '../e2e/helpers'
import { LibraryPage, CommonPage } from '../e2e/pages'

// The library's "saved only" filter, in the filter menu: on by default offline, off online.
// Its own user: saving writes the account's server-side offline list, so a spec saving as
// another worker's user would collide with it.
test.describe('Library offline view', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await login(page, OFFLINE_LIBRARY_USERNAME, OFFLINE_PASSWORD)
  })

  test('offline shows saved songs with a count, turning saved only off reveals the rest dimmed, tapping one says so', async ({ page, context }) => {
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
    await expect(page.getByTestId('library-filter')).toHaveAttribute('aria-label', 'filter (1 on)')

    await page.getByTestId('library-filter').click()
    await expect(page.getByTestId('filter-saved')).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('filter-saved').click()
    await expect(page.getByTestId('library-filter')).toHaveAttribute('aria-label', 'filter')
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

  test('online, saved only in the filter menu narrows the library to saved songs and shows the count', async ({ page }) => {
    test.setTimeout(90000)
    const lib = new LibraryPage(page)

    await lib.goto()
    await lib.waitForSongs()
    const all = await libraryIds(page)
    expect(all.length).toBeGreaterThanOrEqual(3)
    await saveSongOffline(page, all[0])

    await expect(page.getByTestId('library-filter')).toHaveAttribute('aria-label', 'filter')
    await page.getByTestId('library-filter').click()
    await expect(page.getByTestId('filter-saved')).toContainText(/[1-9]\d* of \d+/)
    await page.getByTestId('filter-saved').click()
    await expect(page.getByTestId('library-filter')).toHaveAttribute('aria-label', 'filter (1 on)')
    await expect(lib.songById(all[0]).first()).toBeVisible()
    await expect(lib.songById(all[1])).toHaveCount(0)
    await page.getByTestId('filter-saved').click()
    await expect(lib.songById(all[1]).first()).toBeVisible()
  })

  test('the playlists view has no filter menu', async ({ page }) => {
    const lib = new LibraryPage(page)
    await lib.goto()
    await lib.waitForSongs()
    await expect(page.getByTestId('library-filter')).toBeVisible()
    await lib.goto('playlists')
    await expect(page).toHaveURL(/view=playlists/)
    await expect(page.getByTestId('library-filter')).toHaveCount(0)
  })
})
