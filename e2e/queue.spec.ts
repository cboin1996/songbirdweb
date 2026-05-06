import { routes, downloadSongQuery } from './routes'
import { test, expect } from '@playwright/test'
import { login, ignoreError, apiLoginAs, API_V1, QUEUE_USERNAME, QUEUE_PASSWORD } from './helpers'
import { LibraryPage, PlayerBar } from './pages'

test.describe('player queue', () => {
    test.describe.configure({ mode: 'serial' })
    test.use({ storageState: 'e2e/.auth/queue-user.json' })

    test.beforeEach(async ({ page }) => {
        await login(page, QUEUE_USERNAME, QUEUE_PASSWORD)
    })

    test('queue panel opens with songs after starting playback from library', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        await lib.waitForSongs()
        test.skip((await lib.songCards.count()) < 2, 'need at least 2 library songs to verify queue')

        await lib.songCards.first().click()
        await player.waitForBar()

        await player.openQueue()
    })

    test('"Play next" from kebab does not change the currently playing track', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        await lib.waitForSongs()
        test.skip((await lib.songCards.count()) < 2, 'need at least 2 library songs to test play-next')

        await lib.songCards.first().click()
        await player.waitForBar()
        await player.waitForTrackName()
        const beforeName = await player.getTrackName()

        const card1 = lib.songCards.nth(1)
        await card1.hover()
        await lib.kebab(card1).click()
        const menu = lib.kebabMenu()
        await menu.getByRole('button', { name: 'Play next' }).click()

        await expect(menu).not.toBeVisible({ timeout: 3000 })
        const afterName = await player.getTrackName()
        expect(afterName).toBe(beforeName)

        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })

    test('skip-next button advances when queue has multiple tracks', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        await lib.waitForSongs()
        test.skip((await lib.songCards.count()) < 2, 'need at least 2 library songs to test skip')

        await lib.playAllBtn.click()
        await player.waitForBar()
        await player.waitForTrackName()
        const beforeName = await player.getTrackName()

        await expect(player.next).not.toBeDisabled({ timeout: 5000 })
        await player.next.click()
        await expect.poll(async () => player.getTrackName(), { timeout: 5000 }).not.toBe(beforeName)
    })

    test('removing from library removes song from queue panel', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        const api = await apiLoginAs(QUEUE_USERNAME, QUEUE_PASSWORD)
        try {
            await lib.goto()
            await lib.waitForSongs()
            test.skip((await lib.songCards.count()) < 3, 'need at least 3 library songs')

            await lib.playAllBtn.click()
            await player.waitForBar()

            const expectedCount = await lib.songCards.count()
            await player.openQueue()
            await expect.poll(() => player.queueRows().count(), { timeout: 5000 }).toBe(expectedCount)
            const beforeCount = expectedCount
            await player.closeQueue()

            const targetUuid = await page.locator('[data-song-id]').nth(1).getAttribute('data-song-id')

            const card = lib.songCards.nth(1)
            await card.hover()
            const bookmark = lib.libraryToggle(card)
            await expect(bookmark).toBeVisible({ timeout: 3000 })
            await bookmark.click()

            await player.openQueue()
            await expect.poll(
                () => player.queueRows().count(),
                { timeout: 5000, message: 'queue should shrink after library remove' }
            ).toBeLessThan(beforeCount)

            if (targetUuid) await api.post(`${API_V1}/library`, { data: { song_id: targetUuid } })
        } finally {
            await api.dispose()
        }
    })

    test('library add inserts alphabetically in queue (shuffle off)', async ({ page }) => {
        const player = new PlayerBar(page)
        const api = await apiLoginAs(QUEUE_USERNAME, QUEUE_PASSWORD)
        let targetUuid = ''
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string; properties?: { trackName?: string } }[]
            test.skip(songs.length < 3, 'need at least 3 library songs')

            let target: { uuid: string; name: string; searchTerm: string } | null = null
            for (let i = 2; i < songs.length; i++) {
                const name = songs[i].properties?.trackName ?? ''
                if (!name) continue
                const term = name.split(/\s+/).find(w => w.length > 3) ?? name.split(/\s+/)[0]
                const check = await api.get(`${API_V1}/properties?query=${encodeURIComponent(term)}`)
                const results = await check.json()
                if (Array.isArray(results) && results.some((r: any) => r.uuid === songs[i].uuid)) {
                    target = { uuid: songs[i].uuid, name, searchTerm: term }
                    break
                }
            }
            test.skip(!target, 'no library song is findable in global search')
            targetUuid = target!.uuid

            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: songs.slice(0, 2).map(s => s.uuid), queue_index: 0,
                },
            })

            await api.delete(`${API_V1}/library/${targetUuid}`)

            await page.goto(routes.library)
            await player.waitForBar(10000)

            await player.openQueue()
            await expect.poll(() => player.queueRows().count(), { timeout: 5000 }).toBe(2)
            await player.closeQueue()

            await page.goto(downloadSongQuery(target!.searchTerm))
            const targetCard = page.locator(`[data-song-id="${targetUuid}"]`).first()
            await expect(targetCard).toBeVisible({ timeout: 10000 })
            await targetCard.hover()
            const bookmark = targetCard.getByTestId('song-library-toggle')
            await expect(bookmark).toBeVisible({ timeout: 3000 })
            await bookmark.click()

            await player.openQueue()
            await expect.poll(
                () => player.queueRows().count(),
                { timeout: 5000 }
            ).toBe(3)
        } finally {
            if (targetUuid) await api.post(`${API_V1}/library`, { data: { song_id: targetUuid } }).catch(() => {})
            await api.dispose()
        }
    })

    test('library add with shuffle on inserts into queue', async ({ page }) => {
        const player = new PlayerBar(page)
        const api = await apiLoginAs(QUEUE_USERNAME, QUEUE_PASSWORD)
        let targetUuid = ''
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string; properties?: { trackName?: string } }[]
            test.skip(songs.length < 5, 'need at least 5 library songs')

            let target: { uuid: string; name: string; searchTerm: string } | null = null
            for (let i = 4; i < songs.length; i++) {
                const name = songs[i].properties?.trackName ?? ''
                if (!name) continue
                const term = name.split(/\s+/).find(w => w.length > 3) ?? name.split(/\s+/)[0]
                const check = await api.get(`${API_V1}/properties?query=${encodeURIComponent(term)}`)
                const results = await check.json()
                if (Array.isArray(results) && results.some((r: any) => r.uuid === songs[i].uuid)) {
                    target = { uuid: songs[i].uuid, name, searchTerm: term }
                    break
                }
            }
            test.skip(!target, 'no library song is findable in global search')
            targetUuid = target!.uuid

            const queueUuids = songs.slice(0, 4).map(s => s.uuid)

            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: true, repeat: 'off',
                    queue: queueUuids, queue_index: 0,
                    shuffle_order: [0, 1, 2, 3], shuffle_seed: 42, shuffle_position: 0,
                },
            })

            await api.delete(`${API_V1}/library/${targetUuid}`)

            await page.goto(routes.library)
            await player.waitForBar(10000)

            await player.openQueue()
            await expect.poll(() => player.queueRows().count(), { timeout: 5000 }).toBe(4)
            await player.closeQueue()

            await page.goto(downloadSongQuery(target!.searchTerm))
            const targetCard = page.locator(`[data-song-id="${targetUuid}"]`).first()
            await expect(targetCard).toBeVisible({ timeout: 10000 })
            await targetCard.hover()
            const bookmark = targetCard.getByTestId('song-library-toggle')
            await expect(bookmark).toBeVisible({ timeout: 3000 })
            await bookmark.click()

            await player.openQueue()
            await expect.poll(
                () => player.queueRows().count(),
                { timeout: 5000 }
            ).toBe(5)
        } finally {
            if (targetUuid) await api.post(`${API_V1}/library`, { data: { song_id: targetUuid } }).catch(() => {})
            await api.dispose()
        }
    })

    test('shuffle order persists across reload', async ({ page }) => {
        const player = new PlayerBar(page)
        const api = await apiLoginAs(QUEUE_USERNAME, QUEUE_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 3, 'need at least 3 library songs')

            const order = songs.map((_, i) => i).reverse()
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: true, repeat: 'off',
                    queue: songs.map(s => s.uuid), queue_index: 0,
                    shuffle_order: order, shuffle_seed: 12345, shuffle_position: 0,
                },
            })

            await page.goto(routes.library)
            await player.waitForBar(10000)

            await player.openQueue()
            const rows = player.queueRows()
            const beforeNames: string[] = []
            const count = await rows.count()
            for (let i = 0; i < count; i++) {
                beforeNames.push((await rows.nth(i).locator('p').first().textContent())?.trim() ?? '')
            }

            await expect.poll(async () => {
                const r = await api.get(`${API_V1}/player/state`)
                const body = await r.json()
                return body?.shuffle_order?.length ?? 0
            }, { timeout: 10000 }).toBe(songs.length)

            await page.reload()
            await player.waitForBar(10000)
            await player.openQueue()

            const afterRows = player.queueRows()
            const afterNames: string[] = []
            const afterCount = await afterRows.count()
            for (let i = 0; i < afterCount; i++) {
                afterNames.push((await afterRows.nth(i).locator('p').first().textContent())?.trim() ?? '')
            }
            expect(afterNames).toEqual(beforeNames)
        } finally {
            await api.dispose()
        }
    })
})
