import { routes } from './routes'
import { test, expect } from './fixtures/test'
import { login, apiLogin, API_V1 } from './helpers'
import { LibraryPage, PlayerBar } from './pages'

// Replacing a song's art on one device shows the new art on every device: the art URL
// carries the song's artwork_updated_at, so a replaced image is a new URL, not a cached one.

// A small JPEG: the API only checks the type and re-encodes it.
const JPEG = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z',
    'base64',
)

test('art replaced in one browser shows in another after it loads the library', async ({ page, browser }) => {
    const api = await apiLogin()
    const songs = await (await api.get(`${API_V1}/songs/library`)).json() as { uuid: string; owner_id: string | null }[]
    // The API lets only the owner (or an admin, for a song nobody owns) replace art.
    const mine = songs.find(s => s.owner_id === null)
    test.skip(!mine, 'no song in this library that anyone may replace the art of')
    const id = mine!.uuid
    const replace = async (): Promise<number> => {
        const res = await api.post(`${API_V1}/songs/${id}/artwork`, { multipart: { file: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: JPEG } } })
        expect(res.status(), await res.text()).toBe(200)
        const song = await (await api.get(`${API_V1}/songs/${id}`)).json() as { artwork_updated_at: number }
        return song.artwork_updated_at
    }
    const artSrc = (p: typeof page) => p.locator(`img[src*="/songs/${id}/artwork/thumb/"]`).first().getAttribute('src')

    const first = await replace()
    await login(page)
    await page.goto(routes.library)
    await new LibraryPage(page).waitForSongs()
    await expect.poll(() => artSrc(page), { timeout: 15000 }).toMatch(new RegExp(`/thumb/${first}$`))

    const second = await replace()
    expect(second).toBeGreaterThan(first)

    const other = await browser.newContext()
    const otherPage = await other.newPage()
    try {
        await login(otherPage)
        await otherPage.goto(routes.library)
        await new LibraryPage(otherPage).waitForSongs()
        await expect.poll(() => artSrc(otherPage), { timeout: 15000 }).toMatch(new RegExp(`/thumb/${second}$`))
        // The new art really is served at that URL, immutably.
        const img = await otherPage.request.get(`/v1/songs/${id}/artwork/thumb/${second}`)
        expect(img.status()).toBe(200)
        expect(img.headers()['cache-control']).toContain('immutable')
    } finally {
        await other.close()
    }
    await api.dispose()
})

test('art replaced while a song plays reaches the player bar without a reload', async ({ page }) => {
    const api = await apiLogin()
    try {
        const songs = await (await api.get(`${API_V1}/songs/library`)).json() as { uuid: string; owner_id: string | null; artwork_cached: boolean }[]
        const shared = songs.find(s => s.owner_id === null)
        test.skip(!shared, 'no song in this library that anyone may replace the art of')
        await login(page)
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        await lib.waitForSongs()
        // Play that very song, so the bar shows the art that is about to change.
        const card = lib.songById(shared!.uuid).first()
        await card.scrollIntoViewIfNeeded()
        await card.click()
        await player.waitForBar()
        const barArt = page.getByTestId('player-expand-art').locator('img').first()

        const up = await api.post(`${API_V1}/songs/${shared!.uuid}/artwork`, { multipart: { file: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: JPEG } } })
        expect(up.status(), await up.text()).toBe(200)
        const version = (await (await api.get(`${API_V1}/songs/${shared!.uuid}`)).json() as { artwork_updated_at: number }).artwork_updated_at
        // The editor tells the player; do the same here, as the editor does after its upload.
        await page.evaluate(({ songId, version }) => window.dispatchEvent(new CustomEvent('songbird:artwork-changed', { detail: { songId, version } })), { songId: shared!.uuid, version })

        await expect.poll(() => barArt.getAttribute('src'), { timeout: 10000 }).toMatch(new RegExp(`/songs/${shared!.uuid}/artwork/thumb/${version}$`))
    } finally {
        await api.dispose()
    }
})
