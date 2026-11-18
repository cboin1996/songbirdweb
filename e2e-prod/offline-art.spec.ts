import { test, expect, Page } from '@playwright/test'
import { login, libraryIds, saveSongOffline, OFFLINE_ART_USERNAME, OFFLINE_PASSWORD } from '../e2e/helpers'
import { LibraryPage, PlayerBar, CommonPage } from '../e2e/pages'
import { OFFLINE_ARTWORK_CACHE } from '../app/lib/artwork'

// Offline, art is the picture or the stand-in, never an empty white square.

// Every art image on the page has loaded; a failed one must have been replaced.
const brokenImages = (page: Page) => page.evaluate(() =>
  [...document.querySelectorAll('img')]
    .filter(img => img.getAttribute('src') && !(img.complete && img.naturalWidth > 0))
    .map(img => img.getAttribute('src')),
)

async function forgetAllArt(page: Page) {
  await page.evaluate(async () => {
    for (const name of await caches.keys()) if (name.includes('artwork')) await caches.delete(name)
  })
  await (await page.context().newCDPSession(page)).send('Network.clearBrowserCache')
  // The browser's own copies of immutable art would still answer; routing turns that cache off.
  await page.context().route(/\/(v1\/songs\/[^/]+\/artwork\/|_next\/image)/, route => route.abort('internetdisconnected'))
}

