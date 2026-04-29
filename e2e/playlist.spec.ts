import { test, expect, APIRequestContext } from '@playwright/test'
import { login, apiLogin, uniq, purgePlaylistsByPrefix, pickFirstLibrarySong, API_V1 } from './helpers'

// Locks in current playlist behaviour observed at keebox-beta-1: create from
// the library playlists view, add songs via the song kebab → "Add to playlist",
// open the playlist modal, and delete it via the context menu. Cleans up
// e2e-prefixed playlists in afterAll so re-runs don't pile up state.

const PREFIX = 'e2e-pl'

let api: APIRequestContext

test.describe('playlists: create / add songs / delete', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeAll(async () => {
        api = await apiLogin()
        // Sweep stale playlists from earlier runs.
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

    test('create playlist via UI then verify via API', async ({ page }) => {
        const name = uniq(PREFIX)

        await page.goto('/library?view=playlists')
        await page.getByRole('button', { name: /new playlist/i }).click()
        await page.getByPlaceholder('playlist name').fill(name)
        await page.getByRole('button', { name: 'create', exact: true }).click()

        // API: confirm it exists (most reliable indicator that UI submitted)
        await expect.poll(async () => {
            const res = await api.get(`${API_V1}/playlists`)
            const playlists = await res.json()
            return playlists.some((p: any) => p.name === name)
        }, { timeout: 10000 }).toBe(true)

        // UI: tile with this playlist name should appear after refresh.
        await expect(page.getByText(name).first()).toBeVisible({ timeout: 10000 })
    })

    test('add a song to a playlist from the kebab menu', async ({ page }) => {
        const name = uniq(PREFIX)
        const created = await api.post(`${API_V1}/playlists`, { data: { name, icon: 'music' } })
        expect(created.ok()).toBe(true)
        const pl = await created.json()

        // pick a real library song
        const song = await pickFirstLibrarySong(api)
        test.skip(!song, 'library is empty — cannot test add-to-playlist')

        await page.goto('/library')
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })

        await card.hover()
        await card.getByTestId('song-kebab').click()
        const menu = page.getByTestId('song-kebab-menu')
        await expect(menu).toBeVisible()

        // expand the "Add to playlist" submenu and click our playlist
        await menu.getByRole('button', { name: 'Add to playlist' }).click()
        await menu.getByRole('button', { name, exact: true }).click()

        // confirm via API: playlist now has 1 song
        await expect.poll(async () => {
            const r = await api.get(`${API_V1}/playlists/${pl.id}/songs`)
            const songs = await r.json()
            return songs.length
        }, { timeout: 5000 }).toBe(1)
    })

    test('delete playlist via context menu', async ({ page }) => {
        const name = uniq(PREFIX)
        const created = await api.post(`${API_V1}/playlists`, { data: { name, icon: 'music' } })
        const pl = await created.json()

        await page.goto('/library?view=playlists')
        const tile = page.locator('button').filter({ hasText: name }).first()
        await expect(tile).toBeVisible({ timeout: 5000 })

        // playlists view uses a confirm() dialog — auto-accept it
        page.once('dialog', d => d.accept())
        await tile.click({ button: 'right' })
        await page.getByRole('button', { name: 'Delete', exact: true }).click()

        // Tile should disappear
        await expect(page.locator('button').filter({ hasText: name })).toHaveCount(0, { timeout: 5000 })

        // API confirms removal
        const r = await api.get(`${API_V1}/playlists/${pl.id}`)
        expect([404, 401, 403]).toContain(r.status())
    })

    test('rename playlist via context menu', async ({ page }) => {
        const original = uniq(PREFIX)
        const renamed = `${original}-renamed`
        const created = await api.post(`${API_V1}/playlists`, { data: { name: original, icon: 'music' } })
        const pl = await created.json()

        await page.goto('/library?view=playlists')
        const tile = page.locator('button').filter({ hasText: original }).first()
        await expect(tile).toBeVisible({ timeout: 5000 })

        await tile.click({ button: 'right' })
        await page.getByRole('button', { name: 'Rename', exact: true }).click()

        // Rename form opens inside the playlist modal
        const renameInput = page.locator('input[autoFocus], input').filter({ hasText: '' }).first()
        // The rename input is the modal's name field — match by current value
        const input = page.locator('input').filter({ has: page.locator(':scope') }).filter({ hasNotText: '' })
        // Simpler: find input with original value
        const namedInput = page.locator(`input[value="${original}"]`)
        await expect(namedInput).toBeVisible({ timeout: 3000 })
        await namedInput.fill(renamed)
        await page.getByRole('button', { name: 'save', exact: true }).click()

        // API confirms rename
        await expect.poll(async () => {
            const r = await api.get(`${API_V1}/playlists/${pl.id}`)
            if (!r.ok()) return ''
            const body = await r.json()
            return body.name
        }, { timeout: 5000 }).toBe(renamed)
    })
})
