import { routes } from './routes'
import { test, expect } from '@playwright/test'
import { login, apiLogin, API_V1 } from './helpers'

async function apiReturnsUpdatedAt(): Promise<boolean> {
    const api = await apiLogin()
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

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('tier 1: server newer auto-loads without prompt', async ({ page }) => {
        const api = await apiLogin()
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
        const api = await apiLogin()
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
        const api = await apiLogin()
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
        const api = await apiLogin()
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

    test('no prompt when queues match', async ({ page }) => {
        const api = await apiLogin()
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

            // Re-PUT right before reload to guard against parallel tests overwriting server state
            await api.put(`${API_V1}/player/state`, { data: matchingState })
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
})
