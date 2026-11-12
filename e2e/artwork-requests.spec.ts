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
    const img = lib.songCards.first().locator('img').first()
    const before = await img.getAttribute('src')
    const songId = /songs\/([^/]+)\/artwork/.exec(decodeURIComponent(before ?? ''))?.[1]
    expect(songId).toBeTruthy()
    await page.evaluate(id => localStorage.setItem('songbird-artwork-versions', JSON.stringify({ [id]: 3 })), songId!)
    await page.reload()
    await lib.waitForSongs()
    const after = await lib.songCards.first().locator('img').first().getAttribute('src')
    expect(decodeURIComponent(after ?? '')).toContain('artwork/thumb?v=3')
})
