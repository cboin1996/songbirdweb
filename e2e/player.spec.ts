import { routes } from './routes'
import { test, expect, Page } from '@playwright/test'
import { USERNAME, PASSWORD, login, ignoreError, apiLogin, API_V1 } from './helpers'
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

test.describe('player bar', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('player bar appears after clicking a song', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        const card = lib.songCards.first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await player.waitForBar()
    })

    test('player shows track name of clicked song', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        const card = lib.songCards.filter({ hasText: /\w/ }).first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await player.waitForBar()
        await player.waitForTrackName()
    })

    test('play/pause button toggles playback', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        const player = new PlayerBar(page)
        await startPlayback(page)
        await expect(player.playPause).toBeVisible()

        await player.playPause.click()
        await player.playPause.click()

        expect(errors).toHaveLength(0)
    })

    test('shuffle button toggles active class', async ({ page }) => {
        const player = new PlayerBar(page)
        await startPlayback(page)
        await expect(player.shuffle).toBeVisible()

        const before = await player.shuffle.getAttribute('class')
        await player.shuffle.click()
        await expect(player.shuffle).not.toHaveAttribute('class', before || '')
        const after = await player.shuffle.getAttribute('class')
        expect(after).not.toEqual(before)

        await player.shuffle.click()
    })

    test('shuffle toggle off+on preserves shuffle order (no reshuffle)', async ({ page }) => {
        const player = new PlayerBar(page)
        const api = await apiLogin()
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 3, 'need at least 3 library songs')

            const order = songs.map((_, i) => i)
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: true, repeat: 'off',
                    queue: songs.map(s => s.uuid), queue_index: 0,
                    shuffle_order: order, shuffle_seed: 77777, shuffle_position: 0,
                },
            })

            await page.goto(routes.library)
            await player.waitForBar(10000)

            await expect(player.shuffle).toBeVisible()

            await player.shuffle.click()
            await page.waitForTimeout(300)
            await player.shuffle.click()

            await page.waitForResponse(
                r => r.url().includes('/player/state') && r.request().method() === 'PUT',
                { timeout: 10000 },
            )

            const stateRes = await api.get(`${API_V1}/player/state`)
            const state = await stateRes.json()
            expect(state.shuffle_seed).toBe(77777)
        } finally {
            await api.dispose()
        }
    })

    test('repeat cycles off → one → all → off', async ({ page }) => {
        const player = new PlayerBar(page)
        await startPlayback(page)
        await expect(player.repeat).toBeVisible()

        for (let i = 0; i < 3; i++) {
            const cls = await player.repeat.getAttribute('class') ?? ''
            if (cls.includes('text-gray-400')) break
            await player.repeat.click()
            await expect.poll(() => player.repeat.getAttribute('class'), { timeout: 2000 }).not.toBe(cls)
        }

        await player.repeat.click()
        await expect(player.repeat).toHaveClass(/text-sky-500/, { timeout: 2000 })
        await expect(player.repeat.locator('span')).toBeVisible({ timeout: 2000 })

        await player.repeat.click()
        await expect(player.repeat).toHaveClass(/text-sky-500/, { timeout: 2000 })
        await expect(player.repeat.locator('span')).toHaveCount(0)

        await player.repeat.click()
        await expect(player.repeat).toHaveClass(/text-gray-400/, { timeout: 2000 })
    })

    test('queue toggle shows and hides queue panel', async ({ page }) => {
        const player = new PlayerBar(page)
        await startPlayback(page)
        await expect(player.queueToggle).toBeVisible()

        await player.queueToggle.click()
        await expect(player.queueToggle).toHaveClass(/text-sky-500/, { timeout: 2000 })

        await player.queueToggle.click()
        await expect(player.queueToggle).toHaveClass(/text-gray-400/, { timeout: 2000 })
    })

    test('progress bar click seeks without error', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        const player = new PlayerBar(page)
        await startPlayback(page)

        await expect(player.progress).toBeVisible({ timeout: 5000 })

        const box = await player.progress.boundingBox()
        if (box) {
            await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
        }
        expect(errors).toHaveLength(0)
    })

    test('timestamps render in M:SS format', async ({ page }) => {
        const player = new PlayerBar(page)
        await startPlayback(page)

        await expect(player.progress).toBeVisible({ timeout: 5000 })
        await expect.poll(async () =>
            (await player.progress.textContent())?.match(/\d+:\d{2}/) ? true : false
        , { timeout: 5000 }).toBe(true)
    })

    test('player shows "from Library" context link', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        await lib.waitForSongs()
        await lib.playAllBtn.click()
        await player.waitForBar()
        await expect(player.contextLink(/from Library/i)).toBeVisible({ timeout: 10000 })
    })

    test('no console errors during playback', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error' && !ignoreError(msg.text())) errors.push(msg.text()) })
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await startPlayback(page)
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})

        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })

    // === Tier 2 player position persistence ===

    test('position persists across reload (>=4s into the same track)', async ({ page }) => {
        const player = new PlayerBar(page)
        const api = await apiLogin()
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string; properties?: { trackName?: string } }[]
            test.skip(!songs.length, 'need at least 1 library song')

            await api.patch(`${API_V1}/library/${songs[0].uuid}/position`, { data: { position: 15 } })
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: false, repeat: 'off',
                    queue: [songs[0].uuid], queue_index: 0,
                },
            })

            await page.goto(routes.library)
            await player.waitForBar(10000)
            await player.waitForTrackName()
            const initialName = await player.getTrackName()

            await expect.poll(async () => player.getProgressSeconds(), { timeout: 10000 }).toBeGreaterThanOrEqual(4)

            await page.reload()
            await player.waitForBar(10000)
            const restoredName = await player.getTrackName()
            expect(restoredName).toBe(initialName)

            const totalSec = await player.getProgressSeconds()
            expect(totalSec, `expected >=4s elapsed, got ${totalSec}`).toBeGreaterThanOrEqual(4)
        } finally {
            await api.dispose()
        }
    })

    // === Tier 2 per-song deep-linking (queue_sources) ===

    test('library songs: player link includes ?song=<uuid>', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        await lib.waitForSongs()

        const songId = await page.locator('[data-song-id]').first().getAttribute('data-song-id')
        expect(songId).toBeTruthy()

        await lib.playAllBtn.click()
        await player.waitForBar()

        const contextLink = player.contextLink(/from library/i)
        await expect(contextLink).toBeVisible({ timeout: 5000 })
        const href = await contextLink.locator('..').getAttribute('href')
        expect(href).toContain(`?song=${songId}`)
    })

    test('library genres: player link includes ?view=genres&song=<uuid>', async ({ page }) => {
        const player = new PlayerBar(page)
        await page.goto(routes.libraryGenres)
        const card = page.locator('[data-song-id]').first()
        await expect(card).toBeVisible({ timeout: 10000 })

        const songId = await card.getAttribute('data-song-id')
        expect(songId).toBeTruthy()

        await card.click()
        await player.waitForBar()

        const link = page.locator('a[href*="genres"]').first()
        const href = await link.getAttribute('href')
        expect(href).toContain(`genres`)
        expect(href).toContain(`song=${songId}`)
    })

    test('album card click opens modal with song list', async ({ page }) => {
        const lib = new LibraryPage(page)
        await page.goto(routes.libraryAlbums)
        const card = lib.albums().first()
        await expect(card).toBeVisible({ timeout: 10000 })

        await card.click()
        await expect(lib.albumModal()).toBeVisible({ timeout: 3000 })
    })

    test('album modal close dismisses on X button', async ({ page }) => {
        const lib = new LibraryPage(page)
        await page.goto(routes.libraryAlbums)
        const card = lib.albums().first()
        await expect(card).toBeVisible({ timeout: 10000 })

        await card.click()
        const modal = lib.albumModal()
        await expect(modal).toBeVisible({ timeout: 3000 })

        await modal.getByRole('button').filter({ has: page.locator('svg') }).last().click()
        await expect(modal).not.toBeVisible({ timeout: 3000 })
    })

    test('album play button starts playback with album context', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await page.goto(routes.libraryAlbums)
        const card = lib.albums().first()
        await expect(card).toBeVisible({ timeout: 10000 })

        const albumId = await card.getAttribute('data-album-id')
        expect(albumId).toBeTruthy()

        await lib.albumPlay(card).click({ force: true })
        await player.waitForBar()

        const link = page.locator('a[href*="albums"]').first()
        const href = await link.getAttribute('href')
        expect(href).toContain(`albums`)
        expect(href).toContain(`album=${albumId}`)
        expect(href).not.toContain(`song=`)
    })

    test('album play button toggles pause when same album is active', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await page.goto(routes.libraryAlbums)
        const card = lib.albums().first()
        await expect(card).toBeVisible({ timeout: 10000 })

        await lib.albumPlay(card).click({ force: true })
        await player.waitForBar()

        await lib.albumPlay(card).click({ force: true })
        await expect(player.playPause).toBeVisible()
    })

    test('queue_sources persists across reload (cross-session)', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        const api = await apiLogin()
        try {
        await lib.goto()
        await lib.waitForSongs()

        const songId = await page.locator('[data-song-id]').first().getAttribute('data-song-id')
        expect(songId).toBeTruthy()

        await lib.playAllBtn.click()
        await player.waitForBar()

        const linkBefore = page.locator('a[href*="library?song="]').first()
        const hrefBefore = await linkBefore.getAttribute('href')
        expect(hrefBefore).toContain(`song=${songId}`)

        await expect.poll(async () => {
            const r = await api.get(`${API_V1}/player/state`)
            if (!r.ok()) return null
            const body = await r.json()
            return body?.current_song_uuid
        }, { timeout: 10000 }).toBe(songId)

        await page.reload()

        await player.waitForBar()

        const linkAfter = page.locator('a[href*="library?song="]').first()
        const hrefAfter = await linkAfter.getAttribute('href')
        expect(hrefAfter).toContain(`song=${songId}`)
        } finally {
            await api.dispose()
        }
    })

    // === Queue drag-reorder ===

    test('queue drag preserves shuffle seed (shuffle on, regression test)', async ({ page }) => {
        const player = new PlayerBar(page)
        await startPlayback(page)

        const shuffleBtn = player.shuffle
        if (await shuffleBtn.getAttribute('aria-pressed') === 'true') await shuffleBtn.click()
        await shuffleBtn.click()

        const getSeed = () => page.evaluate(() => {
            try {
                const raw = localStorage.getItem('playerState')
                if (!raw) return null
                return (JSON.parse(raw) as { shuffle_seed?: number | null }).shuffle_seed ?? null
            } catch { return null }
        })
        await expect.poll(getSeed, { timeout: 5000, message: 'shuffle_seed should exist when shuffle is on' }).not.toBeNull()
        const seedBefore = await getSeed()

        await player.openQueue()

        const rows = player.queueRows()
        const rowCount = await rows.count()
        expect(rowCount, 'queue should have at least 2 rows to drag').toBeGreaterThanOrEqual(2)

        const firstRowName = await rows.nth(0).locator('p').first().textContent()
        const secondRowName = await rows.nth(1).locator('p').first().textContent()
        expect(firstRowName?.trim()).not.toBe(secondRowName?.trim())

        const dragHandle = player.queueDragHandle(rows.nth(1))
        await expect(dragHandle).toBeVisible({ timeout: 3000 })
        const dragSavePromise1 = page.waitForResponse(
            r => r.url().includes('/player/state') && r.request().method() === 'PUT',
            { timeout: 8000 }
        )
        await dragHandle.dragTo(rows.nth(0))
        await dragSavePromise1

        const seedAfter = await page.evaluate(() => {
            try {
                const raw = localStorage.getItem('playerState')
                if (!raw) return null
                return (JSON.parse(raw) as { shuffle_seed?: number | null }).shuffle_seed ?? null
            } catch { return null }
        })
        expect(seedAfter, 'shuffle_seed must NOT change after drag (regression test)').toBe(seedBefore)

        const newFirstRowName = await player.queueRows().nth(0).locator('p').first().textContent()
        expect(newFirstRowName?.trim()).toBe(secondRowName?.trim())
    })

    test('queue drag reorders song (shuffle off)', async ({ page }) => {
        const player = new PlayerBar(page)
        await startPlayback(page)

        const shuffleBtn = player.shuffle
        if (await shuffleBtn.getAttribute('aria-pressed') === 'true') {
            await shuffleBtn.click()
            await expect(shuffleBtn).toHaveAttribute('aria-pressed', 'false')
        }

        await player.openQueue()

        const rows = player.queueRows()
        const rowCount = await rows.count()
        expect(rowCount, 'queue should have at least 2 rows to drag').toBeGreaterThanOrEqual(2)

        const firstRowName = await rows.nth(0).locator('p').first().textContent()
        const secondRowName = await rows.nth(1).locator('p').first().textContent()
        expect(firstRowName?.trim()).not.toBe(secondRowName?.trim())

        const dragHandle = player.queueDragHandle(rows.nth(1))
        await expect(dragHandle).toBeVisible({ timeout: 3000 })
        const dragSavePromise2 = page.waitForResponse(
            r => r.url().includes('/player/state') && r.request().method() === 'PUT',
            { timeout: 8000 }
        )
        await dragHandle.dragTo(rows.nth(0))
        await dragSavePromise2

        const newFirstRowName = await player.queueRows().nth(0).locator('p').first().textContent()
        expect(newFirstRowName?.trim()).toBe(secondRowName?.trim())

        const newSecondRowName = await player.queueRows().nth(1).locator('p').first().textContent()
        expect(newSecondRowName?.trim()).toBe(firstRowName?.trim())
    })

    // === Regression tests: shuffle seed preservation during queue operations ===

    test('shuffle preserved when inserting next song', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        const api = await apiLogin()
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 2, 'need at least 2 library songs')

            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: true, repeat: 'off',
                    queue: songs.slice(0, 1).map(s => s.uuid), queue_index: 0,
                    shuffle_order: [0], shuffle_seed: 88888, shuffle_position: 0,
                },
            })

            await lib.goto()
            await player.waitForBar(10000)

            const targetCard = lib.songCards.nth(1)
            await expect(targetCard).toBeVisible({ timeout: 5000 })
            await targetCard.hover()
            await lib.kebab(targetCard).click()
            await page.getByRole('button', { name: /play next/i }).click()

            await page.waitForResponse(
                r => r.url().includes('/player/state') && r.request().method() === 'PUT',
                { timeout: 10000 },
            )

            const stateRes = await api.get(`${API_V1}/player/state`)
            const state = await stateRes.json()
            expect(state.shuffle_seed, 'shuffle_seed should not change when inserting next song').toBe(88888)
        } finally {
            await api.dispose()
        }
    })

    test('shuffle preserved when removing from queue', async ({ page }) => {
        const player = new PlayerBar(page)
        const api = await apiLogin()
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = (await libRes.json()) as { uuid: string }[]
            test.skip(songs.length < 3, 'need at least 3 library songs')

            const order = songs.slice(0, 3).map((_, i) => i)
            await api.put(`${API_V1}/player/state`, {
                data: {
                    shuffle: true, repeat: 'off',
                    queue: songs.slice(0, 3).map(s => s.uuid), queue_index: 0,
                    shuffle_order: order, shuffle_seed: 99999, shuffle_position: 0,
                },
            })

            await page.goto(routes.library)
            await player.waitForBar(10000)

            await player.openQueue()

            const rows = player.queueRows()
            await expect.poll(() => rows.count(), { timeout: 5000 }).toBeGreaterThanOrEqual(3)

            const removeBtn = player.queueRemoveBtn(rows.nth(1))
            await expect(removeBtn).toBeVisible({ timeout: 3000 })
            await removeBtn.click()

            await page.waitForResponse(
                r => r.url().includes('/player/state') && r.request().method() === 'PUT',
                { timeout: 10000 },
            )

            const stateRes = await api.get(`${API_V1}/player/state`)
            const state = await stateRes.json()
            expect(state.shuffle_seed, 'shuffle_seed should not change when removing from queue').toBe(99999)
        } finally {
            await api.dispose()
        }
    })

    test('Queued pill appears on manually inserted song', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        const api = await apiLogin()
        const libRes = await api.get(`${API_V1}/songs/library`)
        const songs = (await libRes.json()) as { uuid: string }[]
        test.skip(songs.length < 2, 'need at least 2 songs in library')
        await api.put(`${API_V1}/player/state`, {
            data: { shuffle: false, repeat: 'off', queue: [songs[0].uuid], queue_index: 0, manual_next: [] },
        })
        await api.dispose()

        await lib.goto()
        await player.waitForBar(10000)

        const targetCard = lib.songCards.nth(1)
        await expect(targetCard).toBeVisible({ timeout: 5000 })
        await targetCard.hover()
        await page.waitForTimeout(200)
        const kebab = lib.kebab(targetCard)
        await expect(kebab).toBeVisible({ timeout: 3000 })
        await kebab.click()
        await page.getByRole('button', { name: /play next/i }).click()
        await page.waitForTimeout(1500)

        await player.openQueue()
        await expect(player.queueRows().locator('span', { hasText: 'Queued' }).first()).toBeVisible({ timeout: 3000 })
    })
})
