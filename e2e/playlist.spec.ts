import { routes } from './routes'
import { test, expect, APIRequestContext } from '@playwright/test'
import { login, apiLogin, uniq, purgePlaylistsByPrefix, pickFirstLibrarySong, API_V1 } from './helpers'
import { LibraryPage } from './pages'

const PREFIX = 'e2e-pl'

let api: APIRequestContext

test.describe('playlists: create / add songs / delete', () => {
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

    test('create playlist via UI then verify via API', async ({ page }) => {
        const name = uniq(PREFIX)

        await page.goto(routes.libraryPlaylists)
        await page.getByRole('button', { name: /new playlist/i }).click()
        await page.getByPlaceholder('playlist name').fill(name)
        await page.getByRole('button', { name: 'create', exact: true }).click()

        await expect.poll(async () => {
            const res = await api.get(`${API_V1}/playlists`)
            const playlists = await res.json()
            return playlists.some((p: any) => p.name === name)
        }, { timeout: 10000 }).toBe(true)

        await expect(page.getByText(name).first()).toBeVisible({ timeout: 10000 })
    })

    test('add a song to a playlist from the kebab menu', async ({ page }) => {
        const lib = new LibraryPage(page)
        const name = uniq(PREFIX)
        const created = await api.post(`${API_V1}/playlists`, { data: { name, icon: 'music' } })
        expect(created.ok()).toBe(true)
        const pl = await created.json()

        const song = await pickFirstLibrarySong(api)
        test.skip(!song, 'library is empty — cannot test add-to-playlist')

        await lib.goto()
        const card = lib.songCards.first()
        await expect(card).toBeVisible({ timeout: 10000 })

        await card.hover()
        await lib.kebab(card).click()
        const menu = lib.kebabMenu()
        await expect(menu).toBeVisible()

        await menu.getByRole('button', { name: 'Add to playlist' }).click()
        await menu.getByRole('button', { name, exact: true }).click()

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

        page.once('dialog', d => d.accept())
        await tile.click({ button: 'right' })
        const contextMenu = page.getByTestId('context-menu').first()
        await expect(contextMenu).toBeVisible({ timeout: 3000 })
        await contextMenu.getByRole('button', { name: 'Delete', exact: true }).click()

        await expect(page.locator('button').filter({ hasText: name })).toHaveCount(0, { timeout: 5000 })

        const r = await api.get(`${API_V1}/playlists`)
        expect(r.ok()).toBe(true)
        const playlists = await r.json()
        expect(playlists.some((p: { id: string }) => p.id === pl.id)).toBe(false)
    })

    // === Tier 2 reorder + icon picker ===

    test('drag-reorder swaps two songs in a playlist (PATCH /songs)', async ({ page }) => {
        const name = uniq(PREFIX)
        const created = await api.post(`${API_V1}/playlists`, { data: { name, icon: 'music' } })
        const pl = await created.json()

        const libRes = await api.get(`${API_V1}/songs/library`)
        const lib = libRes.ok() ? await libRes.json() : []
        test.skip(!Array.isArray(lib) || lib.length < 2, 'need >=2 library songs to test reorder')
        const a = lib[0].uuid
        const b = lib[1].uuid
        await api.post(`${API_V1}/playlists/${pl.id}/songs`, { data: { song_uuid: a } })
        await api.post(`${API_V1}/playlists/${pl.id}/songs`, { data: { song_uuid: b } })

        const initial = await (await api.get(`${API_V1}/playlists/${pl.id}/songs`)).json()
        expect(initial[0].uuid).toBe(a)
        expect(initial[1].uuid).toBe(b)

        await page.goto(routes.libraryPlaylists)
        const tile = page.locator('button').filter({ hasText: name }).first()
        await expect(tile).toBeVisible({ timeout: 5000 })
        await tile.click()

        const rows = page.locator('[data-reorder-idx]')
        await expect(rows.first()).toBeVisible({ timeout: 5000 })
        const row0 = rows.nth(0)
        const row1 = rows.nth(1)
        const box0 = await row0.boundingBox()
        const box1 = await row1.boundingBox()
        if (!box0 || !box1) throw new Error('reorder rows not visible')

        const handle = row1.locator('span.cursor-grab').first()
        const handleBox = await handle.boundingBox()
        if (!handleBox) throw new Error('reorder handle not found')

        await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(box0.x + box0.width / 2, box0.y + 5, { steps: 8 })
        await page.mouse.up()

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

        const iconRow = page.getByTestId('icon-picker').first()
        const icons = iconRow.locator('button[type="button"]')
        const iconCount = await icons.count()
        expect(iconCount, 'icon picker should expose >=2 options').toBeGreaterThan(1)
        await icons.nth(1).click()

        await page.getByRole('button', { name: 'create', exact: true }).click()

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

        const namedInput = page.locator(`input[value="${original}"]`)
        await expect(namedInput).toBeVisible({ timeout: 3000 })
        await namedInput.fill(renamed)
        await page.getByRole('button', { name: 'save', exact: true }).click()

        await expect.poll(async () => {
            const r = await api.get(`${API_V1}/playlists`)
            if (!r.ok()) return ''
            const playlists = await r.json()
            const found = playlists.find((p: { id: string }) => p.id === pl.id)
            return found?.name ?? ''
        }, { timeout: 5000 }).toBe(renamed)
    })
})
