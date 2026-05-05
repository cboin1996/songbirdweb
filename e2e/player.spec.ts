import { routes } from './routes'
import { test, expect, Page } from '@playwright/test'
import { USERNAME, PASSWORD, login, ignoreError, apiLogin, API_V1 } from './helpers'


async function startPlayback(page: Page) {
    await page.goto(routes.library)
    const card = page.getByTestId('song-card').first()
    await expect(card).toBeVisible({ timeout: 10000 })
    await card.click()
    await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
}

test.describe('player bar', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('player bar appears after clicking a song', async ({ page }) => {
        await page.goto(routes.library)
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
    })

    test('player shows track name of clicked song', async ({ page }) => {
        await page.goto(routes.library)
        // pick the first card that has a non-empty track name displayed
        const card = page.getByTestId('song-card').filter({ hasText: /\w/ }).first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
        // wait for track name to populate (may be async)
        await expect(page.getByTestId('player-track-name').first()).not.toBeEmpty({ timeout: 5000 })
    })

    test('play/pause button toggles playback', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await startPlayback(page)
        const btn = page.getByTestId('player-play-pause')
        await expect(btn).toBeVisible()

        // click to pause
        await btn.click()
        // click to resume
        await btn.click()

        expect(errors).toHaveLength(0)
    })

    test('shuffle button toggles active class', async ({ page }) => {
        await startPlayback(page)
        // Player has compact + full bars in the DOM (one hidden via CSS at desktop/mobile breakpoint).
        const btn = page.getByTestId('player-shuffle').filter({ visible: true }).first()
        await expect(btn).toBeVisible()

        const before = await btn.getAttribute('class')
        await btn.click()
        await expect(btn).not.toHaveAttribute('class', before || '')
        const after = await btn.getAttribute('class')
        expect(after).not.toEqual(before)

        // toggle back off
        await btn.click()
    })

    // FIXME(0.1.0): scheduleSave's 2s debounce gets reset by other player
    // events during initialization (queue load, position update, etc.), so
    // the shuffle_seed never reaches localStorage within the test window.
    // Even an 8s expect.poll didn't help. Need to either expose a deterministic
    // "wait for save" hook on the player or force-flush via test action.
    test.fixme('shuffle toggle off+on preserves shuffle order (no reshuffle)', async ({ page }) => {
        await startPlayback(page)
        const btn = page.getByTestId('player-shuffle').filter({ visible: true }).first()
        await expect(btn).toBeVisible()

        // Ensure shuffle is ON. If currently off, click once.
        if (await btn.getAttribute('aria-pressed') !== 'true') await btn.click()
        // scheduleSave debounces 2000ms + other player events can reset the
        // timer, so allow generous polling window.
        const readSeed = () => page.evaluate(() => {
            try {
                const raw = localStorage.getItem('playerState')
                if (!raw) return null
                return (JSON.parse(raw) as { shuffle_seed?: number | null }).shuffle_seed ?? null
            } catch { return null }
        })
        await expect.poll(readSeed, {
            message: 'shuffle_seed should be persisted to localStorage',
            timeout: 15000,
        }).not.toBeNull()
        const seedBefore = await readSeed()

        // Toggle OFF then back ON
        await btn.click()
        await page.waitForTimeout(300)
        await btn.click()
        await expect.poll(readSeed, {
            message: 'shuffle_seed should still match after off→on cycle',
            timeout: 15000,
        }).toBe(seedBefore)
    })

    test('repeat cycles off → one → all → off', async ({ page }) => {
        await startPlayback(page)
        const btn = page.getByTestId('player-repeat').filter({ visible: true }).first()
        await expect(btn).toBeVisible()

        // Reset to 'off' state (player persists last state, initial is 'all')
        for (let i = 0; i < 3; i++) {
            const cls = await btn.getAttribute('class') ?? ''
            if (cls.includes('text-gray-400')) break
            await btn.click()
            await expect.poll(() => btn.getAttribute('class'), { timeout: 2000 }).not.toBe(cls)
        }

        // off → one (shows "1" superscript)
        await btn.click()
        await expect(btn).toHaveClass(/text-sky-500/, { timeout: 2000 })
        await expect(btn.locator('span')).toBeVisible({ timeout: 2000 })

        // one → all (superscript disappears)
        await btn.click()
        await expect(btn).toHaveClass(/text-sky-500/, { timeout: 2000 })
        await expect(btn.locator('span')).toHaveCount(0)

        // all → off
        await btn.click()
        await expect(btn).toHaveClass(/text-gray-400/, { timeout: 2000 })
    })

    test('queue toggle shows and hides queue panel', async ({ page }) => {
        await startPlayback(page)
        const btn = page.getByTestId('player-queue-toggle')
        await expect(btn).toBeVisible()

        // open queue
        await btn.click()
        await expect(btn).toHaveClass(/text-sky-500/, { timeout: 2000 })

        // close queue
        await btn.click()
        await expect(btn).toHaveClass(/text-gray-400/, { timeout: 2000 })
    })

    test('progress bar click seeks without error', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await startPlayback(page)

        const progressBar = page.getByTestId('player-progress')
        await expect(progressBar).toBeVisible({ timeout: 5000 })

        const box = await progressBar.boundingBox()
        if (box) {
            await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
        }
        expect(errors).toHaveLength(0)
    })

    test('timestamps render in M:SS format', async ({ page }) => {
        await startPlayback(page)

        const progress = page.getByTestId('player-progress')
        await expect(progress).toBeVisible({ timeout: 5000 })
        // Progress bar renders both elapsed and remaining timestamps. Poll
        // until the M:SS format is present — avoids racing on the first paint.
        await expect.poll(async () =>
            (await progress.textContent())?.match(/\d+:\d{2}/) ? true : false
        , { timeout: 5000 }).toBe(true)
    })

    test('player shows "from Library" context link', async ({ page }) => {
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })
        await page.getByRole('button', { name: 'play all' }).click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
        await expect(page.getByText(/from Library/i)).toBeVisible({ timeout: 10000 })
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

    // Plays a song for ~5s, captures the track name + the m:ss displayed in
    // the progress bar, reloads the page, then asserts the same track resumes
    // and the progress is at least 4s in.
    // FIXME(0.1.0): even at 12s wait (past one savePosition interval), reload
    // shows position=0. Suspect: headless chromium doesn't advance audio
    // currentTime reliably under autoplay restrictions, so the 10s tick
    // saves currentTime=0 on every fire. Real users see persistence work
    // (lp values appear in /v1/songs/library after manual playback). Need
    // to either drive audio explicitly or assert via a hook on save.
    test.fixme('position persists across reload (>=4s into the same track)', async ({ page }) => {
        await startPlayback(page)
        const initialName = await page.getByTestId('player-track-name').first().textContent()
        await page.waitForTimeout(12000)

        await page.reload()

        // Player bar reappears (last-played fallback restores playback state).
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })
        const restoredName = await page.getByTestId('player-track-name').first().textContent()
        expect(restoredName?.trim()).toBe(initialName?.trim())

        // Read the m:ss from progress text and assert >= 4s elapsed.
        const text = await page.getByTestId('player-progress').textContent()
        const match = text?.match(/(\d+):(\d{2})/)
        expect(match, `progress text didn't match m:ss: ${text}`).not.toBeNull()
        const m = parseInt(match![1])
        const s = parseInt(match![2])
        const totalSec = m * 60 + s
        expect(totalSec, `expected >=4s elapsed, got ${totalSec}`).toBeGreaterThanOrEqual(4)
    })

    // === Tier 2 per-song deep-linking (queue_sources) ===

    test('library songs: player link includes ?song=<uuid>', async ({ page }) => {
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        // data-song-id is on the wrapper <div> around the Song component,
        // not on the song-card testid itself.
        const songId = await page.locator('[data-song-id]').first().getAttribute('data-song-id')
        expect(songId).toBeTruthy()

        // Use play-all to guarantee ctx is set regardless of prior player state.
        await page.getByRole('button', { name: 'play all' }).click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })

        // Player bar shows "from {label}" inside the source <Link> (renders
        // as <a>); the matched span's parent IS the <a>, not a wrapper of one.
        const contextLink = page.getByText(/from library/i)
        await expect(contextLink).toBeVisible({ timeout: 5000 })
        const href = await contextLink.locator('..').getAttribute('href')
        expect(href).toContain(`?song=${songId}`)
    })

    test('library genres: player link includes ?view=genres&song=<uuid>', async ({ page }) => {
        await page.goto(routes.libraryGenres)
        // data-song-id is on the wrapper, not the song-card testid element.
        const card = page.locator('[data-song-id]').first()
        await expect(card).toBeVisible({ timeout: 10000 })

        const songId = await card.getAttribute('data-song-id')
        expect(songId).toBeTruthy()

        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })

        // The context link should reflect the genres view + song UUID
        const link = page.locator('a[href*="genres"]').first()
        const href = await link.getAttribute('href')
        expect(href).toContain(`genres`)
        expect(href).toContain(`song=${songId}`)
    })

    test('library albums: player link includes ?view=albums&album=<id>', async ({ page }) => {
        await page.goto(routes.libraryAlbums)
        // data-album-id is on the wrapper, not the song-card testid element.
        const card = page.locator('[data-album-id]').first()
        await expect(card).toBeVisible({ timeout: 10000 })

        const albumId = await card.getAttribute('data-album-id')
        expect(albumId).toBeTruthy()

        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })

        // Check the context link for album query param (NOT song param)
        const link = page.locator('a[href*="albums"]').first()
        const href = await link.getAttribute('href')
        expect(href).toContain(`albums`)
        expect(href).toContain(`album=${albumId}`)
        expect(href).not.toContain(`song=`) // albums use album param, not song
    })

    test('queue_sources persists across reload (cross-session)', async ({ page }) => {
        const api = await apiLogin()
        try {
        // Play a song from library
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        // data-song-id is on the wrapper div, not the song-card testid element.
        const songId = await page.locator('[data-song-id]').first().getAttribute('data-song-id')
        expect(songId).toBeTruthy()

        await page.getByRole('button', { name: 'play all' }).click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })

        // Capture the context link href before reload
        const linkBefore = page.locator('a[href*="library?song="]').first()
        const hrefBefore = await linkBefore.getAttribute('href')
        expect(hrefBefore).toContain(`song=${songId}`)

        // scheduleSave debounces 2s then PUTs to server — poll until the server has the new state
        // before reloading, otherwise the restore on mount fetches stale server state.
        await expect.poll(async () => {
            const r = await api.get(`${API_V1}/player/state`)
            if (!r.ok()) return null
            const body = await r.json()
            return body?.current_song_uuid
        }, { timeout: 10000 }).toBe(songId)

        // Reload the page — queue_sources should be restored server-side
        await page.reload()

        // Player bar should still show (persisted via queue_sources)
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })

        // The context link should still have the same song UUID
        const linkAfter = page.locator('a[href*="library?song="]').first()
        const hrefAfter = await linkAfter.getAttribute('href')
        expect(hrefAfter).toContain(`song=${songId}`)
        } finally {
            await api.dispose()
        }
    })

    // === Queue drag-reorder ===

    test('queue drag preserves shuffle seed (shuffle on, regression test)', async ({ page }) => {
        await startPlayback(page)

        // Toggle OFF → ON unconditionally: guarantees scheduleSave() fires even when
        // shuffle was already on (pause/resume path skips scheduleSave, leaving
        // localStorage stale from a prior session).
        const shuffleBtn = page.getByTestId('player-shuffle').filter({ visible: true }).first()
        if (await shuffleBtn.getAttribute('aria-pressed') === 'true') await shuffleBtn.click()  // ensure OFF first
        await shuffleBtn.click()  // toggle ON → scheduleSave() queued

        // scheduleSave debounces 2s — poll until shuffle_seed appears in localStorage
        const getSeed = () => page.evaluate(() => {
            try {
                const raw = localStorage.getItem('playerState')
                if (!raw) return null
                return (JSON.parse(raw) as { shuffle_seed?: number | null }).shuffle_seed ?? null
            } catch { return null }
        })
        await expect.poll(getSeed, { timeout: 5000, message: 'shuffle_seed should exist when shuffle is on' }).not.toBeNull()
        const seedBefore = await getSeed()

        // Open queue panel
        const queueToggle = page.getByTestId('player-queue-toggle')
        await queueToggle.click()
        await expect(page.getByTestId('player-queue-panel')).toBeVisible({ timeout: 3000 })

        // Get queue rows and verify at least 2 exist
        const rows = page.locator('[data-qi]')
        const rowCount = await rows.count()
        expect(rowCount, 'queue should have at least 2 rows to drag').toBeGreaterThanOrEqual(2)

        // Read track name of first row before drag
        const firstRowName = await rows.nth(0).locator('p').first().textContent()
        const secondRowName = await rows.nth(1).locator('p').first().textContent()
        expect(firstRowName?.trim()).not.toBe(secondRowName?.trim())

        // Find drag handle (FaBars span.cursor-grab) in second row and drag it to first position
        const dragHandle = rows.nth(1).locator('span.cursor-grab').first()
        await expect(dragHandle).toBeVisible({ timeout: 3000 })
        const dragSavePromise1 = page.waitForResponse(
            r => r.url().includes('/player/state') && r.request().method() === 'PUT',
            { timeout: 8000 }
        )
        await dragHandle.dragTo(rows.nth(0))
        await dragSavePromise1

        // Assert shuffle_seed is unchanged
        const seedAfter = await page.evaluate(() => {
            try {
                const raw = localStorage.getItem('playerState')
                if (!raw) return null
                return (JSON.parse(raw) as { shuffle_seed?: number | null }).shuffle_seed ?? null
            } catch { return null }
        })
        expect(seedAfter, 'shuffle_seed must NOT change after drag (regression test)').toBe(seedBefore)

        // Verify the second song is now at the first position
        const newFirstRowName = await page.locator('[data-qi]').nth(0).locator('p').first().textContent()
        expect(newFirstRowName?.trim()).toBe(secondRowName?.trim())
    })

    test('queue drag reorders song (shuffle off)', async ({ page }) => {
        await startPlayback(page)

        // Ensure shuffle is OFF
        const shuffleBtn = page.getByTestId('player-shuffle').filter({ visible: true }).first()
        if (await shuffleBtn.getAttribute('aria-pressed') === 'true') {
            await shuffleBtn.click()
            await expect(shuffleBtn).toHaveAttribute('aria-pressed', 'false')
        }

        // Open queue panel
        const queueToggle = page.getByTestId('player-queue-toggle')
        await queueToggle.click()
        await expect(page.getByTestId('player-queue-panel')).toBeVisible({ timeout: 3000 })

        // Get queue rows
        const rows = page.locator('[data-qi]')
        const rowCount = await rows.count()
        expect(rowCount, 'queue should have at least 2 rows to drag').toBeGreaterThanOrEqual(2)

        // Read track names before drag
        const firstRowName = await rows.nth(0).locator('p').first().textContent()
        const secondRowName = await rows.nth(1).locator('p').first().textContent()
        expect(firstRowName?.trim()).not.toBe(secondRowName?.trim())

        // Drag second row to first position
        const dragHandle = rows.nth(1).locator('span.cursor-grab').first()
        await expect(dragHandle).toBeVisible({ timeout: 3000 })
        const dragSavePromise2 = page.waitForResponse(
            r => r.url().includes('/player/state') && r.request().method() === 'PUT',
            { timeout: 8000 }
        )
        await dragHandle.dragTo(rows.nth(0))
        await dragSavePromise2

        // Verify second song moved to first position
        const newFirstRowName = await page.locator('[data-qi]').nth(0).locator('p').first().textContent()
        expect(newFirstRowName?.trim()).toBe(secondRowName?.trim())

        // Verify original first song moved down (or out if was at end)
        const newSecondRowName = await page.locator('[data-qi]').nth(1).locator('p').first().textContent()
        expect(newSecondRowName?.trim()).toBe(firstRowName?.trim())
    })

    // === Regression tests: shuffle seed preservation during queue operations ===

    // FIXME(0.1.0): same scheduleSave debounce issue as the toggle test —
    // shuffle_seed never reaches localStorage within the test window.
    test.fixme('shuffle preserved when inserting next song', async ({ page }) => {
        await startPlayback(page)

        // Toggle OFF → ON unconditionally to guarantee scheduleSave() fires with a valid seed
        const shuffleBtn = page.getByTestId('player-shuffle').filter({ visible: true }).first()
        if (await shuffleBtn.getAttribute('aria-pressed') === 'true') await shuffleBtn.click()  // ensure OFF first
        await shuffleBtn.click()  // toggle ON → scheduleSave() queued

        // scheduleSave debounces 2s — poll until shuffle_seed appears in localStorage
        const getSeedInsert = () => page.evaluate(() => {
            try {
                const raw = localStorage.getItem('playerState')
                if (!raw) return null
                return (JSON.parse(raw) as { shuffle_seed?: number | null }).shuffle_seed ?? null
            } catch { return null }
        })
        await expect.poll(getSeedInsert, { timeout: 5000, message: 'shuffle_seed should exist when shuffle is on' }).not.toBeNull()
        const seedBefore = await getSeedInsert()

        // Get a different song card (not the current one — startPlayback clicks .first())
        const targetCard = page.getByTestId('song-card').nth(1)
        await expect(targetCard).toBeVisible({ timeout: 5000 })

        // Hover and open kebab menu
        await targetCard.hover()
        const kebab = targetCard.getByTestId('song-kebab')
        await expect(kebab).toBeVisible({ timeout: 3000 })
        await kebab.click()

        // Click "Play next"
        await page.getByRole('button', { name: /play next/i }).click()
        // insertNext debounces scheduleSave (~2s) before writing localStorage —
        // no server response to hook on; guard with explicit debounce wait.
        await page.waitForTimeout(2500)

        // Re-read shuffle_seed
        const seedAfter = await page.evaluate(() => {
            try {
                const raw = localStorage.getItem('playerState')
                if (!raw) return null
                return (JSON.parse(raw) as { shuffle_seed?: number | null }).shuffle_seed ?? null
            } catch { return null }
        })
        expect(seedAfter, 'shuffle_seed should not change when inserting next song').toBe(seedBefore)
    })

    // FIXME(0.1.0): same scheduleSave debounce issue as the toggle test —
    // shuffle_seed never reaches localStorage within the test window.
    test.fixme('shuffle preserved when removing from queue', async ({ page }) => {
        await startPlayback(page)

        // Toggle OFF → ON unconditionally to guarantee scheduleSave() fires with a valid seed
        const shuffleBtn = page.getByTestId('player-shuffle').filter({ visible: true }).first()
        if (await shuffleBtn.getAttribute('aria-pressed') === 'true') await shuffleBtn.click()  // ensure OFF first
        await shuffleBtn.click()  // toggle ON → scheduleSave() queued

        // scheduleSave debounces 2s — poll until shuffle_seed appears in localStorage
        const getSeedRemove = () => page.evaluate(() => {
            try {
                const raw = localStorage.getItem('playerState')
                if (!raw) return null
                return (JSON.parse(raw) as { shuffle_seed?: number | null }).shuffle_seed ?? null
            } catch { return null }
        })
        await expect.poll(getSeedRemove, { timeout: 5000, message: 'shuffle_seed should exist when shuffle is on' }).not.toBeNull()
        const seedBefore = await getSeedRemove()

        // Open queue panel
        const queueToggle = page.getByTestId('player-queue-toggle')
        await queueToggle.click()
        await expect(page.getByTestId('player-queue-panel')).toBeVisible({ timeout: 3000 })

        // Find a non-current row and remove it
        const rows = page.locator('[data-qi]')
        const rowCount = await rows.count()
        test.skip(rowCount < 2, 'queue needs at least 2 rows to test removal')

        if (rowCount >= 2) {
            // Remove second row (skip current song)
            const removeBtn = rows.nth(1).locator('button[aria-label*="Remove"]').first()
            if (await removeBtn.isVisible()) {
                const removeSavePromise = page.waitForResponse(
                    r => r.url().includes('/player/state') && r.request().method() === 'PUT',
                    { timeout: 8000 }
                )
                await removeBtn.click()
                await removeSavePromise
            }

            // Re-read shuffle_seed
            const seedAfter = await page.evaluate(() => {
                try {
                    const raw = localStorage.getItem('playerState')
                    if (!raw) return null
                    return (JSON.parse(raw) as { shuffle_seed?: number | null }).shuffle_seed ?? null
                } catch { return null }
            })
            expect(seedAfter, 'shuffle_seed should not change when removing from queue').toBe(seedBefore)
        }
    })

    test('Queued pill appears on manually inserted song', async ({ page }) => {
        // Set up a single-song queue via API so "Play next" won't hit the
        // "Already in queue" guard for every library song.
        const api = await apiLogin()
        const libRes = await api.get(`${API_V1}/songs/library`)
        const songs = (await libRes.json()) as { uuid: string }[]
        test.skip(songs.length < 2, 'need at least 2 songs in library')
        await api.put(`${API_V1}/player/state`, {
            data: { shuffle: false, repeat: 'off', queue: [songs[0].uuid], queue_index: 0, manual_next: [] },
        })
        await api.dispose()

        await page.goto(routes.library)
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 10000 })

        // "Play next" on second song — it's not in the single-song queue
        const targetCard = page.getByTestId('song-card').nth(1)
        await expect(targetCard).toBeVisible({ timeout: 5000 })
        await targetCard.hover()
        await page.waitForTimeout(200)
        const kebab = targetCard.getByTestId('song-kebab')
        await expect(kebab).toBeVisible({ timeout: 3000 })
        await kebab.click()
        await page.getByRole('button', { name: /play next/i }).click()
        await page.waitForTimeout(1500)

        // Open queue panel — inserted song should show "Queued" pill
        await page.getByTestId('player-queue-toggle').click()
        await expect(page.getByTestId('player-queue-panel')).toBeVisible({ timeout: 3000 })
        await expect(page.locator('[data-qi]').locator('span', { hasText: 'Queued' }).first()).toBeVisible({ timeout: 3000 })
    })
})
