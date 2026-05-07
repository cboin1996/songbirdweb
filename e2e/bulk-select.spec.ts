import { routes } from './routes'
import { test, expect, APIRequestContext } from '@playwright/test'
import { login, apiLoginAs, uniq, purgePlaylistsByPrefix, ignoreError, API_V1, BULK_USERNAME, BULK_PASSWORD } from './helpers'
import { LibraryPage } from './pages'

const PREFIX = 'e2e-bulk'

let api: APIRequestContext

test.describe('library bulk select', () => {
    test.describe.configure({ mode: 'serial' })
    test.use({ storageState: 'e2e/.auth/bulk-user.json' })

    test.beforeAll(async () => {
        api = await apiLoginAs(BULK_USERNAME, BULK_PASSWORD)
        await purgePlaylistsByPrefix(api, PREFIX)
    })

    test.afterAll(async () => {
        if (api) {
            await purgePlaylistsByPrefix(api, PREFIX)
            await api.dispose()
        }
    })

    test.beforeEach(async ({ page }) => {
        await login(page, BULK_USERNAME, BULK_PASSWORD)
    })

    test('Select button enters select mode and reveals bulk action bar', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()

        await lib.enterSelectMode()
        await expect(lib.cancelBtn).toBeVisible({ timeout: 3000 })
        await lib.songCards.first().click()
        await expect(lib.selectedCount()).toBeVisible({ timeout: 3000 })

        await expect(lib.bulkSaveOfflineBtn).toBeVisible()
        await expect(lib.bulkDownloadBtn).toBeVisible()
        await expect(lib.bulkRemoveBtn).toBeVisible()
    })

    test('exit select mode by clicking Cancel', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()

        await lib.enterSelectMode()
        await expect(lib.cancelBtn).toBeVisible({ timeout: 3000 })

        await lib.exitSelectMode()
        await expect(lib.selectBtn).toBeVisible({ timeout: 3000 })
    })

    test('bulk add to playlist attaches all selected songs', async ({ page }) => {
        const lib = new LibraryPage(page)
        const plName = uniq(PREFIX)
        const created = await api.post(`${API_V1}/playlists`, { data: { name: plName, icon: 'music' } })
        const pl = await created.json()

        await lib.goto()
        await lib.waitForSongs()

        await lib.enterSelectMode()

        const count = Math.min(3, await lib.songCards.count())
        test.skip(count < 3, 'library has fewer than 3 songs — cannot test bulk add')
        for (let i = 0; i < count; i++) await lib.songCards.nth(i).click()

        await expect(page.getByRole('button', { name: new RegExp(`${count} selected`) })).toBeVisible({ timeout: 3000 })

        await lib.bulkPlaylistBtn.click()
        await page.getByRole('button', { name: plName, exact: true }).click()

        await expect.poll(async () => {
            const r = await api.get(`${API_V1}/playlists/${pl.id}/songs`)
            const songs = await r.json()
            return songs.length
        }, { timeout: 5000 }).toBe(count)
    })

    test('bulk action bar exposes Save offline, Download, Remove, + Playlist', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()

        await lib.enterSelectMode()
        await lib.songCards.first().click()

        await expect(lib.bulkSaveOfflineBtn).toBeVisible()
        await expect(lib.bulkDownloadBtn).toBeVisible()
        await expect(lib.bulkRemoveBtn).toBeVisible()
        await expect(lib.bulkPlaylistBtn).toBeVisible()
    })

    test('selection count toggles accurately when clicking same card twice', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()

        await lib.enterSelectMode()
        await lib.songCards.first().click()
        await expect(lib.selectedCount()).toBeVisible({ timeout: 3000 })
        await lib.songCards.first().click()
        await expect(lib.cancelBtn).toBeVisible({ timeout: 3000 })
    })

    test('bulk Save offline button click produces no errors', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()

        await lib.enterSelectMode()
        await lib.songCards.first().click()
        await lib.bulkSaveOfflineBtn.click()
        await page.waitForTimeout(3000)

        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })

    test('bulk Download triggers a download for selected song', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()

        await lib.enterSelectMode()
        await lib.songCards.first().click()

        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 10000 }),
            lib.bulkDownloadBtn.click(),
        ])
        expect(download.suggestedFilename()).toBeTruthy()
    })

    test('Select all button is hidden until select mode is active', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()

        await expect(lib.selectAllBtn).not.toBeVisible()

        await lib.enterSelectMode()

        await expect(lib.selectAllBtn).toBeVisible()
    })

    test('Select all selects every visible song and bulk action bar appears', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()

        const totalSongs = await lib.songCards.count()
        test.skip(totalSongs === 0, 'library has no songs — cannot test select all')

        await lib.enterSelectMode()

        await lib.selectAllBtn.click()

        await expect(page.getByRole('button', { name: new RegExp(`${totalSongs} selected`) })).toBeVisible({ timeout: 3000 })

        await expect(lib.bulkSaveOfflineBtn).toBeVisible()
        await expect(lib.bulkDownloadBtn).toBeVisible()
        await expect(lib.bulkRemoveBtn).toBeVisible()

        await expect(lib.deselectAllBtn).toBeVisible()
    })

    test('Deselect all clears selection without exiting select mode', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()

        const totalSongs = await lib.songCards.count()
        test.skip(totalSongs === 0, 'library has no songs — cannot test deselect all')

        await lib.enterSelectMode()

        await lib.selectAllBtn.click()
        await expect(page.getByRole('button', { name: new RegExp(`${totalSongs} selected`) })).toBeVisible({ timeout: 3000 })

        await lib.deselectAllBtn.click()

        await expect(lib.bulkSaveOfflineBtn).not.toBeVisible()
        await expect(lib.bulkDownloadBtn).not.toBeVisible()
        await expect(lib.bulkRemoveBtn).not.toBeVisible()

        await expect(lib.selectAllBtn).toBeVisible()
        await expect(lib.cancelBtn).toBeVisible()
    })

    test('bulk Remove confirms and removes selected songs from library', async ({ page }) => {
        const lib = new LibraryPage(page)
        const baselineRes = await api.get(`${API_V1}/songs/library`)
        const baselineSongs = await baselineRes.json()
        const baseline = Array.isArray(baselineSongs) ? baselineSongs.length : 0
        test.skip(baseline < 2, 'library has fewer than 2 songs — cannot test bulk remove')

        await lib.goto()
        await lib.waitForSongs()

        await lib.enterSelectMode()

        const songIdLocators = page.locator('[data-song-id]')
        const uuidsToRemove: string[] = []
        for (let i = 0; i < 2; i++) {
            const id = await songIdLocators.nth(i).getAttribute('data-song-id')
            if (id) uuidsToRemove.push(id)
        }

        for (let i = 0; i < 2; i++) await lib.songCards.nth(i).click()
        await expect(page.getByRole('button', { name: /2 selected/i })).toBeVisible({ timeout: 3000 })

        page.once('dialog', d => d.accept())
        await Promise.all([
            page.waitForResponse(r => r.url().includes('/v1/library/bulk') && r.request().method() === 'DELETE'),
            lib.bulkRemoveBtn.click()
        ])

        const postRes = await api.get(`${API_V1}/songs/library`)
        const postSongs = await postRes.json()
        const postCount = Array.isArray(postSongs) ? postSongs.length : 0
        expect(postCount).toBe(baseline - 2)

        const remainingUuids = postSongs.map((s: any) => s.uuid)
        for (const uuid of uuidsToRemove) {
            expect(remainingUuids).not.toContain(uuid)
        }

        for (const uuid of uuidsToRemove) {
            await api.post(`${API_V1}/library/${uuid}`)
        }
    })
})
