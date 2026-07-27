import { routes } from './routes'
import { test, expect, Page } from '@playwright/test'
import { PLAYER_USERNAME, PLAYER_PASSWORD, login, ignoreError, apiLoginAs, API_V1 } from './helpers'
import { LibraryPage, PlayerBar } from './pages'

async function startPlayback(page: Page) {
    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    await lib.goto()
    const card = lib.songCards.first()
    await expect(card).toBeVisible({ timeout: 10000 })
    await card.click()
    await player.waitForBar()
}

test.describe('expanded player', () => {
    test.describe.configure({ mode: 'serial' })
    test.use({ storageState: 'e2e/.auth/player-user.json' })

    test.beforeEach(async ({ page }) => {
        await login(page, PLAYER_USERNAME, PLAYER_PASSWORD)
    })

    test('artwork button opens expanded overlay', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await startPlayback(page)
        await page.getByTestId('player-expand-art').click()
        await expect(page.getByTestId('player-expanded')).toBeVisible({ timeout: 5000 })
        expect(errors).toHaveLength(0)
    })

    test('chevron closes expanded overlay', async ({ page }) => {
        await startPlayback(page)
        await page.getByTestId('player-expand-art').click()
        const overlay = page.getByTestId('player-expanded')
        await expect(overlay).toBeVisible({ timeout: 5000 })

        await overlay.getByRole('button', { name: /close/i }).click()
        await expect(overlay).toHaveCount(0, { timeout: 3000 })
    })

    test('ESC key closes expanded overlay', async ({ page }) => {
        await startPlayback(page)
        await page.getByTestId('player-expand-art').click()
        await expect(page.getByTestId('player-expanded')).toBeVisible({ timeout: 5000 })

        await page.keyboard.press('Escape')
        await expect(page.getByTestId('player-expanded')).toHaveCount(0, { timeout: 3000 })
    })

    test('queue tab shows queue rows', async ({ page }) => {
        const api = await apiLoginAs(PLAYER_USERNAME, PLAYER_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 2, 'need at least 2 library songs')

            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'all',
                    queue: songs.slice(0, 3).map(s => s.uuid),
                    queue_index: 0,
                    manual_next: [],
                    current_song_uuid: songs[0].uuid,
                },
            })
        } finally {
            await api.dispose()
        }

        await page.goto(routes.library)
        const player = new PlayerBar(page)
        await player.waitForBar()

        await page.getByTestId('player-expand-art').click()
        const overlay = page.getByTestId('player-expanded')
        await expect(overlay).toBeVisible({ timeout: 5000 })

        await overlay.getByRole('button', { name: /toggle queue/i }).click()
        await expect(overlay.locator('[data-qi]').first()).toBeVisible({ timeout: 3000 })
    })

    test('tapping queue row plays song and shows now-playing tab', async ({ page }) => {
        const api = await apiLoginAs(PLAYER_USERNAME, PLAYER_PASSWORD)
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 2, 'need at least 2 library songs')

            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'all',
                    queue: songs.slice(0, 3).map(s => s.uuid),
                    queue_index: 0,
                    manual_next: [],
                    current_song_uuid: songs[0].uuid,
                },
            })
        } finally {
            await api.dispose()
        }

        await page.goto(routes.library)
        const player = new PlayerBar(page)
        await player.waitForBar()

        await page.getByTestId('player-expand-art').click()
        const overlay = page.getByTestId('player-expanded')
        await expect(overlay).toBeVisible({ timeout: 5000 })

        await overlay.getByRole('button', { name: /toggle queue/i }).click()
        const rows = overlay.locator('[data-qi]')
        await expect(rows.first()).toBeVisible({ timeout: 3000 })

        await rows.nth(1).locator('button').first().click()

        // After tapping a queue row, overlay should switch back to now-playing (art visible)
        await expect(overlay.locator('img[alt=""]').last()).toBeVisible({ timeout: 3000 })
    })
})
