import { test, expect, Page } from '@playwright/test'
import { login, apiLogin, saveSongOffline, API_V1, OFFLINE_USERNAME, OFFLINE_PASSWORD } from '../e2e/helpers'
import { LibraryPage, CommonPage } from '../e2e/pages'
import { BROWSE_ARTWORK_CACHE, OFFLINE_ARTWORK_CACHE } from '../app/lib/artwork'

// Art saved for an offline song keeps showing across a version change: art saved before the
// release has no version in its url, and a replace gives the song a new one. These run on the
// production build, where the service worker answers art requests.

const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z',
  'base64',
)
const SAVED_ART = OFFLINE_ARTWORK_CACHE
const BROWSE_ART = BROWSE_ARTWORK_CACHE

test.describe('saved artwork across versions', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await login(page, OFFLINE_USERNAME, OFFLINE_PASSWORD)
  })

  // A library song anyone may replace the art of, given art and held offline.
  async function savedSongWithArt(page: Page): Promise<{ id: string; replace: () => Promise<number> }> {
    const lib = new LibraryPage(page)
    await lib.goto()
    // The page is kept for offline by the service worker once it controls the tab.
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await lib.waitForSongs()
    const res = await page.request.get(`${API_V1}/songs/library`)
    const songs = await res.json() as { uuid: string; owner_id: string | null }[]
    const mine = songs.find(s => s.owner_id === null)
    test.skip(!mine, 'no library song whose art may be replaced')
    const id = mine!.uuid
    const replace = async (): Promise<number> => {
      // The offline user may not replace the art of a shared song that has art (403); the admin may.
      const admin = await apiLogin()
      const up = await admin.post(`${API_V1}/songs/${id}/artwork`, { multipart: { file: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: JPEG } } })
      expect(up.status(), await up.text()).toBe(200)
      await admin.dispose()
      const song = await (await page.request.get(`${API_V1}/songs/${id}`)).json() as { artwork_updated_at: number }
      return song.artwork_updated_at
    }
    await replace()
    await page.reload()
    await lib.waitForSongs()
    await page.locator(`[data-song-id="${id}"]`).first().scrollIntoViewIfNeeded()
    await saveSongOffline(page, id)
    // Let the page's own art sync finish, so it cannot store anything after a test sets the scene.
    await expect.poll(async () => (await savedKeys(page)).filter(p => p.startsWith(`/v1/songs/${id}/artwork/`)).length, { timeout: 20000 }).toBeGreaterThan(1)
    await page.waitForTimeout(1500)
    return { id, replace }
  }

  const savedKeys = (page: Page) => page.evaluate(async name => {
    const cache = await caches.open(name)
    return (await cache.keys()).map(r => new URL(r.url).pathname)
  }, SAVED_ART)

  // What was seen while browsing would answer too: leave only the saved copies to be found.
  // The browser's own HTTP cache too: versioned art is immutable, so it would answer offline.
  async function forgetBrowsed(page: Page, id: string) {
    await page.evaluate(async ({ name, id }) => {
      const cache = await caches.open(name)
      for (const req of await cache.keys()) if (new URL(req.url).pathname.startsWith(`/v1/songs/${id}/artwork/`)) await cache.delete(req)
    }, { name: BROWSE_ART, id })
    await (await page.context().newCDPSession(page)).send('Network.clearBrowserCache')
    // setOffline does not reach the service worker's own fetches here, so cut the art route too.
    await page.context().route('**/v1/songs/*/artwork/**', route => route.abort('internetdisconnected'))
  }

  const artLoads = (page: Page, id: string) => expect.poll(() => page.evaluate(sel => {
    const img = document.querySelector<HTMLImageElement>(sel)
    return img ? img.complete && img.naturalWidth > 0 : false
  }, `img[src*="/songs/${id}/artwork/thumb/"]`), { timeout: 15000 }).toBe(true)

  test('art saved before versions existed (an unversioned url) shows offline after the upgrade', async ({ page, context }) => {
    test.setTimeout(90000)
    const { id } = await savedSongWithArt(page)
    // Make the saved store look as it did before the release: only unversioned copies.
    await page.evaluate(async ({ name, id }) => {
      const cache = await caches.open(name)
      for (const req of await cache.keys()) {
        const path = new URL(req.url).pathname
        if (!path.startsWith(`/v1/songs/${id}/artwork/`)) continue
        const res = await cache.match(req)
        await cache.delete(req)
        await cache.put(`/v1/songs/${id}/artwork/${path.split('/')[5]}`, res!)
      }
    }, { name: SAVED_ART, id })
    expect((await savedKeys(page)).filter(p => p.startsWith(`/v1/songs/${id}/artwork/`)).every(p => p.split('/').length === 6)).toBe(true)

    await forgetBrowsed(page, id)
    await new CommonPage(page).goOffline()
    await page.reload()
    await new LibraryPage(page).waitForSongs()
    await page.locator(`[data-song-id="${id}"]`).first().scrollIntoViewIfNeeded()

    await artLoads(page, id)
    await context.setOffline(false)
  })

  test('replaced art of a saved song is stored again and shows offline', async ({ page, context }) => {
    test.setTimeout(90000)
    const { id, replace } = await savedSongWithArt(page)
    const before = (await savedKeys(page)).filter(p => p.startsWith(`/v1/songs/${id}/artwork/`))
    expect(before.length).toBeGreaterThan(0)

    const version = await replace()
    await page.reload()
    await new LibraryPage(page).waitForSongs()

    // The page stores the new version, then drops the old ones.
    await expect.poll(async () => (await savedKeys(page)).filter(p => p.startsWith(`/v1/songs/${id}/artwork/`)).sort(), { timeout: 20000 })
      .toEqual([`/v1/songs/${id}/artwork/full/${version}`, `/v1/songs/${id}/artwork/thumb/${version}`])

    await forgetBrowsed(page, id)
    await new CommonPage(page).goOffline()
    await page.reload()
    await new LibraryPage(page).waitForSongs()
    await page.locator(`[data-song-id="${id}"]`).first().scrollIntoViewIfNeeded()
    await artLoads(page, id)
    await expect(page.locator(`img[src$="/songs/${id}/artwork/thumb/${version}"]`).first()).toBeAttached()
    await context.setOffline(false)
  })
})