test.describe('offline artwork is never a white square', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await login(page, OFFLINE_ART_USERNAME, OFFLINE_PASSWORD)
  })

  test('saved songs whose art is not stored show the stand-in, in the list and the player', async ({ page, context }) => {
    test.setTimeout(120000)
    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    const common = new CommonPage(page)

    await lib.goto()
    // The page is kept for offline by the service worker once it controls the tab.
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await lib.waitForSongs()
    const all = await libraryIds(page)
    const ids = [all[0], all[2]]
    for (const id of ids) await saveSongOffline(page, id)

    const queueSaved = page.waitForResponse(
      r => r.url().includes('/v1/player/state') && r.request().method() === 'PUT' && r.ok(),
      { timeout: 20000 },
    )
    await lib.playAllBtn.click()
    await player.waitForBar()
    await player.waitForTrackName()
    await player.playPause.click()
    await expect(player.playPause).toHaveAttribute('title', 'play')
    await queueSaved

    // The art of every saved song was never stored: what an old save, a trimmed cache
    // or a new device looks like.
    await forgetAllArt(page)
    await context.setOffline(true)
    await page.reload()
    await player.waitForBar()
    await player.waitForTrackName(15000)
    await lib.waitForSongs()
    for (const id of ids) await lib.songById(id).first().scrollIntoViewIfNeeded()
    await page.waitForTimeout(1500)
    expect(await brokenImages(page), 'images that did not load and were not replaced').toEqual([])

    await expect(player.next).toBeEnabled({ timeout: 10000 })
    await player.next.click()
    await page.waitForTimeout(1500)
    expect(await brokenImages(page), 'after advancing offline').toEqual([])
    await context.setOffline(false)
  })

  // The lock screen fetches its art itself and cannot reach the service worker, so offline
  // it is given blob: copies of what the device stored, or no art entry at all.
  const lockScreenArt = (page: Page) => page.evaluate(() =>
    (navigator.mediaSession.metadata?.artwork ?? []).map(a => a.src),
  )

  async function playOneSavedPaused(page: Page) {
    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    await lib.goto()
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await lib.waitForSongs()
    const id = (await libraryIds(page))[0]
    await saveSongOffline(page, id)
    const queueSaved = page.waitForResponse(
      r => r.url().includes('/v1/player/state') && r.request().method() === 'PUT' && r.ok(),
      { timeout: 20000 },
    )
    await lib.playAllBtn.click()
    await player.waitForBar()
    await player.waitForTrackName()
    await player.playPause.click()
    await expect(player.playPause).toHaveAttribute('title', 'play')
    await queueSaved
    return player
  }

  test('offline, the lock screen gets blob copies of stored art', async ({ page, context }) => {
    test.setTimeout(120000)
    const player = await playOneSavedPaused(page)
    await context.setOffline(true)
    await page.reload()
    await player.waitForBar()
    await player.waitForTrackName(15000)
    await expect.poll(() => lockScreenArt(page), { timeout: 15000 }).not.toEqual([])
    for (const src of await lockScreenArt(page)) expect(src).toMatch(/^blob:/)
    await context.setOffline(false)
  })

  test('offline with no art stored, the lock screen gets the stored music note, not a blank tile', async ({ page, context }) => {
    test.setTimeout(120000)
    const player = await playOneSavedPaused(page)
    await forgetAllArt(page)
    await context.setOffline(true)
    await page.reload()
    await player.waitForBar()
    await player.waitForTrackName(15000)
    // The note is stored with the app's pages, so it is there with every song's art forgotten.
    const art = () => page.evaluate(() => (navigator.mediaSession.metadata?.artwork ?? []).map(a => ({ src: a.src, type: a.type })))
    await expect.poll(art, { timeout: 15000 }).toHaveLength(1)
    const [note] = await art()
    expect(note.type).toBe('image/png')
    expect(note.src).toMatch(/^blob:/)
    await context.setOffline(false)
  })

  // Browsing stores the thumbnail only; the large image of a song that plays, and of the
  // next one, is stored too, so the expanded player and the lock screen have it offline.
  test('playing online stores the large art of the playing and the next song', async ({ page }) => {
    test.setTimeout(120000)
    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    // The seeded songs have no art file on the API, so the image is answered here (the service worker's requests included).
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
    await page.context().route(/\/v1\/songs\/[^/]+\/artwork\//, route => route.fulfill({ status: 200, contentType: 'image/png', body: png }))
    await lib.goto()
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await lib.waitForSongs()
    await page.evaluate(async () => {
      for (const name of await caches.keys()) if (name.includes('artwork')) await caches.delete(name)
    })
    await lib.playAllBtn.click()
    await player.waitForBar()
    await player.waitForTrackName()
    const large = () => page.evaluate(async () => {
      const urls: string[] = []
      for (const name of await caches.keys()) {
        if (!name.includes('artwork')) continue
        for (const r of await (await caches.open(name)).keys()) urls.push(new URL(r.url).pathname + new URL(r.url).search)
      }
      return urls.filter(u => u.includes('/artwork/full/') || u.includes('600x600bb')).length
    })
    await expect.poll(large, { timeout: 15000 }).toBeGreaterThanOrEqual(2)
  })

  // A save whose art fetch was lost leaves audio with no art. The cache check finds it and puts it back.
  test('check cache health finds a saved song with no art and restores it', async ({ page }) => {
    test.setTimeout(120000)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
    await page.context().route(/\/v1\/songs\/[^/]+\/artwork\//, route => route.fulfill({ status: 200, contentType: 'image/png', body: png }))
    const lib = new LibraryPage(page)
    await lib.goto()
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await lib.waitForSongs()
    await saveSongOffline(page, (await libraryIds(page))[0])
    await page.evaluate(async name => { await caches.delete(name) }, OFFLINE_ARTWORK_CACHE)

    await page.goto('/settings')
    await page.getByRole('button', { name: 'check cache health' }).click()
    await expect(page.getByText(/missing art/)).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: /fix \d+ file/ }).click()
    await expect(page.getByText('all clear')).toBeVisible({ timeout: 30000 })
  })

  // Pause and play run the lock-screen sync again; the art must stay. Every write to the
  // lock-screen metadata is recorded: a sync that rebuilds it (even with the same art)
  // blinks the art on a real phone, so after the first fill there must be none.
  test('offline, pausing and playing does not rewrite the lock-screen metadata', async ({ page, context }) => {
    test.setTimeout(120000)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
    const fulfil = (route: import('@playwright/test').Route) => route.fulfill({ status: 200, contentType: 'image/png', body: png })
    await context.route(/\/v1\/songs\/[^/]+\/artwork\//, fulfil)
    await context.addInitScript(() => {
      const w = window as unknown as { __metaWrites: number[] }
      w.__metaWrites = []
      const desc = Object.getOwnPropertyDescriptor(MediaSession.prototype, 'metadata')
      if (!desc?.set) return
      Object.defineProperty(MediaSession.prototype, 'metadata', {
        ...desc,
        set(v: MediaMetadata | null) { w.__metaWrites.push(v ? v.artwork.length : -1); desc.set!.call(this, v) },
      })
    })
    const player = await playOneSavedPaused(page)
    await context.unroute(/\/v1\/songs\/[^/]+\/artwork\//, fulfil) // offline must not be answered by the test
    await context.setOffline(true)
    await page.reload()
    await player.waitForBar()
    await player.waitForTrackName(15000)
    await expect.poll(() => lockScreenArt(page), { timeout: 15000 }).not.toEqual([])
    const writes = () => page.evaluate(() => (window as unknown as { __metaWrites: number[] }).__metaWrites.length)
    const settled = await writes()
    for (let i = 0; i < 3; i++) {
      await player.playPause.click()
      await page.waitForTimeout(1000)
    }
    expect(await writes()).toBe(settled)
    expect(await lockScreenArt(page)).not.toEqual([])
    await context.setOffline(false)
  })
})
