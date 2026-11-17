import { routes } from './routes'
import { test, expect } from './fixtures/test'
import { login } from './helpers'
import { BENCH_USER, BENCH_PASS } from './seed-bench'
import { LibraryPage } from './pages'
import { skipWithoutBench } from './bench-gate'

// Rows ask for the 200 px thumbnail, not the full image, at a url with the art version in it.
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

test('song art urls carry the song art version in the path, never a query string', async ({ page }) => {
    const lib = new LibraryPage(page)
    await login(page, BENCH_USER, BENCH_PASS)
    await page.goto(routes.library)
    await lib.waitForSongs()
    // A card shows an image only when the song's stored art loads; the fixture songs
    // can have none (it comes from a lookup the CI network may not answer).
    const img = page.locator('[data-testid="song-card"] img[src*="artwork"]').first()
    await img.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {})
    test.skip(await img.count() === 0, 'the fixture songs have no artwork in this environment')
    const src = decodeURIComponent((await img.getAttribute('src')) ?? '')
    expect(src).toMatch(/\/v1\/songs\/[^/]+\/artwork\/thumb\/\d+$/)
    expect(src).not.toContain('?')
})
