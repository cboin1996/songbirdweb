import { routes } from './routes'
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
        await page.goto('/download/song?query=jolene')
        const card = page.getByTestId('song-card').filter({ hasText: /jolene/i }).first()
        await expect(card).toBeVisible({ timeout: 15000 })
    })

    test('song search: kebab menu opens on hover', async ({ page }) => {
        await page.goto('/download/song?query=jolene')
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await card.hover()
        await expect(card.getByTestId('song-kebab')).toBeVisible({ timeout: 3000 })
    })

    test('song search: kebab menu shows expected actions', async ({ page }) => {
        await page.goto('/download/song?query=jolene')
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

        await page.goto('/download/song?query=jolene')
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
        await expect(page.getByTestId('player-track-name')).toBeVisible()

        expect(errors).toHaveLength(0)
    })

    test('song search: library bookmark button visible on card', async ({ page }) => {
        await page.goto('/download/song?query=jolene')
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await expect(card.getByTestId('song-library-toggle')).toBeVisible()
    })

    // --- URL download sub-page ---

    test('URL sub-page: status message is present', async ({ page }) => {
        await page.goto(routes.downloadUrl)
        await expect(page.getByText('enter a url')).toBeVisible({ timeout: 5000 })
    })

    test('no console errors on download page', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error' && !ignoreError(msg.text())) errors.push(msg.text()) })
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await page.goto(routes.download)
        await page.waitForTimeout(1000)
        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })

    // --- real flow tests (hit yt-dlp + iTunes; local only) ---

    test('/download/song flow downloads first iTunes result', async ({ page }) => {
        test.skip(!!process.env.CI, 'requires yt-dlp + network — local only')
        test.slow()

        const api = await import('./helpers').then(h => h.apiLogin())
        let songUuid: string | null = null

        try {
            // Navigate to song download with reliable iTunes hit
            await page.goto('/download/song?query=jolene')
            const card = page.getByTestId('song-card').first()
            await expect(card).toBeVisible({ timeout: 15000 })

            // Click kebab menu and select download
            await card.hover()
            await card.getByTestId('song-kebab').click()
            const menu = page.getByTestId('song-kebab-menu')
            await expect(menu).toBeVisible({ timeout: 3000 })
            await menu.getByRole('button', { name: /download/i }).click()

            // Wait for song to appear in library
            let found = false
            for (let i = 0; i < 30; i++) {
                const res = await api.get(`/v1/songs/library`)
                if (res.ok()) {
                    const songs = await res.json()
                    const song = songs.find((s: any) => s.properties?.trackName?.toLowerCase().includes('jolene'))
                    if (song) {
                        songUuid = song.uuid
                        found = true
                        break
                    }
                }
                await page.waitForTimeout(1000)
            }
            expect(found, 'Song did not appear in library within 30s').toBe(true)
        } finally {
            // Cleanup: delete the downloaded song via API
            if (songUuid) {
                await api.delete(`/v1/songs/${songUuid}`)
            }
            await api.dispose()
        }
    })

    test('/download/album flow downloads selected tracks from album', async ({ page }) => {
        test.skip(!!process.env.CI, 'requires yt-dlp + network — local only')
        test.slow()

        const api = await import('./helpers').then(h => h.apiLogin())
        const songUuids: string[] = []

        try {
            // Navigate to album download search
            await page.goto('/download/album?query=rumours')
            await page.waitForTimeout(2000)

            // Look for album result and click it
            const albumResult = page.locator('[data-testid="album-result"]').first()
            if (await albumResult.isVisible({ timeout: 10000 })) {
                await albumResult.click()
                await page.waitForTimeout(2000)
            }

            // Select first track checkbox
            const trackCheckbox = page.locator('input[type="checkbox"]').first()
            if (await trackCheckbox.isVisible({ timeout: 5000 })) {
                await trackCheckbox.click()
            }

            // Click download button
            const downloadBtn = page.getByRole('button', { name: /download/i }).first()
            if (await downloadBtn.isVisible({ timeout: 5000 })) {
                await downloadBtn.click()
            }

            // Wait for tracks to appear in library
            let found = false
            for (let i = 0; i < 30; i++) {
                const res = await api.get(`/v1/songs/library`)
                if (res.ok()) {
                    const songs = await res.json()
                    const newSongs = songs.filter((s: any) => !songUuids.includes(s.uuid))
                    if (newSongs.length > 0) {
                        newSongs.forEach((s: any) => songUuids.push(s.uuid))
                        found = true
                        break
                    }
                }
                await page.waitForTimeout(1000)
            }
            expect(found, 'Album tracks did not appear in library within 30s').toBe(true)
        } finally {
            // Cleanup: delete all downloaded songs via API
            for (const uuid of songUuids) {
                await api.delete(`/v1/songs/${uuid}`)
            }
            await api.dispose()
        }
    })

    test('/download/url flow downloads from youtube/audio URL', async ({ page }) => {
        test.skip(!!process.env.CI, 'requires yt-dlp + network — local only')
        test.slow()

        const api = await import('./helpers').then(h => h.apiLogin())
        let songUuid: string | null = null

        try {
            // Navigate to URL download
            await page.goto('/download/url')
            await expect(page.getByText('enter a url')).toBeVisible({ timeout: 5000 })

            // Paste a public domain / stable URL (Creative Commons audio)
            const urlInput = page.locator('input[type="url"]')
            await expect(urlInput).toBeVisible({ timeout: 5000 })
            // Using a short Creative Commons audio track from archive.org
            await urlInput.fill('https://archive.org/download/testmp3testfile/mpthreetest.mp3')
            await page.waitForTimeout(500)

            // Submit form
            await page.getByRole('button', { name: 'download', exact: true }).click()

            // Wait for download to complete and song to appear in library
            let found = false
            for (let i = 0; i < 30; i++) {
                const res = await api.get(`/v1/songs/library`)
                if (res.ok()) {
                    const songs = await res.json()
                    // Look for a song added in the last 60 seconds
                    const recentSong = songs.find((s: any) => {
                        const added = new Date(s.properties?.dateAdded).getTime()
                        return Date.now() - added < 60000
                    })
                    if (recentSong) {
                        songUuid = recentSong.uuid
                        found = true
                        break
                    }
                }
                await page.waitForTimeout(1000)
            }
            expect(found, 'URL download did not appear in library within 30s').toBe(true)
        } finally {
            // Cleanup: delete the downloaded song via API
            if (songUuid) {
                await api.delete(`/v1/songs/${songUuid}`)
            }
            await api.dispose()
        }
    })
})
