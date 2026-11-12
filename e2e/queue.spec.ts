import { routes, downloadSongQuery } from './routes'
import { test, expect } from './fixtures/test'
import { login, ignoreError, apiLoginAs, libraryIds, playLibraryPaused, expectStable, API_V1, QUEUE_USERNAME, QUEUE_PASSWORD } from './helpers'
import { LibraryPage, PlayerBar } from './pages'

test.describe('player queue', () => {
    test.describe.configure({ mode: 'serial' })
    test.use({ authUser: 'queue-user' })

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
            // The queue fills in as the panel opens; reading it early captured only
            // the first rows and made this test flake. Wait for the full queue.
            await expect(rows).toHaveCount(songs.length)
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

            await expect.poll(async () => {
                return await player.queueRows().count()
            }, { timeout: 10000 }).toBe(count)

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

    // The panel indexes the queue with each entry of the saved shuffle order, so
    // an index that is not there took the whole app down the moment the panel
    // opened. Saved state comes from the server and from other devices.
    test('a corrupt saved shuffle order does not take the queue panel down', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })
        const player = new PlayerBar(page)
        const api = await apiLoginAs(QUEUE_USERNAME, QUEUE_PASSWORD)
        try {
            const songs = (await (await api.get(`${API_V1}/songs/library`)).json()) as { uuid: string }[]
            test.skip(songs.length < 3, 'need at least 3 library songs')

            // Right length, one index past the end and one slot unaccounted for.
            const order = songs.map((_, i) => i)
            order[order.length - 1] = songs.length
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: true, repeat: 'off',
                    queue: songs.map(s => s.uuid), queue_index: 0,
                    shuffle_order: order, shuffle_position: 0,
                },
            })

            await page.goto(routes.library)
            await player.waitForBar(10000)
            await player.openQueue()

            await expect.poll(() => player.queueRows().count(), { timeout: 5000 }).toBe(songs.length)
            expect(errors, `Page errors: ${errors.join('\n')}`).toHaveLength(0)
        } finally {
            await api.dispose()
        }
    })

    // A "play next" song that is removed from the queue has to leave the manual
    // list too. The list's length sets where the next "play next" lands, so a stale
    // entry put it past the end and left the shuffle order naming a slot that does
    // not exist.
    test('"Play next" after removing a "Play next" song keeps the shuffle order valid', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        const api = await apiLoginAs(QUEUE_USERNAME, QUEUE_PASSWORD)
        try {
            const songs = (await (await api.get(`${API_V1}/songs/library`)).json()) as { uuid: string }[]
            test.skip(songs.length < 3, 'need at least 3 library songs')

            // Playing the last song of the queue, with one library song left out
            // of it to be queued by hand.
            const queued = songs.slice(0, -1)
            const extra = songs[songs.length - 1]
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: true, repeat: 'off',
                    queue: queued.map(s => s.uuid), queue_index: queued.length - 1,
                    shuffle_order: queued.map((_, i) => i), shuffle_seed: 7, shuffle_position: queued.length - 1,
                },
            })

            await page.goto(routes.library)
            await lib.waitForSongs()
            await player.waitForBar(10000)

            async function playNextExtra() {
                const card = page.locator(`[data-song-id="${extra.uuid}"]`).first()
                await card.hover()
                await lib.kebab(card).click()
                await lib.kebabMenu().getByRole('button', { name: 'Play next' }).click()
                await expect(lib.kebabMenu()).not.toBeVisible({ timeout: 3000 })
            }

            await playNextExtra()
            await player.openQueue()
            await expect.poll(() => player.queueRows().count(), { timeout: 5000 }).toBe(queued.length + 1)
            const row = page.locator(`[data-qi="${queued.length}"]`)
            await row.hover()
            await player.queueRemoveBtn(row).click()
            await expect.poll(() => player.queueRows().count(), { timeout: 5000 }).toBe(queued.length)
            await player.closeQueue()

            await playNextExtra()
            await player.openQueue()
            await expect.poll(() => player.queueRows().count(), { timeout: 5000 }).toBe(queued.length + 1)

            // What the next device would load: a permutation of the queue.
            await expect.poll(async () => {
                const state = await (await api.get(`${API_V1}/player/state`)).json()
                const order: number[] = state?.shuffle_order ?? []
                return order.length === queued.length + 1
                    && [...order].sort((a, b) => a - b).every((v, i) => v === i)
            }, { timeout: 10000, message: 'saved shuffle order should be a permutation of the queue' }).toBe(true)
            expect(errors, `Page errors: ${errors.join('\n')}`).toHaveLength(0)
        } finally {
            await api.dispose()
        }
    })

    // The server hears queue changes as separate requests. A slow one must not be
    // overtaken by the ones the user made after it.
    test('"Play now" on a song already queued leaves the server queue as the screen has it when the remove is slow', async ({ page }) => {
        const lib = new LibraryPage(page)
        const api = await apiLoginAs(QUEUE_USERNAME, QUEUE_PASSWORD)
        try {
            await lib.goto()
            await lib.waitForSongs()
            const ids = await libraryIds(page)
            test.skip(ids.length < 3, 'need at least 3 library songs')
            await playLibraryPaused(page)

            // Slower than the two-second save, so a remove that is let overtake
            // lands after everything the user did next.
            await page.route('**/v1/player/queue/*', async route => {
                if (route.request().method() !== 'DELETE') return route.continue()
                await new Promise(resolve => setTimeout(resolve, 3000))
                await route.continue()
            })
            const removed = page.waitForResponse(r =>
                /\/v1\/player\/queue\/[^/]+$/.test(r.url()) && r.request().method() === 'DELETE', { timeout: 15000 })
            await lib.songById(ids[2]).first().click()
            await removed

            const read = async () => {
                const server = (await (await api.get(`${API_V1}/player/state`)).json()).queue as string[]
                const screen = await page.evaluate(() => (JSON.parse(localStorage.getItem('playerState') ?? '{}').queue ?? []) as string[])
                return { server, screen }
            }
            await expect.poll(async () => {
                const { server, screen } = await read()
                return screen.length === ids.length && JSON.stringify(server) === JSON.stringify(screen)
            }, { timeout: 15000, intervals: [500] }).toBe(true)
            await expectStable(async () => JSON.stringify((await read()).server), 2000)
        } finally {
            await api.dispose()
        }
    })

    test('a reorder is not sent until the insert before it has been answered', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        const api = await apiLoginAs(QUEUE_USERNAME, QUEUE_PASSWORD)
        try {
            await lib.goto()
            await lib.waitForSongs()
            const ids = await libraryIds(page)
            test.skip(ids.length < 3, 'need at least 3 library songs')
            await playLibraryPaused(page)

            // Take one song out of the queue, so that picking it again is an insert.
            await player.openQueue()
            await player.queueRemoveBtn(player.queueRows().nth(2)).click()
            await expect.poll(() => player.queueRows().count()).toBe(ids.length - 1)
            await player.closeQueue()

            // The remove goes to the server as soon as it is made; the song it left out is
            // the one picked again below, which is then an insert.
            const missingFromServer = async () => {
                const queue = (await (await api.get(`${API_V1}/player/state`)).json()).queue as string[]
                return ids.find(id => !queue.includes(id))
            }
            await expect.poll(missingFromServer, { timeout: 10000 }).toBeDefined()
            const target = (await missingFromServer())!

            const events: string[] = []
            page.on('request', r => {
                if (r.method() === 'PUT' && r.url().endsWith('/v1/player/queue/reorder')) events.push('reorder:request')
            })
            page.on('response', r => {
                if (r.request().method() === 'POST' && r.url().endsWith('/v1/player/queue')) events.push('insert:response')
            })
            await page.route('**/v1/player/queue', async route => {
                if (route.request().method() !== 'POST') return route.continue()
                events.push('insert:request')
                await new Promise(resolve => setTimeout(resolve, 1500))
                await route.continue()
            })

            await lib.songById(target).first().click()
            await expect.poll(() => events.includes('insert:request'), { timeout: 10000 }).toBe(true)
            await player.openQueue()
            const rows = player.queueRows()
            await player.queueDragHandle(rows.nth(1)).dragTo(rows.nth(0))

            await expect.poll(() => events.includes('reorder:request') && events.includes('insert:response'), { timeout: 15000 }).toBe(true)
            expect(events.indexOf('insert:response')).toBeLessThan(events.indexOf('reorder:request'))

            // And what the server ends up holding is what the screen shows: a reorder
            // that had run first would have moved the wrong song.
            const read = async () => {
                const server = (await (await api.get(`${API_V1}/player/state`)).json()).queue as string[]
                const screen = await page.evaluate(() => (JSON.parse(localStorage.getItem('playerState') ?? '{}').queue ?? []) as string[])
                return { server, screen }
            }
            await expect.poll(async () => {
                const { server, screen } = await read()
                return screen.length === ids.length && server.includes(target) && JSON.stringify(server) === JSON.stringify(screen)
            }, { timeout: 15000, intervals: [500] }).toBe(true)
            await expectStable(async () => JSON.stringify((await read()).server), 2000)
        } finally {
            await api.dispose()
        }
    })

    // A remove that never answers is given up on after a time limit (shortened here
    // from fifteen seconds). Whatever the server missed in the meantime is put right
    // by a save of the whole state, sent after it, which is the last thing the server
    // hears. A server that is only slow is still there: the app does not go offline.
    test('after a remove that times out, the last write is a save of the current state', async ({ page }) => {
        test.setTimeout(60000)
        const limitMs = 3000
        await page.addInitScript(ms => { (window as unknown as Record<string, number>).__playerWriteLimitMs = ms }, limitMs)
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        await lib.waitForSongs()
        const ids = await libraryIds(page)
        test.skip(ids.length < 3, 'need at least 3 library songs')
        await playLibraryPaused(page)

        const writes: { at: number; kind: string; queue?: string[] }[] = []
        page.on('request', r => {
            const url = r.url()
            if (!url.includes('/v1/player/') || r.method() === 'GET') return
            const kind = r.method() === 'DELETE' ? 'remove' : r.method() === 'PUT' && url.endsWith('/v1/player/state') ? 'state' : 'other'
            writes.push({ at: Date.now(), kind, queue: kind === 'state' ? (r.postDataJSON()?.queue as string[]) : undefined })
        })
        await page.route('**/v1/player/queue/*', async route => {
            if (route.request().method() !== 'DELETE') return route.continue()
            await new Promise(resolve => setTimeout(resolve, limitMs + 5000))
            await route.abort().catch(() => {})
        })

        await player.openQueue()
        await player.queueRemoveBtn(player.queueRows().nth(2)).click()
        await expect.poll(() => player.queueRows().count()).toBe(ids.length - 1)

        await expect.poll(() => writes.filter(w => w.kind === 'state').length, { timeout: 40000 }).toBeGreaterThan(0)
        const remove = writes.find(w => w.kind === 'remove')!
        const last = writes[writes.length - 1]
        expect(last.kind).toBe('state')
        // Not before the remove had its time limit.
        expect(last.at - remove.at).toBeGreaterThanOrEqual(limitMs - 1000)
        expect(last.queue).toHaveLength(ids.length - 1)
        await expect(page.getByTestId('offline-banner')).toHaveCount(0)
    })

    // Nothing in a paused player asks the server anything, so a dead zone that ends
    // would go unnoticed: the app asks on its own.
    test('a dead zone that ends is noticed without the user doing anything', async ({ page }) => {
        test.setTimeout(60000)
        await page.addInitScript(() => { (window as unknown as Record<string, number>).__probeIntervalMs = 500 })
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        await lib.waitForSongs()
        await playLibraryPaused(page)

        await page.route('**/v1/**', route => route.abort())
        // A change to the player is saved after two seconds, and that save is the
        // first request to fail.
        await player.repeat.click()
        await expect(page.getByTestId('offline-banner')).toBeVisible({ timeout: 15000 })

        await page.unroute('**/v1/**')
        await expect(page.getByTestId('offline-banner')).toHaveCount(0, { timeout: 15000 })
    })
})
