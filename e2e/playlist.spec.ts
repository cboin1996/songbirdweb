import { routes } from './routes'
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

        await page.goto(routes.libraryPlaylists)
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

        await page.goto(routes.library)
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

        await page.goto(routes.libraryPlaylists)
        const tile = page.locator('button').filter({ hasText: name }).first()
        await expect(tile).toBeVisible({ timeout: 5000 })

        // confirm() auto-accept
        page.once('dialog', d => d.accept())
        await tile.click({ button: 'right' })
        // Scope Delete to the context-menu portal (rounded-lg shadow-xl py-1 fixed div)
        // to avoid collisions with the modal's Delete button if any other test left it open.
        const contextMenu = page.locator('div.fixed.z-50.shadow-xl').first()
        await expect(contextMenu).toBeVisible({ timeout: 3000 })
        await contextMenu.getByRole('button', { name: 'Delete', exact: true }).click()

        // Tile should disappear
        await expect(page.locator('button').filter({ hasText: name })).toHaveCount(0, { timeout: 5000 })

        // API confirms removal
        const r = await api.get(`${API_V1}/playlists/${pl.id}`)
        expect([404, 401, 403]).toContain(r.status())
    })

    // === Tier 2 reorder + icon picker ===

    test('drag-reorder swaps two songs in a playlist (PATCH /songs)', async ({ page }) => {
        const name = uniq(PREFIX)
        const created = await api.post(`${API_V1}/playlists`, { data: { name, icon: 'music' } })
        const pl = await created.json()

        // Get two library song UUIDs and add them via API to control initial order.
        const libRes = await api.get(`${API_V1}/songs/library`)
        const lib = libRes.ok() ? await libRes.json() : []
        test.skip(!Array.isArray(lib) || lib.length < 2, 'need >=2 library songs to test reorder')
        const a = lib[0].uuid
        const b = lib[1].uuid
        await api.post(`${API_V1}/playlists/${pl.id}/songs`, { data: { song_uuid: a } })
        await api.post(`${API_V1}/playlists/${pl.id}/songs`, { data: { song_uuid: b } })

        // Verify initial order
        const initial = await (await api.get(`${API_V1}/playlists/${pl.id}/songs`)).json()
        expect(initial[0].uuid).toBe(a)
        expect(initial[1].uuid).toBe(b)

        // Open modal
        await page.goto(routes.libraryPlaylists)
        const tile = page.locator('button').filter({ hasText: name }).first()
        await expect(tile).toBeVisible({ timeout: 5000 })
        await tile.click()

        // Modal opens with reorder handles. Drag song-2 above song-1.
        const rows = page.locator('[data-reorder-idx]')
        await expect(rows.first()).toBeVisible({ timeout: 5000 })
        const row0 = rows.nth(0)
        const row1 = rows.nth(1)
        const box0 = await row0.boundingBox()
        const box1 = await row1.boundingBox()
        if (!box0 || !box1) throw new Error('reorder rows not visible')

        // Drag handle on row1 (the FaBars span). The handle is the first
        // child span with class cursor-grab. Drag it to above row0.
        const handle = row1.locator('span.cursor-grab').first()
        const handleBox = await handle.boundingBox()
        if (!handleBox) throw new Error('reorder handle not found')

        // Manual pointer drag (handle uses onPointerDown).
        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
        await page.mouse.down()
        // Move into row0's area in steps so the drop-target detector picks it up.
        await page.mouse.move(box0.x + box0.width / 2, box0.y + 5, { steps: 8 })
        await page.mouse.up()

        // API confirms swap
        await expect.poll(async () => {
            const r = await api.get(`${API_V1}/playlists/${pl.id}/songs`)
            const songs = await r.json()
            return songs[0]?.uuid === b && songs[1]?.uuid === a
        }, { timeout: 5000 }).toBe(true)
    })

    test('icon picker: creating a playlist with non-default icon stores the choice', async ({ page }) => {
        const name = uniq(PREFIX)

        await page.goto(routes.libraryPlaylists)
        await page.getByRole('button', { name: /new playlist/i }).click()
        await page.getByPlaceholder('playlist name').fill(name)

        // Icon buttons render after expanding the form. Click the second icon
        // (index 1 — `headphones`) which differs from the default `music`.
        // The IconPicker buttons sit right under the input/create row.
        // Cheap stable selector: pick by SVG title via locator-by-button-with-icon.
        // The icon picker buttons have no labels. Identify via order under the form.
        const formRoot = page.locator('form').filter({ has: page.getByPlaceholder('playlist name') })
        const iconButtons = formRoot.locator('button[type="button"]').filter({ hasNotText: /create/i })
        // Skip the cancel (X) button; pick second icon button by index 2 (after [cancel-X, music, headphones, ...])
        // Actually structure: cancel-X is before iconpicker. Icon picker is its own div with 10 buttons.
        // Safer: scope to the IconPicker (flex flex-wrap gap-1 div).
        const iconRow = formRoot.locator('div.flex.flex-wrap')
        const icons = iconRow.locator('button[type="button"]')
        const iconCount = await icons.count()
        expect(iconCount, 'icon picker should expose >=2 options').toBeGreaterThan(1)
        await icons.nth(1).click() // pick the second icon (headphones)

        await page.getByRole('button', { name: 'create', exact: true }).click()

        // API confirms persisted icon != 'music'
        await expect.poll(async () => {
            const r = await api.get(`${API_V1}/playlists`)
            const playlists = r.ok() ? await r.json() : []
            const pl = playlists.find((p: any) => p.name === name)
            return pl?.icon
        }, { timeout: 5000 }).toBe('headphones')
    })

    test('rename playlist via context menu', async ({ page }) => {
        const original = uniq(PREFIX)
        const renamed = `${original}-renamed`
        const created = await api.post(`${API_V1}/playlists`, { data: { name: original, icon: 'music' } })
        const pl = await created.json()

        await page.goto(routes.libraryPlaylists)
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
