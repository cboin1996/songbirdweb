import { test, expect, Page } from '@playwright/test'
import { login, libraryIds, saveSongOffline, PREFETCH_USERNAME, OFFLINE_PASSWORD } from '../e2e/helpers'
import { LibraryPage, PlayerBar } from '../e2e/pages'

// While a song plays, the next one is fetched once into memory. Its own user: it plays,
// which writes the account's player state.
const ID = /\/v1\/download\/([0-9a-f-]{36})/

// Downloads the page asked for itself (fetch), as opposed to the audio element's own stream.
function recordAudioRequests(page: Page) {
  const fetched: string[] = []
  page.on('request', req => {
    const m = req.url().match(ID)
    if (!m) return
    if (req.resourceType() === 'fetch') fetched.push(m[1])
  })
  return { fetched }
}

test.describe('Next-track prefetch', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await login(page, PREFETCH_USERNAME, OFFLINE_PASSWORD)
  })

  test('the next song is fetched once while one plays, then plays from memory and is not saved', async ({ page }) => {
    test.setTimeout(90000)
    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    await lib.goto()
    await lib.waitForSongs()
    const ids = await libraryIds(page)
    expect(ids.length).toBeGreaterThanOrEqual(3)
    const { fetched } = recordAudioRequests(page)

    await lib.playAllBtn.click()
    await player.waitForBar()
    await expect.poll(() => fetched.filter(id => id === ids[1]).length, { timeout: 20000 }).toBe(1)
    await page.waitForTimeout(4000)
    expect(fetched.filter(id => id === ids[1])).toHaveLength(1)

    await player.next.click()
    await expect(player.playPause).toHaveAttribute('title', 'pause', { timeout: 15000 })
    // It plays from the held copy: the element ends up on a blob, and the page fetched it only once.
    await expect.poll(() => page.evaluate(() => document.querySelector('audio')?.src.startsWith('blob:') ?? false), { timeout: 10000 }).toBe(true)
    expect(fetched.filter(id => id === ids[1])).toHaveLength(1)

    // Held in memory only: it is not a saved song.
    const card = lib.songById(ids[1]).first()
    await card.scrollIntoViewIfNeeded()
    await card.hover()
    await lib.kebab(card).click()
    await expect(page.getByRole('button', { name: /^save offline/i })).toBeVisible()
    await page.mouse.click(5, 5)
  })

  test('a saved next song is not fetched ahead', async ({ page }) => {
    test.setTimeout(90000)
    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    await lib.goto()
    await lib.waitForSongs()
    const ids = await libraryIds(page)
    expect(ids.length).toBeGreaterThanOrEqual(3)
    await saveSongOffline(page, ids[1])
    const { fetched } = recordAudioRequests(page)

    await lib.playAllBtn.click()
    await player.waitForBar()
    // The one after the saved song is the next to be fetched, which shows the wait was long enough.
    await page.waitForTimeout(7000)
    expect(fetched.filter(id => id === ids[1])).toHaveLength(0)
    // Positive control: the prefetch does run in this same session. Moving on to the saved
    // song, the one after it (not saved) is fetched ahead.
    await player.next.click()
    await expect.poll(() => fetched.filter(id => id === ids[2]).length, { timeout: 20000 }).toBe(1)
  })

  test('pausing right after play does not stop or repeat the fetch of the next song', async ({ page }) => {
    test.setTimeout(90000)
    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    await lib.goto()
    await lib.waitForSongs()
    const ids = await libraryIds(page)
    expect(ids.length).toBeGreaterThanOrEqual(3)
    const { fetched } = recordAudioRequests(page)

    await lib.playAllBtn.click()
    await player.waitForBar()
    await expect(player.playPause).toHaveAttribute('title', 'pause', { timeout: 15000 })
    // Pause and play inside the wait before the fetch starts: neither restarts it.
    await player.playPause.click()
    await player.playPause.click()
    await player.playPause.click()
    await expect.poll(() => fetched.filter(id => id === ids[1]).length, { timeout: 20000 }).toBe(1)
    await page.waitForTimeout(4000)
    expect(fetched.filter(id => id === ids[1])).toHaveLength(1)
  })
})
