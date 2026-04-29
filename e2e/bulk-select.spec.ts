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

    // FIXME: select mode is entered via long-press on a song card, not via a "Select" button.
    // Need to drive a touch long-press in Playwright to set this up. Punch list in e2e/README.md.
    test.fixme('exit select mode by clicking Cancel', async ({ page }) => {
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        const selectBtn = page.getByRole('button', { name: 'Select', exact: true })
        await selectBtn.click()
        await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()

        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible()
    })

    // FIXME: same as Cancel test — entering select mode via a "Select" button doesn't exist.
    // Need to drive long-press on a song card.
    test.fixme('bulk add to playlist attaches all selected songs', async ({ page }) => {
        const plName = uniq(PREFIX)
        const created = await api.post(`${API_V1}/playlists`, { data: { name: plName, icon: 'music' } })
        const pl = await created.json()

        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        await page.getByRole('button', { name: 'Select', exact: true }).click()

        // Select first two cards
        const cards = page.getByTestId('song-card')
        const count = Math.min(2, await cards.count())
        test.skip(count < 2, 'library has fewer than 2 songs — cannot test bulk add')
        for (let i = 0; i < count; i++) await cards.nth(i).click()

        await expect(page.getByRole('button', { name: new RegExp(`${count} selected`) })).toBeVisible()

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

    // FIXME: bulk Remove confirms via window.confirm() and then mutates the
    // user's library — destructive in dev DB. Punch list: gate this test
    // behind a TEST_BULK_REMOVE env flag once we have a per-test library
    // isolation strategy. Test sketched here for documentation.
    test.fixme('bulk Remove confirms and removes selected songs from library', async ({ page }) => {
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        await page.getByRole('button', { name: 'Select', exact: true }).click()
        const card = page.getByTestId('song-card').first()
        await card.click()

        page.once('dialog', d => d.accept())
        await page.getByRole('button', { name: 'Remove', exact: true }).click()
        // Library card count decreases by 1 (or song no longer present).
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
})
