import { routes } from './routes'
import { test, expect } from './fixtures/test'
import { login } from './helpers'
import { BENCH_USER, BENCH_PASS } from './seed-bench'
import { LibraryPage } from './pages'
import { skipWithoutBench } from './bench-gate'

// Rows ask for the 200 px thumbnail, not the full image; a replaced image's new
// version is in the url after a reload.
skipWithoutBench()
test.use({ storageState: { cookies: [], origins: [] } })

test('the song list requests thumbnails only', async ({ page }) => {
    const lib = new LibraryPage(page)
    const art: string[] = []
    page.on('request', r => { const p = new URL(r.url()).pathname; if (/\/artwork\//.test(p)) art.push(p) })
    await login(page, BENCH_USER, BENCH_PASS)
    await page.goto(routes.library)
    await lib.waitForSongs()
    await page.waitForTimeout(2000)
    expect(art.length).toBeGreaterThan(0)
    expect(art.filter(p => p.endsWith('/full'))).toEqual([])
})

test('a replaced image shows after a reload', async ({ page }) => {
    const lib = new LibraryPage(page)
    await login(page, BENCH_USER, BENCH_PASS)
    await page.goto(routes.library)
    await lib.waitForSongs()
    // A card shows an image only when the song's stored art loads; the fixture songs
    // can have none (it comes from a lookup the CI network may not answer), and a card
    // without art shows the stand-in instead. Use the first card that does have art.
    const img = page.locator('[data-testid="song-card"] img[src*="artwork"]').first()
    await img.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {})
    test.skip(await img.count() === 0, 'the fixture songs have no artwork in this environment')
    const before = await img.getAttribute('src')
    const songId = /songs\/([^/]+)\/artwork/.exec(decodeURIComponent(before ?? ''))?.[1]
    expect(songId).toBeTruthy()
    await page.evaluate(id => localStorage.setItem('songbird-artwork-versions', JSON.stringify({ [id]: 3 })), songId!)
    await page.reload()
    await lib.waitForSongs()
    const after = await page.locator(`[data-testid="song-card"] img[src*="${songId}"]`).first().getAttribute('src')
    expect(decodeURIComponent(after ?? '')).toContain('artwork/thumb?v=3')
})
