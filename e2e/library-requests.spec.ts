import { routes } from './routes'
import { test, expect } from './fixtures/test'
import { login, API_V1 } from './helpers'
import { BENCH_USER, BENCH_PASS } from './seed-bench'
import { LibraryPage } from './pages'
import { skipWithoutBench } from './bench-gate'

// How often the app asks the server for the whole library list (GET
// /v1/songs/library): once on a cold load, not again within five minutes, and
// not after a change made in the app.
skipWithoutBench()
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('whole-library requests', () => {
    let listRequests = 0
    test.beforeEach(async ({ page }) => {
        listRequests = 0
        page.on('request', r => { if (new URL(r.url()).pathname === '/v1/songs/library') listRequests++ })
        await login(page, BENCH_USER, BENCH_PASS)
        listRequests = 0
    })

    test('a cold load asks once', async ({ page }) => {
        const lib = new LibraryPage(page)
        await page.goto(routes.library)
        await lib.waitForSongs()
        await page.waitForTimeout(3000)
        expect(listRequests).toBe(1)
    })

    test('coming back to the library within five minutes does not ask again', async ({ page }) => {
        const lib = new LibraryPage(page)
        await page.goto(routes.library)
        await lib.waitForSongs()
        await page.waitForTimeout(1500)
        const before = listRequests
        await page.getByRole('link', { name: /explore/i }).first().click()
        await expect(page).toHaveURL(/explore/)
        await page.getByRole('link', { name: /library/i }).first().click()
        await lib.waitForSongs()
        await page.waitForTimeout(1500)
        expect(listRequests).toBe(before)
    })

    test('taking a song out of the library does not refetch the list', async ({ page }) => {
        const lib = new LibraryPage(page)
        await page.goto(routes.library)
        await lib.waitForSongs()
        await page.waitForTimeout(1500)
        const before = listRequests
        const card = lib.songCards.first()
        const songId = await card.getAttribute('data-song-id')
        expect(songId).toBeTruthy()
        await card.getByTestId('song-library-toggle').click()
        await expect(page.locator(`[data-song-id="${songId}"]`)).toHaveCount(0)
        await page.waitForTimeout(1500)
        expect(listRequests).toBe(before)
        // Put it back so the bench library stays at 1000 songs.
        const restored = await page.request.post(`${API_V1}/library/${songId}`)
        expect(restored.ok()).toBe(true)
    })
})

test.describe('slow library response', () => {
    type Row = { uuid: string; properties: Record<string, unknown> | null }

    // Opens the library once (so the device stores the list), then reloads with the
    // list request held until `release` is called.
    async function reloadWithHeldList(page: import('@playwright/test').Page, edit?: (rows: Row[]) => void) {
        const lib = new LibraryPage(page)
        await login(page, BENCH_USER, BENCH_PASS)
        await page.goto(routes.library)
        await lib.waitForSongs()
        await page.waitForTimeout(1500)

        let release!: () => void
        const gate = new Promise<void>(r => { release = r })
        await page.route('**/v1/songs/library', async route => {
            await gate
            const res = await route.fetch()
            const rows = await res.json() as Row[]
            edit?.(rows)
            await route.fulfill({ response: res, json: rows })
        })
        await page.reload()
        // The request is held; the stored copy is already on screen.
        await expect(lib.songCards.first()).toBeVisible({ timeout: 3000 })
        return { lib, release }
    }

    test('rows stored on the device show first, the fresh list replaces them', async ({ page }) => {
        const title = `Fresh ${Date.now()}`
        const { lib, release } = await reloadWithHeldList(page, rows => {
            const first = rows.find(r => r.properties)!
            first.properties = { ...first.properties!, trackName: title }
        })
        await expect(page.getByText(title)).toHaveCount(0)
        release()
        await expect(page.getByText(title).first()).toBeVisible({ timeout: 10000 })
        await expect(lib.songCards.first()).toBeVisible()
    })

    test('taking a song out while the stored rows show leaves the list whole, and the song gone', async ({ page }) => {
        const { lib, release } = await reloadWithHeldList(page)
        const card = lib.songCards.first()
        const songId = await card.getAttribute('data-song-id')
        expect(songId).toBeTruthy()
        const countBefore = await lib.songCards.count()
        await card.getByTestId('song-library-toggle').click()
        await expect(page.locator(`[data-song-id="${songId}"]`)).toHaveCount(0)
        // Not blanked: the other stored rows are still there.
        expect(await lib.songCards.count()).toBeGreaterThan(0)
        expect(await lib.songCards.count()).toBeLessThanOrEqual(countBefore)
        release()
        await page.waitForTimeout(2000)
        await expect(page.locator(`[data-song-id="${songId}"]`)).toHaveCount(0)
        await expect(lib.songCards.first()).toBeVisible()
        // Put it back so the bench library stays at 1000 songs.
        const restored = await page.request.post(`${API_V1}/library/${songId}`)
        expect(restored.ok()).toBe(true)
    })
})
