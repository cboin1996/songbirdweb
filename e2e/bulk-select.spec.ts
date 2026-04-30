import { routes } from './routes'
import { test, expect, APIRequestContext } from '@playwright/test'
import { login, apiLogin, uniq, purgePlaylistsByPrefix, API_V1 } from './helpers'

// Locks in the multi-select toolbar at keebox-beta-1: the fixed top-right
// "Select" button, the bulk action bar, and the "+ Playlist" attach action.
// Bulk save-offline is the original target but actually downloading audio in
// CI is heavy — we instead verify the bulk add-to-playlist path which covers
// the same selection plumbing without writing files to disk.

const PREFIX = 'e2e-bulk'

let api: APIRequestContext

test.describe('library bulk select', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeAll(async () => {
        api = await apiLogin()
        await purgePlaylistsByPrefix(api, PREFIX)
    })

    test.afterAll(async () => {
        if (api) {
            await purgePlaylistsByPrefix(api, PREFIX)
            await api.dispose()
        }
    })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Select button enters select mode and reveals bulk action bar', async ({ page }) => {
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        await page.getByRole('button', { name: 'Select', exact: true }).click()
        // After entering select mode, button label flips — and clicking a card
        // selects rather than plays.
        const firstCard = page.getByTestId('song-card').first()
        await firstCard.click()
        await expect(page.getByRole('button', { name: /1 selected/i })).toBeVisible({ timeout: 3000 })

        // Bulk action bar should appear with Save offline + Download
        await expect(page.getByRole('button', { name: 'Save offline', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeVisible()
    })

    test('exit select mode by clicking Cancel', async ({ page }) => {
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        const selectBtn = page.getByRole('button', { name: 'Select', exact: true })
        await selectBtn.click()
        await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible({ timeout: 3000 })

        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible({ timeout: 3000 })
    })

    test('bulk add to playlist attaches all selected songs', async ({ page }) => {
        const plName = uniq(PREFIX)
        const created = await api.post(`${API_V1}/playlists`, { data: { name: plName, icon: 'music' } })
        const pl = await created.json()

        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        await page.getByRole('button', { name: 'Select', exact: true }).click()

        // Select first 3 cards
        const cards = page.getByTestId('song-card')
        const count = Math.min(3, await cards.count())
        test.skip(count < 3, 'library has fewer than 3 songs — cannot test bulk add')
        for (let i = 0; i < count; i++) await cards.nth(i).click()

        await expect(page.getByRole('button', { name: new RegExp(`${count} selected`) })).toBeVisible({ timeout: 3000 })

        // Open the playlist picker and pick our test playlist
        await page.getByRole('button', { name: '+ Playlist' }).click()
        await page.getByRole('button', { name: plName, exact: true }).click()

        // API confirms playlist now has `count` songs
        await expect.poll(async () => {
            const r = await api.get(`${API_V1}/playlists/${pl.id}/songs`)
            const songs = await r.json()
            return songs.length
        }, { timeout: 5000 }).toBe(count)
    })

    // === Tier 2 bulk action visibility ===
    // The bulk action bar surfaces Save offline / Download / Remove / + Playlist.
    // Actually invoking these in CI is heavy (audio downloads, filesystem
    // writes, library mutation) — instead we lock in that all four buttons
    // appear/disappear correctly with selection state.

    test('bulk action bar exposes Save offline, Download, Remove, + Playlist', async ({ page }) => {
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        await page.getByRole('button', { name: 'Select', exact: true }).click()
        const card = page.getByTestId('song-card').first()
        await card.click()

        await expect(page.getByRole('button', { name: 'Save offline', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: '+ Playlist' })).toBeVisible()
    })

    test('selection count toggles accurately when clicking same card twice', async ({ page }) => {
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        await page.getByRole('button', { name: 'Select', exact: true }).click()
        const card = page.getByTestId('song-card').first()
        await card.click()
        await expect(page.getByRole('button', { name: /1 selected/i })).toBeVisible({ timeout: 3000 })
        // Click again → deselected, label flips back to "Cancel".
        await card.click()
        await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible({ timeout: 3000 })
    })

    // FIXME: bulk Save offline downloads each track and writes to IndexedDB —
    // produces network traffic and can hang in CI. Functionality test belongs
    // behind a dedicated env-gated suite. Documents the visible-button path.
    test.fixme('bulk Save offline triggers cache writes for selected songs', async ({ page }) => {
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        await page.getByRole('button', { name: 'Select', exact: true }).click()
        await page.getByTestId('song-card').first().click()
        await page.getByRole('button', { name: 'Save offline', exact: true }).click()
        // Would need to assert IndexedDB contents or song-card cached badge.
    })

    // FIXME: bulk Download opens browser save dialog per song — Playwright
    // download interception is feasible but adds CI complexity. Sketch here.
    test.fixme('bulk Download triggers a download per selected song', async ({ page }) => {
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        await page.getByRole('button', { name: 'Select', exact: true }).click()
        await page.getByTestId('song-card').first().click()
        await page.getByRole('button', { name: 'Download', exact: true }).click()
        // Would assert page.waitForEvent('download') count.
    })

    test('Select all button is hidden until select mode is active', async ({ page }) => {
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        // Before entering select mode, "Select all" button should not exist
        await expect(page.getByRole('button', { name: /select all/i })).not.toBeVisible()

        // Enter select mode
        await page.getByRole('button', { name: 'Select', exact: true }).click()

        // Now "Select all" button should be visible
        await expect(page.getByRole('button', { name: /select all/i })).toBeVisible()
    })

    test('Select all selects every visible song and bulk action bar appears', async ({ page }) => {
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        // Get total visible song count
        const totalSongs = await page.getByTestId('song-card').count()
        test.skip(totalSongs === 0, 'library has no songs — cannot test select all')

        // Enter select mode
        await page.getByRole('button', { name: 'Select', exact: true }).click()

        // Click "Select all"
        await page.getByRole('button', { name: /select all/i }).click()

        // Verify all songs are selected by checking the count button
        await expect(page.getByRole('button', { name: new RegExp(`${totalSongs} selected`) })).toBeVisible({ timeout: 3000 })

        // Verify bulk action bar appears
        await expect(page.getByRole('button', { name: 'Save offline', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeVisible()

        // Verify button text changed to "Deselect all"
        await expect(page.getByRole('button', { name: /deselect all/i })).toBeVisible()
    })

    test('Deselect all clears selection without exiting select mode', async ({ page }) => {
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        const totalSongs = await page.getByTestId('song-card').count()
        test.skip(totalSongs === 0, 'library has no songs — cannot test deselect all')

        // Enter select mode
        await page.getByRole('button', { name: 'Select', exact: true }).click()

        // Click "Select all"
        await page.getByRole('button', { name: /select all/i }).click()
        await expect(page.getByRole('button', { name: new RegExp(`${totalSongs} selected`) })).toBeVisible({ timeout: 3000 })

        // Click "Deselect all"
        await page.getByRole('button', { name: /deselect all/i }).click()

        // Verify no songs are selected — bulk action bar should disappear
        await expect(page.getByRole('button', { name: 'Save offline', exact: true })).not.toBeVisible()
        await expect(page.getByRole('button', { name: 'Download', exact: true })).not.toBeVisible()
        await expect(page.getByRole('button', { name: 'Remove', exact: true })).not.toBeVisible()

        // Verify we're still in select mode (Cancel button or Select all should still be visible)
        await expect(page.getByRole('button', { name: /select all/i })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
    })

    test('bulk Remove confirms and removes selected songs from library', async ({ page }) => {
        // Get baseline library count via API
        const baselineRes = await api.get(`${API_V1}/songs/library`)
        const baselineSongs = await baselineRes.json()
        const baseline = Array.isArray(baselineSongs) ? baselineSongs.length : 0
        test.skip(baseline < 2, 'library has fewer than 2 songs — cannot test bulk remove')

        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        await page.getByRole('button', { name: 'Select', exact: true }).click()

        // Capture the UUIDs of the first 2 RENDERED cards (not API order;
        // /library sorts alphabetically). data-song-id is on the wrapper
        // around each Song component.
        const songIdLocators = page.locator('[data-song-id]')
        const uuidsToRemove: string[] = []
        for (let i = 0; i < 2; i++) {
            const id = await songIdLocators.nth(i).getAttribute('data-song-id')
            if (id) uuidsToRemove.push(id)
        }

        // Select first 2 cards
        const cards = page.getByTestId('song-card')
        for (let i = 0; i < 2; i++) await cards.nth(i).click()
        await expect(page.getByRole('button', { name: /2 selected/i })).toBeVisible({ timeout: 3000 })

        // Handle confirm dialog and click Remove — wait for API response deterministically.
        // Match by path, not full URL: requests are proxied through Next on
        // :3000 so r.url() won't include the absolute API_V1 origin.
        page.once('dialog', d => d.accept())
        const removeBtn = page.getByRole('button', { name: 'Remove', exact: true })
        await Promise.all([
            page.waitForResponse(r => r.url().includes('/v1/library/bulk') && r.request().method() === 'DELETE'),
            removeBtn.click()
        ])

        // Verify post-remove count
        const postRes = await api.get(`${API_V1}/songs/library`)
        const postSongs = await postRes.json()
        const postCount = Array.isArray(postSongs) ? postSongs.length : 0
        expect(postCount).toBe(baseline - 2)

        // Verify the specific UUIDs are gone
        const remainingUuids = postSongs.map((s: any) => s.uuid)
        for (const uuid of uuidsToRemove) {
            expect(remainingUuids).not.toContain(uuid)
        }

        // Cleanup: re-add the removed songs
        for (const uuid of uuidsToRemove) {
            await api.post(`${API_V1}/library/${uuid}`)
        }
    })
})
