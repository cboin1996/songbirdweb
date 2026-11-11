import { routes } from './routes'
import { test, expect, Page } from '@playwright/test'
import { login, apiLoginAs, setVisibility, expectStable, libraryIds, restoredSongId, routeStalePlayerState, API_V1, SYNC_USERNAME, SYNC_PASSWORD } from './helpers'
import { LibraryPage, PlayerBar } from './pages'

async function apiReturnsUpdatedAt(): Promise<boolean> {
    const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
    try {
        const r = await api.get(`${API_V1}/player/state`)
        if (!r.ok()) return false
        const body = await r.json()
        return 'updated_at' in body
    } finally {
        await api.dispose()
    }
}

test.describe('player state sync', () => {
    test.describe.configure({ mode: 'serial' })
    test.use({ storageState: 'e2e/.auth/sync-user.json' })

    test.beforeEach(async ({ page }) => {
        await login(page, SYNC_USERNAME, SYNC_PASSWORD)
    })

    test('tier 1: server newer auto-loads without prompt', async ({ page }) => {
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 2, 'need at least 2 library songs')

            // Set server state to song[0]
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [songs[0].uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: songs[0].uuid,
                },
            })

            // Set localStorage to a different song with an OLD timestamp
            await page.goto(routes.library)
            await page.evaluate((uuid) => {
                localStorage.setItem('playerState', JSON.stringify({
                    shuffle: false, repeat: 'off',
                    queue: [uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: uuid,
                    saved_at: '2020-01-01T00:00:00.000Z',
                }))
            }, songs[1].uuid)

            // Reload — server is newer, should auto-load without prompt
            await page.reload()
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })
            // Key assertion: no sync prompt (server won silently)
            await expect(page.getByTestId('sync-prompt')).toHaveCount(0)
        } finally {
            await api.dispose()
        }
    })

    test('tier 2: local newer shows sync prompt', async ({ page }) => {
        test.skip(!await apiReturnsUpdatedAt(), 'API does not return updated_at')
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 2, 'need at least 2 library songs')

            // Set server state to song[0] (will have an older updated_at)
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [songs[0].uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: songs[0].uuid,
                },
            })

            // Set localStorage to a different song with a FUTURE timestamp
            await page.goto(routes.library)
            await page.evaluate((uuid) => {
                localStorage.setItem('playerState', JSON.stringify({
                    shuffle: false, repeat: 'off',
                    queue: [uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: uuid,
                    saved_at: '2099-01-01T00:00:00.000Z',
                }))
            }, songs[1].uuid)

            // Reload — local is newer, should show sync prompt
            await page.reload()
            await expect(page.getByTestId('sync-prompt')).toBeVisible({ timeout: 10000 })
            await expect(page.getByTestId('sync-load-remote')).toBeVisible()
            await expect(page.getByTestId('sync-keep-local')).toBeVisible()
        } finally {
            await api.dispose()
        }
    })

    test('sync prompt: "Load from other device" applies server state', async ({ page }) => {
        test.skip(!await apiReturnsUpdatedAt(), 'API does not return updated_at')
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string; properties?: { trackName?: string } }[]
            test.skip(songs.length < 2, 'need at least 2 library songs')

            const serverSong = songs[0]
            const localSong = songs[1]

            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [serverSong.uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: serverSong.uuid,
                },
            })

            await page.goto(routes.library)
            await page.evaluate((uuid) => {
                localStorage.setItem('playerState', JSON.stringify({
                    shuffle: false, repeat: 'off',
                    queue: [uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: uuid,
                    saved_at: '2099-01-01T00:00:00.000Z',
                }))
            }, localSong.uuid)

            await page.reload()
            await expect(page.getByTestId('sync-prompt')).toBeVisible({ timeout: 10000 })
            await page.getByTestId('sync-load-remote').click()

            // Prompt dismissed
            await expect(page.getByTestId('sync-prompt')).toHaveCount(0, { timeout: 3000 })
            // Toast confirms
            await expect(page.locator('text=Loaded player state from other device')).toBeVisible({ timeout: 5000 })
            // Player bar shows the server song
            if (serverSong.properties?.trackName) {
                await expect(page.getByTestId('player-track-name').first()).toContainText(serverSong.properties.trackName, { timeout: 5000 })
            }
        } finally {
            await api.dispose()
        }
    })

    test('sync prompt: "Keep mine" dismisses and persists local state', async ({ page }) => {
        test.skip(!await apiReturnsUpdatedAt(), 'API does not return updated_at')
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 2, 'need at least 2 library songs')

            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [songs[0].uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: songs[0].uuid,
                },
            })

            await page.goto(routes.library)
            await page.evaluate((uuid) => {
                localStorage.setItem('playerState', JSON.stringify({
                    shuffle: false, repeat: 'off',
                    queue: [uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: uuid,
                    saved_at: '2099-01-01T00:00:00.000Z',
                }))
            }, songs[1].uuid)

            await page.reload()
            await expect(page.getByTestId('sync-prompt')).toBeVisible({ timeout: 10000 })
            await page.getByTestId('sync-keep-local').click()

            // Prompt dismissed
            await expect(page.getByTestId('sync-prompt')).toHaveCount(0, { timeout: 3000 })
            await expect(page.locator('text=Kept local player state')).toBeVisible({ timeout: 5000 })

            // Server state should be overwritten — poll until the PUT lands
            await expect.poll(async () => {
                const r = await api.get(`${API_V1}/player/state`)
                if (!r.ok()) return null
                const body = await r.json()
                return body?.current_song_uuid
            }, { timeout: 10000 }).toBe(songs[1].uuid)
        } finally {
            await api.dispose()
        }
    })

    test('visibility resync: server newer auto-applies after stale tab', async ({ page }) => {
        test.skip(!await apiReturnsUpdatedAt(), 'API does not return updated_at')
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 2, 'need at least 2 library songs')

            // Load page with song[0] — clear local state first so reconcile doesn't
            // race against saved_at left by a previous test in this serial chain
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [songs[0].uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: songs[0].uuid,
                },
            })
            await page.goto(routes.library)
            await page.evaluate(() => localStorage.removeItem('playerState'))
            await page.reload()
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })

            // Zero out the stale threshold so any hide→show triggers resync
            await page.evaluate(() => {
                (window as unknown as Record<string, unknown>).__playerStaleThresholdMs = 0
            })

            // Simulate tab going to background
            await page.evaluate(() => {
                Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true })
                document.dispatchEvent(new Event('visibilitychange'))
            })

            // Another device updates server to song[1]
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [songs[1].uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: songs[1].uuid,
                },
            })

            // Simulate tab returning to foreground
            await page.evaluate(() => {
                Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true })
                document.dispatchEvent(new Event('visibilitychange'))
            })

            // Server is newer — should auto-apply without prompt
            await expect(page.locator('text=Player synced from another device')).toBeVisible({ timeout: 5000 })
            await expect(page.getByTestId('sync-prompt')).toHaveCount(0)
        } finally {
            await api.dispose()
        }
    })

    test('no prompt when queues match', async ({ page }) => {
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 1, 'need at least 1 library song')

            // Set same state on both server and local
            const matchingState = {
                shuffle: false, repeat: 'off',
                queue: [songs[0].uuid], queue_index: 0,
                manual_next: [], current_song_uuid: songs[0].uuid,
            }
            await api.put(`${API_V1}/player/state`, { data: matchingState })

            await page.goto(routes.library)
            await page.evaluate((uuid) => {
                localStorage.setItem('playerState', JSON.stringify({
                    shuffle: false, repeat: 'off',
                    queue: [uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: uuid,
                    saved_at: '2099-01-01T00:00:00.000Z',
                }))
            }, songs[0].uuid)

            await page.reload()
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })
            // No sync prompt, no sync toast
            await expect(page.getByTestId('sync-prompt')).toHaveCount(0)
            await page.waitForTimeout(2000)
            await expect(page.getByTestId('sync-prompt')).toHaveCount(0)
        } finally {
            await api.dispose()
        }
    })

    // A 15-minute access token dies while the driver is paused at a stop. The
    // refresh has to happen on return to the foreground, because resume() sets
    // no src: the rest of the song arrives as range requests carrying whatever
    // cookie is current by then.
    test('foreground refresh: a stale access token is refreshed on return to visible', async ({ page }) => {
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 1, 'need at least 1 library song')

            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [songs[0].uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: songs[0].uuid,
                },
            })
            await page.goto(routes.library)
            await page.evaluate(() => localStorage.removeItem('playerState'))
            await page.reload()
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })

            let refreshes = 0
            page.on('request', r => { if (r.url().includes('/v1/auth/refresh')) refreshes++ })

            // A page load says nothing about the token's age (the middleware lets an
            // unexpired token through, with a minute or ten left), so the first
            // return to the foreground refreshes once.
            await setVisibility(page, 'hidden')
            await setVisibility(page, 'visible')
            await expect.poll(() => refreshes, { timeout: 5000 }).toBe(1)

            // Having just refreshed, the next return owes nothing. The state fetch
            // that follows every return is issued after the refresh decision, so
            // seeing it is how to know the decision was made.
            const stateFetched = page.waitForResponse(r =>
                r.url().includes('/v1/player/state') && r.request().method() === 'GET')
            await setVisibility(page, 'hidden')
            await setVisibility(page, 'visible')
            await stateFetched
            expect(refreshes).toBe(1)

            // Make the token look stale without waiting out ten real minutes.
            await page.evaluate(() => {
                (window as unknown as Record<string, unknown>).__tokenRefreshStaleMs = 0
            })
            await setVisibility(page, 'hidden')
            await setVisibility(page, 'visible')
            await expect.poll(() => refreshes, { timeout: 5000 }).toBe(2)
        } finally {
            await api.dispose()
        }
    })

    // Pausing at a light and switching to Maps must not cost the song's place
    // or a second download on cellular. `loadstart` is the faithful signal: the
    // element fires it whenever the source is re-assigned, cache hit or not.
    test('visibility resync: an unchanged state preserves position and does not reload the source', async ({ page }) => {
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 1, 'need at least 1 library song')

            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [songs[0].uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: songs[0].uuid,
                },
            })
            await page.goto(routes.library)
            await page.evaluate(() => localStorage.removeItem('playerState'))
            await page.reload()
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })

            // Play, seek somewhere distinctive, pause — the driver at the light.
            await page.getByTestId('player-play-pause').click()
            await page.waitForFunction(() => {
                const a = document.querySelector('audio')
                return !!a && isFinite(a.duration) && a.duration > 4
            }, null, { timeout: 15000 })
            const seeked = await page.evaluate(() => {
                const a = document.querySelector('audio')!
                a.currentTime = Math.min(10, a.duration / 2)
                return a.currentTime
            })
            await page.getByTestId('player-play-pause').click()

            let downloads = 0
            page.on('request', r => { if (r.url().includes(`/download/${songs[0].uuid}`)) downloads++ })
            await page.evaluate(() => {
                const w = window as unknown as Record<string, unknown>
                w.__loadstarts = 0
                document.querySelector('audio')!.addEventListener('loadstart', () => { (w.__loadstarts as number)++ })
            })

            // The reconcile fetches server state before it can decide anything, so
            // its answer is what must be in before "nothing happened" means anything.
            const stateFetched = page.waitForResponse(r =>
                r.url().includes('/v1/player/state') && r.request().method() === 'GET')
            await setVisibility(page, 'hidden')
            await setVisibility(page, 'visible')
            await stateFetched
            await expectStable(() => page.evaluate(() => (window as unknown as { __loadstarts: number }).__loadstarts), 1000)

            expect(await page.evaluate(() => (window as unknown as { __loadstarts: number }).__loadstarts)).toBe(0)
            expect(downloads).toBe(0)
            const after = await page.evaluate(() => document.querySelector('audio')!.currentTime)
            expect(Math.abs(after - seeked)).toBeLessThan(1)
        } finally {
            await api.dispose()
        }
    })

    // The same song with different settings used to be treated as "nothing
    // changed" and dropped. It has to be applied — and applying it must still
    // leave the loaded source and the position alone.
    test('visibility resync: a same-song shuffle and repeat change is applied without reloading', async ({ page }) => {
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 1, 'need at least 1 library song')

            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [songs[0].uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: songs[0].uuid,
                },
            })
            await page.goto(routes.library)
            await page.evaluate(() => localStorage.removeItem('playerState'))
            await page.reload()
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })
            await expect(page.getByTestId('player-shuffle').first()).toHaveAttribute('aria-pressed', 'false')

            await page.getByTestId('player-play-pause').click()
            await page.waitForFunction(() => {
                const a = document.querySelector('audio')
                return !!a && isFinite(a.duration) && a.duration > 4
            }, null, { timeout: 15000 })
            const seeked = await page.evaluate(() => {
                const a = document.querySelector('audio')!
                a.currentTime = Math.min(10, a.duration / 2)
                return a.currentTime
            })
            await page.getByTestId('player-play-pause').click()

            await page.evaluate(() => {
                const w = window as unknown as Record<string, unknown>
                w.__loadstarts = 0
                document.querySelector('audio')!.addEventListener('loadstart', () => { (w.__loadstarts as number)++ })
            })

            await setVisibility(page, 'hidden')
            // Another device turns shuffle on and repeat to one, same song.
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: true, repeat: 'one',
                    queue: [songs[0].uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: songs[0].uuid,
                },
            })
            await setVisibility(page, 'visible')

            await expect(page.getByTestId('player-shuffle').first()).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 })
            await expect(page.getByTestId('player-repeat').first()).toHaveAttribute('title', 'repeat: one')
            expect(await page.evaluate(() => (window as unknown as { __loadstarts: number }).__loadstarts)).toBe(0)
            const after = await page.evaluate(() => document.querySelector('audio')!.currentTime)
            expect(Math.abs(after - seeked)).toBeLessThan(1)
        } finally {
            await api.dispose()
        }
    })

    // Guard on the "user has played" flag. Nothing clears it, so widening it to
    // the play/pause button would kill visibility sync for the rest of the
    // session. The tests above never press play, so only this one notices.
    // Only the play/pause button: tapping a song (play) or "play now" does set
    // the flag, and ends this sync for the session. That is known and not
    // covered here; see known-issues.md.
    test('visibility resync: the play/pause button does not stop later syncs', async ({ page }) => {
        test.skip(!await apiReturnsUpdatedAt(), 'API does not return updated_at')
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string; properties?: { trackName?: string } }[]
            test.skip(songs.length < 2, 'need at least 2 library songs')
            test.skip(!songs[1].properties?.trackName, 'need a track name to assert on')

            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [songs[0].uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: songs[0].uuid,
                },
            })
            await page.goto(routes.library)
            await page.evaluate(() => localStorage.removeItem('playerState'))
            await page.reload()
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })

            // Actually play, then pause — the driver at the light.
            await page.getByTestId('player-play-pause').click()
            await page.waitForFunction(() => {
                const a = document.querySelector('audio')
                return !!a && !a.paused && a.currentTime > 0
            }, null, { timeout: 15000 })
            await page.getByTestId('player-play-pause').click()

            await setVisibility(page, 'hidden')
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [songs[1].uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: songs[1].uuid,
                },
            })
            await setVisibility(page, 'visible')

            await expect(page.getByTestId('player-track-name').first())
                .toContainText(songs[1].properties!.trackName!, { timeout: 10000 })
        } finally {
            await api.dispose()
        }
    })

    // Tapping a song is not a reason to stop listening to the other devices: the
    // guard that protects a launch from a late answer must not outlive the launch.
    test('visibility resync: a song tapped earlier in the session does not stop later syncs', async ({ page }) => {
        test.skip(!await apiReturnsUpdatedAt(), 'API does not return updated_at')
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string; properties?: { trackName?: string } }[]
            test.skip(songs.length < 2, 'need at least 2 library songs')

            const lib = new LibraryPage(page)
            const player = new PlayerBar(page)
            await page.goto(routes.library)
            await lib.waitForSongs()

            const saved = page.waitForResponse(r =>
                r.url().includes('/v1/player/state') && r.request().method() === 'PUT')
            await lib.playAllBtn.click()
            await player.waitForBar()
            await player.waitForTrackName()
            const started = await player.getTrackName()
            await saved
            await player.playPause.click()
            await expect(player.playPause).toHaveAttribute('title', 'play')

            const other = songs.find(s => s.properties?.trackName && !started.includes(s.properties.trackName))
            test.skip(!other, 'need a library song with a track name different from the one playing')
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [other!.uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: other!.uuid,
                },
            })

            // Each return to the tab asks again, so a return that lands inside a
            // pending save is simply tried once more.
            await expect.poll(async () => {
                await setVisibility(page, 'hidden')
                await setVisibility(page, 'visible')
                return (await player.getTrackName()).includes(other!.properties!.trackName!)
            }, { timeout: 15000, intervals: [500] }).toBe(true)
        } finally {
            await api.dispose()
        }
    })

    // The service worker answers a failed player-state request with its last
    // cached copy, marked stale. In a dead zone that copy predates whatever the
    // user changed since, so applying it silently reverts their change.
    test('visibility resync: a player state served stale from the cache is not applied', async ({ page }) => {
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 2, 'need at least 2 library songs')

            const state = {
                shuffle: false, repeat: 'off',
                queue: [songs[0].uuid], queue_index: 0,
                manual_next: [], current_song_uuid: songs[0].uuid,
            }
            await api.put(`${API_V1}/player/state`, { data: state })
            await page.goto(routes.library)
            await page.evaluate(() => localStorage.removeItem('playerState'))
            await page.reload()
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })
            await page.evaluate(() => {
                (window as unknown as Record<string, unknown>).__playerStaleThresholdMs = 0
            })

            // Record every value the shuffle button takes: a state applied and then
            // overwritten would otherwise leave no trace once the next one lands.
            await page.evaluate(() => {
                const w = window as unknown as { __shuffleSeen: string[] }
                w.__shuffleSeen = []
                new MutationObserver(records => {
                    for (const r of records) {
                        const el = r.target as HTMLElement
                        if (el.dataset.testid === 'player-shuffle') w.__shuffleSeen.push(el.getAttribute('aria-pressed') ?? '')
                    }
                }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] })
            })

            // First the cache's answer, which says shuffle is on, then the server's.
            let served = 0
            let stale = true
            await page.route('**/v1/player/state', async route => {
                if (route.request().method() !== 'GET') return route.continue()
                served += 1
                if (!stale) return route.continue()
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    // The real marker is added by a worker on the page's own origin and
                    // is always readable. The API is another origin here, so the
                    // header has to be exposed for the page to see it at all.
                    headers: { 'X-SW-Stale': '1', 'Access-Control-Expose-Headers': 'X-SW-Stale' },
                    body: JSON.stringify({ ...state, shuffle: true }),
                })
            })

            await setVisibility(page, 'hidden')
            await setVisibility(page, 'visible')
            await expect.poll(() => served, { timeout: 5000 }).toBe(1)

            // The server's own answer then moves repeat. Once that lands the handler
            // has finished with the stale one too, whichever way it went.
            stale = false
            await api.put(`${API_V1}/player/state`, { data: { ...state, repeat: 'all' } })
            await setVisibility(page, 'hidden')
            await setVisibility(page, 'visible')
            await expect(page.getByTestId('player-repeat').first()).toHaveAttribute('title', 'repeat: all', { timeout: 10000 })

            expect(await page.evaluate(() => (window as unknown as { __shuffleSeen: string[] }).__shuffleSeen))
                .not.toContain('true')
        } finally {
            await api.dispose()
        }
    })

    // Offline, the service worker answers the launch's player-state request from
    // its cache. That copy is older than anything this device did since, so it is
    // no reason to ask the user which one to keep.
    test('launch: a player state served stale from the cache neither prompts nor replaces this device\'s copy', async ({ page }) => {
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 2, 'need at least 2 library songs')

            await page.goto(routes.library)
            await page.evaluate((uuid) => {
                localStorage.setItem('playerState', JSON.stringify({
                    shuffle: false, repeat: 'off',
                    queue: [uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: uuid,
                    saved_at: new Date().toISOString(),
                }))
            }, songs[1].uuid)

            await routeStalePlayerState(page, {
                shuffle: false, repeat: 'off',
                queue: [songs[0].uuid], queue_index: 0,
                manual_next: [], current_song_uuid: songs[0].uuid,
                updated_at: '2020-01-01T00:00:00.000Z',
            })
            await page.reload()

            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })
            // The restore is the last thing launch does, so by now it has decided
            // whether to ask.
            expect(await restoredSongId(page)).toBe(songs[1].uuid)
            await expect(page.getByTestId('sync-prompt')).toHaveCount(0)
            await expect(page.getByText(/synced from another device/i)).toHaveCount(0)
            await expectStable(() => page.getByTestId('sync-prompt').count())
        } finally {
            await api.dispose()
        }
    })

    test('launch: a player state served stale from the cache is used when this device has none of its own', async ({ page }) => {
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 1, 'need at least 1 library song')

            await page.goto(routes.library)
            await page.evaluate(() => localStorage.removeItem('playerState'))
            await routeStalePlayerState(page, {
                shuffle: false, repeat: 'off',
                queue: [songs[0].uuid], queue_index: 0,
                manual_next: [], current_song_uuid: songs[0].uuid,
                updated_at: '2020-01-01T00:00:00.000Z',
            })
            await page.reload()

            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })
            expect(await restoredSongId(page)).toBe(songs[0].uuid)
            await expect(page.getByTestId('sync-prompt')).toHaveCount(0)
        } finally {
            await api.dispose()
        }
    })

    // The state request is slow; the user does not wait for it.
    test('launch: a song picked before the state arrives is not replaced by it', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await page.goto(routes.library)
        await lib.waitForSongs()
        const ids = await libraryIds(page)
        test.skip(ids.length < 2, 'need at least 2 library songs')

        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        let asked = false
        await page.route('**/v1/player/state', async route => {
            if (route.request().method() !== 'GET') return route.continue()
            asked = true
            await gate
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                headers: { 'X-SW-Stale': '1', 'Access-Control-Expose-Headers': 'X-SW-Stale' },
                body: JSON.stringify({
                    shuffle: false, repeat: 'off',
                    queue: [ids[1]], queue_index: 0,
                    manual_next: [], current_song_uuid: ids[1],
                    updated_at: '2020-01-01T00:00:00.000Z',
                }),
            })
        })
        await page.reload()
        await lib.waitForSongs()
        await expect.poll(() => asked, { timeout: 10000 }).toBe(true)

        await lib.playAllBtn.click()
        await player.waitForBar()
        const picked = await restoredSongId(page)
        expect(picked).not.toBeNull()

        release()
        await expectStable(() => restoredSongId(page), 2000)
        expect(await restoredSongId(page)).toBe(picked)
    })

    // The player saves two seconds after a change. Coming back to the tab inside
    // that window compares the screen against a server that has not heard yet.
    test('visibility resync: a change made inside the save window is not overwritten', async ({ page }) => {
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 1, 'need at least 1 library song')

            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [songs[0].uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: songs[0].uuid,
                },
            })
            await page.goto(routes.library)
            await page.evaluate(() => localStorage.removeItem('playerState'))
            await page.reload()
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })
            await page.evaluate(() => {
                (window as unknown as Record<string, unknown>).__playerStaleThresholdMs = 0
            })

            const shuffle = page.getByTestId('player-shuffle').filter({ visible: true }).first()
            await expect(shuffle).toHaveAttribute('aria-pressed', 'false')
            await page.evaluate(() => {
                const w = window as unknown as { __shuffleSeen: string[] }
                w.__shuffleSeen = []
                new MutationObserver(records => {
                    for (const r of records) {
                        const el = r.target as HTMLElement
                        if (el.dataset.testid === 'player-shuffle') w.__shuffleSeen.push(el.getAttribute('aria-pressed') ?? '')
                    }
                }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] })
            })

            const stateGet = page.waitForResponse(r =>
                r.url().includes('/v1/player/state') && r.request().method() === 'GET')
            const saved = page.waitForResponse(r =>
                r.url().includes('/v1/player/state') && r.request().method() === 'PUT')
            await shuffle.click()
            await expect(shuffle).toHaveAttribute('aria-pressed', 'true')
            await setVisibility(page, 'hidden')
            await setVisibility(page, 'visible')

            // The server was asked while it still held shuffle off, and the debounced
            // save then went out. Shuffle should have been on the whole time.
            await stateGet
            await saved
            await expect(shuffle).toHaveAttribute('aria-pressed', 'true')
            // The bar and the expanded player each carry a button, so "on" is seen more
            // than once; what matters is that "off" never came back.
            const seen = await page.evaluate(() => (window as unknown as { __shuffleSeen: string[] }).__shuffleSeen)
            expect(seen).toContain('true')
            expect(seen).not.toContain('false')
        } finally {
            await api.dispose()
        }
    })

    // The save goes out two seconds after a change; on a bad connection it is
    // still on its way when the user comes back to the tab. The server then
    // holds the state from before the change, and comparing against it reads
    // the user's own change as another device's.
    test('visibility resync: a save still on its way is not overwritten by the older state on the server', async ({ page }) => {
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 1, 'need at least 1 library song')

            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [songs[0].uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: songs[0].uuid,
                },
            })
            await page.goto(routes.library)
            await page.evaluate(() => localStorage.removeItem('playerState'))
            await page.reload()
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })

            let saveHeld = false
            await page.route('**/v1/player/state', async route => {
                if (route.request().method() !== 'PUT') return route.continue()
                saveHeld = true
                await new Promise(resolve => setTimeout(resolve, 4000))
                await route.continue()
            })

            const shuffle = page.getByTestId('player-shuffle').filter({ visible: true }).first()
            await expect(shuffle).toHaveAttribute('aria-pressed', 'false')
            await page.evaluate(() => {
                const w = window as unknown as { __shuffleSeen: string[] }
                w.__shuffleSeen = []
                new MutationObserver(records => {
                    for (const r of records) {
                        const el = r.target as HTMLElement
                        if (el.dataset.testid === 'player-shuffle') w.__shuffleSeen.push(el.getAttribute('aria-pressed') ?? '')
                    }
                }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] })
            })
            await shuffle.click()
            await expect(shuffle).toHaveAttribute('aria-pressed', 'true')

            // The debounce has fired and the request is held: the save is on its way.
            await expect.poll(() => saveHeld, { timeout: 10000 }).toBe(true)
            await setVisibility(page, 'hidden')
            await setVisibility(page, 'visible')

            await expectStable(() => shuffle.getAttribute('aria-pressed'), 2000)
            await expect(page.getByTestId('sync-prompt')).toHaveCount(0)
            const seen = await page.evaluate(() => (window as unknown as { __shuffleSeen: string[] }).__shuffleSeen)
            expect(seen).toContain('true')
            expect(seen).not.toContain('false')
        } finally {
            await api.dispose()
        }
    })

    // A toggle made while the server was out of reach never got there. Coming back to
    // the tab must not read the server's older copy as another device's edit.
    for (const probe of [false, true]) {
        test(probe
            ? 'a toggle that never reached the server is sent when the server is back, with nothing else done'
            : 'visibility resync: a toggle that never reached the server is kept, and sent', async ({ page }) => {
            if (probe) await page.addInitScript(() => { (window as unknown as Record<string, number>).__probeIntervalMs = 500 })
            const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
            try {
                const libRes = await api.get(`${API_V1}/songs/library`)
                const songs = (await libRes.json()) as { uuid: string }[]
                test.skip(songs.length < 1, 'need at least 1 library song')

                await api.put(`${API_V1}/player/state`, {
                    data: {
                        shuffle: false, repeat: 'off',
                        queue: [songs[0].uuid], queue_index: 0,
                        manual_next: [], current_song_uuid: songs[0].uuid,
                    },
                })
                await page.goto(routes.library)
                await page.evaluate(() => localStorage.removeItem('playerState'))
                await page.reload()
                await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })

                let refused = 0
                await page.route('**/v1/player/state', async route => {
                    if (route.request().method() !== 'PUT') return route.continue()
                    refused++
                    await route.abort()
                })
                const shuffle = page.getByTestId('player-shuffle').filter({ visible: true }).first()
                await shuffle.click()
                await expect(shuffle).toHaveAttribute('aria-pressed', 'true')
                await expect.poll(() => refused, { timeout: 10000 }).toBeGreaterThan(0)
                await page.unroute('**/v1/player/state')

                if (!probe) {
                    await setVisibility(page, 'hidden')
                    await setVisibility(page, 'visible')
                    await expectStable(() => shuffle.getAttribute('aria-pressed'), 2000)
                    await expect(shuffle).toHaveAttribute('aria-pressed', 'true')
                }
                await expect.poll(async () => (await (await api.get(`${API_V1}/player/state`)).json()).shuffle, { timeout: 20000 }).toBe(true)
            } finally {
                await api.dispose()
            }
        })
    }

    // A refresh can take up to its eight-second timeout. The state fetch carries
    // its own refresh-and-retry on a 401, so it need not queue behind one.
    test('visibility resync: does not wait for a token refresh before reconciling', async ({ page }) => {
        test.skip(!await apiReturnsUpdatedAt(), 'API does not return updated_at')
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 2, 'need at least 2 library songs')

            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [songs[0].uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: songs[0].uuid,
                },
            })
            await page.goto(routes.library)
            await page.evaluate(() => localStorage.removeItem('playerState'))
            await page.reload()
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })
            await page.evaluate(() => {
                const w = window as unknown as Record<string, unknown>
                w.__playerStaleThresholdMs = 0
                w.__tokenRefreshStaleMs = 0
            })

            let refreshAsked = false
            await page.route('**/v1/auth/refresh', async route => {
                refreshAsked = true
                await gate
                await route.continue().catch(() => {})
            })

            await setVisibility(page, 'hidden')
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [songs[1].uuid], queue_index: 0,
                    manual_next: [], current_song_uuid: songs[1].uuid,
                },
            })
            await setVisibility(page, 'visible')

            // Applied while the refresh is still held open.
            await expect(page.locator('text=Player synced from another device')).toBeVisible({ timeout: 5000 })
            expect(refreshAsked).toBe(true)
        } finally {
            release()
            await api.dispose()
        }
    })

    // The element can be holding the right song in a failed state. Skipping the
    // source because the song matches would then leave the player showing it,
    // unable to play, through every later sync.
    test('visibility resync: a source that failed to load is loaded again', async ({ page }) => {
        const api = await apiLoginAs(SYNC_USERNAME, SYNC_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 1, 'need at least 1 library song')

            const state = {
                shuffle: false, repeat: 'off',
                queue: [songs[0].uuid], queue_index: 0,
                manual_next: [], current_song_uuid: songs[0].uuid,
            }
            await api.put(`${API_V1}/player/state`, { data: state })

            // The restore's own stream request fails, leaving the element in error.
            let failing = true
            await page.route(`**/v1/download/${songs[0].uuid}**`, route =>
                failing ? route.fulfill({ status: 404, body: 'Not Found' }) : route.continue())
            await page.goto(routes.library)
            await page.evaluate(() => localStorage.removeItem('playerState'))
            // Stopping saves where the player is, and a reconcile inside that window
            // is skipped by design: let it land first.
            const stopSaved = page.waitForResponse(r =>
                r.url().includes('/v1/player/state') && r.request().method() === 'PUT', { timeout: 15000 })
            await page.reload()
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })
            await expect.poll(
                () => page.evaluate(() => document.querySelector('audio')?.error?.code ?? 0),
                { timeout: 10000 },
            ).toBe(4)
            await stopSaved
            failing = false

            await page.evaluate(() => {
                (window as unknown as Record<string, unknown>).__playerStaleThresholdMs = 0
            })
            // Another device turns shuffle on: same song, same queue.
            await setVisibility(page, 'hidden')
            await api.put(`${API_V1}/player/state`, { data: { ...state, shuffle: true } })
            await setVisibility(page, 'visible')

            await expect(page.getByTestId('player-shuffle').filter({ visible: true }).first())
                .toHaveAttribute('aria-pressed', 'true', { timeout: 10000 })
            await expect.poll(
                () => page.evaluate(() => {
                    const a = document.querySelector('audio')
                    return !!a && !a.error && Number.isFinite(a.duration)
                }),
                { timeout: 10000, message: 'the element never took the source again' },
            ).toBe(true)
        } finally {
            await api.dispose()
        }
    })
})
