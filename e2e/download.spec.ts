import { routes, downloadSongQuery, downloadAlbumQuery, downloadUrlQuery } from './routes'
import { test, expect, Page } from '@playwright/test'
import { USERNAME, PASSWORD, login, ignoreError } from './helpers'


test.describe('download page', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('unauthenticated user is redirected to root', async ({ page }) => {
        await page.context().clearCookies()
        await page.goto(routes.download)
        await expect(page).toHaveURL('/')
    })

    test('download page shows song, album, URL options', async ({ page }) => {
        await page.goto(routes.download)
        await expect(page.getByRole('button', { name: 'song', exact: true })).toBeVisible({ timeout: 5000 })
        await expect(page.getByRole('button', { name: 'album', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'url', exact: true })).toBeVisible()
    })

    test('Song button switches to /download/song', async ({ page }) => {
        await page.goto(routes.download)
        await page.getByRole('button', { name: 'song', exact: true }).click()
        await expect(page).toHaveURL(/\/download\/song/)
    })

    test('Album button switches to /download/album', async ({ page }) => {
        await page.goto(routes.download)
        await page.getByRole('button', { name: 'album', exact: true }).click()
        await expect(page).toHaveURL(/\/download\/album/)
    })

    test('URL button switches to /download/url', async ({ page }) => {
        await page.goto(routes.download)
        await page.getByRole('button', { name: 'url', exact: true }).click()
        await expect(page).toHaveURL(/\/download\/url/)
    })

    // --- song search sub-page ---

    test('song search: results appear for "jolene"', async ({ page }) => {
        await page.goto(downloadSongQuery('jolene'))
        const card = page.getByTestId('song-card').filter({ hasText: /jolene/i }).first()
        await expect(card).toBeVisible({ timeout: 15000 })
    })

    // Use a seeded library title so the first card is a library match (has songId).
    // Pure iTunes results have no songId → no kebab/library-toggle/playable file.
    test('song search: kebab menu opens on hover', async ({ page }) => {
        await page.goto(downloadSongQuery('sound of silence'))
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await card.hover()
        await expect(card.getByTestId('song-kebab')).toBeVisible({ timeout: 3000 })
    })

    test('song search: kebab menu shows expected actions', async ({ page }) => {
        await page.goto(downloadSongQuery('sound of silence'))
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await card.hover()
        await card.getByTestId('song-kebab').click()
        const menu = page.getByTestId('song-kebab-menu')
        await expect(menu).toBeVisible({ timeout: 3000 })
        await expect(menu.getByRole('button', { name: /download/i })).toBeVisible()
        await expect(menu.getByRole('button', { name: /play next/i })).toBeVisible()
        await expect(menu.getByRole('button', { name: /edit/i })).toBeVisible()
        await page.keyboard.press('Escape')
    })

    test('song search: clicking card starts player', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await page.goto(downloadSongQuery('sound of silence'))
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
        await expect(page.getByTestId('player-track-name')).toBeVisible()

        expect(errors).toHaveLength(0)
    })

    test('song search: library bookmark button visible on card', async ({ page }) => {
        await page.goto(downloadSongQuery('sound of silence'))
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await expect(card.getByTestId('song-library-toggle')).toBeVisible()
    })

    // --- URL download sub-page ---

    test('URL sub-page: status message is present', async ({ page }) => {
        await page.goto(routes.downloadUrl)
        await expect(page.getByText('no url provided')).toBeVisible({ timeout: 5000 })
    })

    test('no console errors on download page', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error' && !ignoreError(msg.text())) errors.push(msg.text()) })
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await page.goto(routes.download)
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })

    // --- real flow tests (hit yt-dlp + iTunes; local only) ---

    // Real-flow curation test: pick an iTunes match (no songId) → click card
    // → URL form opens → paste source URL → submit → tag with iTunes props →
    // add to library. This is the canonical "curate a new song" path.
    test('/download/song flow downloads first iTunes result', async ({ page }) => {
        test.skip(!!process.env.CI, 'requires yt-dlp + network — local only')
        test.slow()

        const api = await import('./helpers').then(h => h.apiLogin())
        let songUuid: string | null = null

        try {
            // 'jolene' is not in our seed library → first iTunes match leads.
            await page.goto(downloadSongQuery('jolene'))

            // iTunes cards have no kebab/library-toggle (no songId yet).
            const itunesCard = page.getByTestId('song-card')
                .filter({ hasNot: page.getByTestId('song-kebab') })
                .first()
            await expect(itunesCard).toBeVisible({ timeout: 15000 })

            // Click iTunes card → bottom URL form appears.
            await itunesCard.click()
            const urlInput = page.locator('input[type="url"]')
            await expect(urlInput).toBeVisible({ timeout: 5000 })

            // Stable Creative-Commons audio URL (yt-dlp supports archive.org direct).
            await urlInput.fill('https://archive.org/download/testmp3testfile/mpthreetest.mp3')

            // The submit button reads "download" in idle state.
            await page.getByRole('button', { name: /^download$/i }).click()

            // Once download+tag completes, the lowercase "add to library" submit
            // button appears in the bottom panel (distinct from the bookmark
            // toggle which has title="Add to library").
            await page.getByRole('button', { name: 'add to library', exact: true }).click({ timeout: 90000 })

            // Verify the song appears in the test user's library via API.
            let found = false
            for (let i = 0; i < 30; i++) {
                const res = await api.get(`/v1/songs/library`)
                if (res.ok()) {
                    const songs = await res.json()
                    const song = songs.find((s: any) => s.properties?.trackName?.toLowerCase().includes('jolene'))
                    if (song) { songUuid = song.uuid; found = true; break }
                }
                await page.waitForTimeout(1000)
            }
            expect(found, 'Song did not appear in library within 30s').toBe(true)
        } finally {
            if (songUuid) await api.delete(`/v1/library/${songUuid}`)
            await api.dispose()
        }
    })

    // Album flow: click album → redirects to song page filtered to its tracks
    // (collectionId+lookup=true), then download one track to prove the chain.
    // No bulk-select UI exists; per-track download is the canonical path.
    test('/download/album flow finds tracks then downloads one', async ({ page }) => {
        test.skip(!!process.env.CI, 'requires yt-dlp + network — local only')
        test.slow()

        const api = await import('./helpers').then(h => h.apiLogin())
        let songUuid: string | null = null

        try {
            await page.goto(downloadAlbumQuery('rumours'))

            // First album in the iTunes results.
            const album = page.getByRole('button').filter({ hasText: /rumours/i }).first()
            await expect(album).toBeVisible({ timeout: 15000 })
            await album.click()

            // Should redirect to /download/song with the album's tracks.
            await expect(page).toHaveURL(/\/download\/song\?.*lookup=true/, { timeout: 10000 })

            // Pick first iTunes track (no kebab — not yet downloaded).
            const itunesCard = page.getByTestId('song-card')
                .filter({ hasNot: page.getByTestId('song-kebab') })
                .first()
            await expect(itunesCard).toBeVisible({ timeout: 15000 })
            await itunesCard.click()

            const urlInput = page.locator('input[type="url"]')
            await expect(urlInput).toBeVisible({ timeout: 5000 })
            await urlInput.fill('https://archive.org/download/testmp3testfile/mpthreetest.mp3')
            await page.getByRole('button', { name: /^download$/i }).click()
            await page.getByRole('button', { name: /add to library/i }).click({ timeout: 90000 })

            let found = false
            for (let i = 0; i < 30; i++) {
                const res = await api.get(`/v1/songs/library`)
                if (res.ok()) {
                    const songs = await res.json()
                    // Latest-added song has the URL we just submitted.
                    const recent = songs.find((s: any) => s?.url?.includes('archive.org'))
                    if (recent) { songUuid = recent.uuid; found = true; break }
                }
                await page.waitForTimeout(1000)
            }
            expect(found, 'Album track did not appear in library within 30s').toBe(true)
        } finally {
            if (songUuid) await api.delete(`/v1/library/${songUuid}`)
            await api.dispose()
        }
    })

    test('/download/url flow downloads from youtube/audio URL', async ({ page }) => {
        test.skip(!!process.env.CI, 'requires yt-dlp + network — local only')
        test.slow()

        const api = await import('./helpers').then(h => h.apiLogin())
        let songUuid: string | null = null

        try {
            // The URL flow takes the source URL via query param. Search bar
            // above submits to /download/url?query=…; navigate directly here.
            const url = 'https://archive.org/download/testmp3testfile/mpthreetest.mp3'
            await page.goto(downloadUrlQuery(url))

            // Download starts automatically. After completion, "ready" state
            // shows an "add to library" button — user must click to commit.
            await page.getByRole('button', { name: 'add to library', exact: true }).click({ timeout: 90000 })

            let found = false
            for (let i = 0; i < 30; i++) {
                const res = await api.get(`/v1/songs/library`)
                if (res.ok()) {
                    const songs = await res.json()
                    const recent = songs.find((s: any) => s?.url?.includes('archive.org'))
                    if (recent) { songUuid = recent.uuid; found = true; break }
                }
                await page.waitForTimeout(1000)
            }
            expect(found, 'URL download did not appear in library within 30s').toBe(true)
        } finally {
            // Cleanup: delete the downloaded song via API
            if (songUuid) {
                await api.delete(`/v1/library/${songUuid}`)
            }
            await api.dispose()
        }
    })
})
