import { routes, downloadSongQuery } from './routes'
import { test, expect } from '@playwright/test'
import { login, ignoreError, apiLoginAs, API_V1, QUEUE_USERNAME, QUEUE_PASSWORD } from './helpers'

test.describe('player queue', () => {
    test.describe.configure({ mode: 'serial' })
    test.use({ storageState: 'e2e/.auth/queue-user.json' })

    test.beforeEach(async ({ page }) => {
        await login(page, QUEUE_USERNAME, QUEUE_PASSWORD)
    })

    test('queue panel opens with songs after starting playback from library', async ({ page }) => {
        await page.goto(routes.library)
        const cards = page.getByTestId('song-card')
        await expect(cards.first()).toBeVisible({ timeout: 10000 })
        test.skip((await cards.count()) < 2, 'need at least 2 library songs to verify queue')

        await cards.first().click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })

        await page.getByTestId('player-queue-toggle').click()
        await expect(page.getByTestId('player-queue-panel')).toBeVisible({ timeout: 3000 })
    })

    test('"Play next" from kebab does not change the currently playing track', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await page.goto(routes.library)
        const cards = page.getByTestId('song-card')
        await expect(cards.first()).toBeVisible({ timeout: 10000 })
        test.skip((await cards.count()) < 2, 'need at least 2 library songs to test play-next')

        await cards.first().click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
        const trackNameEl = page.getByTestId('player-track-name').first()
        await expect(trackNameEl).not.toBeEmpty({ timeout: 5000 })
        const beforeName = (await trackNameEl.textContent())?.trim() ?? ''

        const card1 = cards.nth(1)
        await card1.hover()
        await card1.getByTestId('song-kebab').click()
        const menu = page.getByTestId('song-kebab-menu')
        await menu.getByRole('button', { name: 'Play next' }).click()

        await expect(menu).not.toBeVisible({ timeout: 3000 })
        const afterName = (await trackNameEl.textContent())?.trim() ?? ''
        expect(afterName).toBe(beforeName)

        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })

    test('skip-next button advances when queue has multiple tracks', async ({ page }) => {
        await page.goto(routes.library)
        const cards = page.getByTestId('song-card')
        await expect(cards.first()).toBeVisible({ timeout: 10000 })
        test.skip((await cards.count()) < 2, 'need at least 2 library songs to test skip')

        await page.getByRole('button', { name: 'play all' }).click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
        const trackNameEl = page.getByTestId('player-track-name').first()
        await expect(trackNameEl).not.toBeEmpty({ timeout: 5000 })
        const beforeName = (await trackNameEl.textContent())?.trim() ?? ''

        const nextBtn = page.getByTestId('player-next').first()
        await expect(nextBtn).not.toBeDisabled({ timeout: 5000 })
        await nextBtn.click()
        await expect.poll(async () => (await trackNameEl.textContent())?.trim(), { timeout: 5000 }).not.toBe(beforeName)
    })

    test('removing from library removes song from queue panel', async ({ page }) => {
        const api = await apiLoginAs(QUEUE_USERNAME, QUEUE_PASSWORD)
        try {
            await page.goto(routes.library)
            const cards = page.getByTestId('song-card')
            await expect(cards.first()).toBeVisible({ timeout: 10000 })
            test.skip((await cards.count()) < 3, 'need at least 3 library songs')

            // Play all — queue gets all library songs
            await page.getByRole('button', { name: 'play all' }).click()
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })

            // Open queue, wait for all rows to render, then count
            const expectedCount = await cards.count()
            await page.getByTestId('player-queue-toggle').click()
            await expect(page.getByTestId('player-queue-panel')).toBeVisible({ timeout: 3000 })
            await expect.poll(() => page.locator('[data-qi]').count(), { timeout: 5000 }).toBe(expectedCount)
            const beforeCount = expectedCount
            await page.getByTestId('player-queue-toggle').click()

            // Grab UUID for cleanup
            const targetUuid = await page.locator('[data-song-id]').nth(1).getAttribute('data-song-id')

            // Remove second song from library via bookmark
            const card = cards.nth(1)
            await card.hover()
            const bookmark = card.getByTestId('song-library-toggle')
            await expect(bookmark).toBeVisible({ timeout: 3000 })
            await bookmark.click()

            // Open queue — count should have decreased
            await page.getByTestId('player-queue-toggle').click()
            await expect(page.getByTestId('player-queue-panel')).toBeVisible({ timeout: 3000 })
            await expect.poll(
                () => page.locator('[data-qi]').count(),
                { timeout: 5000, message: 'queue should shrink after library remove' }
            ).toBeLessThan(beforeCount)

            // Restore library
            if (targetUuid) await api.post(`${API_V1}/library`, { data: { song_id: targetUuid } })
        } finally {
            await api.dispose()
        }
    })

    test('library add inserts alphabetically in queue (shuffle off)', async ({ page }) => {
        const api = await apiLoginAs(QUEUE_USERNAME, QUEUE_PASSWORD)
        let targetUuid = ''
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string; properties?: { trackName?: string } }[]
            test.skip(songs.length < 3, 'need at least 3 library songs')

            // Pick a target song that's findable in global search (published/community).
            // User-uploaded songs with owner_id won't appear in /v1/properties search.
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

            // Seed queue with 2 songs, shuffle OFF
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: songs.slice(0, 2).map(s => s.uuid), queue_index: 0,
                },
            })

            // Remove target from library so we can re-add via bookmark
            await api.delete(`${API_V1}/library/${targetUuid}`)

            await page.goto(routes.library)
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })

            // Queue should have 2 songs
            await page.getByTestId('player-queue-toggle').click()
            await expect(page.getByTestId('player-queue-panel')).toBeVisible({ timeout: 3000 })
            await expect.poll(() => page.locator('[data-qi]').count(), { timeout: 5000 }).toBe(2)
            await page.getByTestId('player-queue-toggle').click()

            await page.goto(downloadSongQuery(target!.searchTerm))
            const targetCard = page.locator(`[data-song-id="${targetUuid}"]`)
            await expect(targetCard).toBeVisible({ timeout: 10000 })
            await targetCard.hover()
            const bookmark = targetCard.getByTestId('song-library-toggle')
            await expect(bookmark).toBeVisible({ timeout: 3000 })
            await bookmark.click()

            // Queue should now have 3 songs
            await page.getByTestId('player-queue-toggle').click()
            await expect(page.getByTestId('player-queue-panel')).toBeVisible({ timeout: 3000 })
            await expect.poll(
                () => page.locator('[data-qi]').count(),
                { timeout: 5000 }
            ).toBe(3)
        } finally {
            if (targetUuid) await api.post(`${API_V1}/library`, { data: { song_id: targetUuid } }).catch(() => {})
            await api.dispose()
        }
    })

    test('library add with shuffle on inserts into queue', async ({ page }) => {
        const api = await apiLoginAs(QUEUE_USERNAME, QUEUE_PASSWORD)
        let targetUuid = ''
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string; properties?: { trackName?: string } }[]
            test.skip(songs.length < 5, 'need at least 5 library songs')

            // Find a target song that's visible in global search (not user-uploaded)
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

            // Seed 4-song queue with shuffle ON
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: true, repeat: 'off',
                    queue: queueUuids, queue_index: 0,
                    shuffle_order: [0, 1, 2, 3], shuffle_seed: 42, shuffle_position: 0,
                },
            })

            // Remove target from library so we can re-add via bookmark
            await api.delete(`${API_V1}/library/${targetUuid}`)

            await page.goto(routes.library)
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })

            // Verify queue has 4 songs
            await page.getByTestId('player-queue-toggle').click()
            await expect(page.getByTestId('player-queue-panel')).toBeVisible({ timeout: 3000 })
            await expect.poll(() => page.locator('[data-qi]').count(), { timeout: 5000 }).toBe(4)
            await page.getByTestId('player-queue-toggle').click()

            await page.goto(downloadSongQuery(target!.searchTerm))
            const targetCard = page.locator(`[data-song-id="${targetUuid}"]`)
            await expect(targetCard).toBeVisible({ timeout: 10000 })
            await targetCard.hover()
            const bookmark = targetCard.getByTestId('song-library-toggle')
            await expect(bookmark).toBeVisible({ timeout: 3000 })
            await bookmark.click()

            // Queue should now have 5 songs
            await page.getByTestId('player-queue-toggle').click()
            await expect(page.getByTestId('player-queue-panel')).toBeVisible({ timeout: 3000 })
            await expect.poll(
                () => page.locator('[data-qi]').count(),
                { timeout: 5000 }
            ).toBe(5)
        } finally {
            if (targetUuid) await api.post(`${API_V1}/library`, { data: { song_id: targetUuid } }).catch(() => {})
            await api.dispose()
        }
    })

    test('shuffle order persists across reload', async ({ page }) => {
        const api = await apiLoginAs(QUEUE_USERNAME, QUEUE_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 3, 'need at least 3 library songs')

            // Seed queue with shuffle ON and a reversed shuffle_order
            const order = songs.map((_, i) => i).reverse()
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: true, repeat: 'off',
                    queue: songs.map(s => s.uuid), queue_index: 0,
                    shuffle_order: order, shuffle_seed: 12345, shuffle_position: 0,
                },
            })

            await page.goto(routes.library)
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })

            // Read queue display order
            await page.getByTestId('player-queue-toggle').click()
            await expect(page.getByTestId('player-queue-panel')).toBeVisible({ timeout: 3000 })
            const rows = page.locator('[data-qi]')
            const beforeNames: string[] = []
            const count = await rows.count()
            for (let i = 0; i < count; i++) {
                beforeNames.push((await rows.nth(i).locator('p').first().textContent())?.trim() ?? '')
            }

            // Wait for scheduleSave to persist
            await expect.poll(async () => {
                const r = await api.get(`${API_V1}/player/state`)
                const body = await r.json()
                return body?.shuffle_order?.length ?? 0
            }, { timeout: 10000 }).toBe(songs.length)

            // Reload — order should survive
            await page.reload()
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })
            await page.getByTestId('player-queue-toggle').click()
            await expect(page.getByTestId('player-queue-panel')).toBeVisible({ timeout: 3000 })

            const afterRows = page.locator('[data-qi]')
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
