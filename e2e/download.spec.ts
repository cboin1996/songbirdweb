import { routes, downloadSongQuery, downloadAlbumQuery, downloadUrlQuery } from './routes'
import { test, expect, Page } from '@playwright/test'
import { USERNAME, PASSWORD, login, ignoreError } from './helpers'
import { DownloadPage, PlayerBar } from './pages'


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
        const dl = new DownloadPage(page)
        await dl.goto()
        await expect(dl.songBtn).toBeVisible({ timeout: 5000 })
        await expect(dl.albumBtn).toBeVisible()
        await expect(dl.urlBtn).toBeVisible()
    })

    test('Song button switches to /download/song', async ({ page }) => {
        const dl = new DownloadPage(page)
        await dl.goto()
        await dl.songBtn.click()
        await expect(page).toHaveURL(/\/download\/song/)
    })

    test('Album button switches to /download/album', async ({ page }) => {
        const dl = new DownloadPage(page)
        await dl.goto()
        await dl.albumBtn.click()
        await expect(page).toHaveURL(/\/download\/album/)
    })

    test('URL button switches to /download/url', async ({ page }) => {
        const dl = new DownloadPage(page)
        await dl.goto()
        await dl.urlBtn.click()
        await expect(page).toHaveURL(/\/download\/url/)
    })

    // --- song search sub-page ---

    test('song search: results appear for "jolene"', async ({ page }) => {
        const dl = new DownloadPage(page)
        await dl.gotoSongSearch('jolene')
        const card = dl.songCards.filter({ hasText: /jolene/i }).first()
        await expect(card).toBeVisible({ timeout: 15000 })
    })

    test('song search: kebab menu opens on hover', async ({ page }) => {
        const dl = new DownloadPage(page)
        await dl.gotoSongSearch('sound of silence')
        const card = dl.songCards.first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await card.hover()
        await expect(dl.kebab(card)).toBeVisible({ timeout: 3000 })
    })

    test('song search: kebab menu shows expected actions', async ({ page }) => {
        const dl = new DownloadPage(page)
        await dl.gotoSongSearch('sound of silence')
        const card = dl.songCards.first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await card.hover()
        await dl.kebab(card).click()
        const menu = dl.kebabMenu()
        await expect(menu).toBeVisible({ timeout: 3000 })
        await expect(menu.getByRole('button', { name: /download/i })).toBeVisible()
        await expect(menu.getByRole('button', { name: /play next/i })).toBeVisible()
        await expect(menu.getByRole('button', { name: /edit/i })).toBeVisible()
        await page.keyboard.press('Escape')
    })

    test('song search: clicking card starts player', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        const dl = new DownloadPage(page)
        const player = new PlayerBar(page)
        await dl.gotoSongSearch('sound of silence')
        const card = dl.songCards.first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await card.click()
        await player.waitForBar()
        await expect(player.trackName).toBeVisible()

        expect(errors).toHaveLength(0)
    })

    test('song search: library bookmark button visible on card', async ({ page }) => {
        const dl = new DownloadPage(page)
        await dl.gotoSongSearch('sound of silence')
        const card = dl.songCards.first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await expect(dl.libraryToggle(card)).toBeVisible()
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

        const dl = new DownloadPage(page)
        await dl.goto()
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })

    // --- real flow tests (hit yt-dlp + iTunes; local only) ---

    test('/download/song flow downloads first iTunes result', async ({ page }) => {
        test.skip(!!process.env.CI, 'requires yt-dlp + network — local only')
        test.slow()

        const dl = new DownloadPage(page)
        const api = await import('./helpers').then(h => h.apiLogin())
        let songUuid: string | null = null

        try {
            await dl.gotoSongSearch('jolene')

            const itunesCard = dl.songCards
                .filter({ hasNot: page.getByTestId('song-kebab') })
                .first()
            await expect(itunesCard).toBeVisible({ timeout: 15000 })

            await itunesCard.click()
            await expect(dl.urlInput()).toBeVisible({ timeout: 5000 })

            await dl.urlInput().fill('https://archive.org/download/testmp3testfile/mpthreetest.mp3')

            await page.getByRole('button', { name: /^download$/i }).click()

            await page.getByRole('button', { name: 'add to library', exact: true }).click({ timeout: 90000 })

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

    test('/download/album flow finds tracks then downloads one', async ({ page }) => {
        test.skip(!!process.env.CI, 'requires yt-dlp + network — local only')
        test.slow()

        const dl = new DownloadPage(page)
        const api = await import('./helpers').then(h => h.apiLogin())
        let songUuid: string | null = null

        try {
            await dl.gotoAlbumSearch('rumours')

            const album = page.getByRole('button').filter({ hasText: /rumours/i }).first()
            await expect(album).toBeVisible({ timeout: 15000 })
            await album.click()

            await expect(page).toHaveURL(/\/download\/song\?.*lookup=true/, { timeout: 10000 })

            const itunesCard = dl.songCards
                .filter({ hasNot: page.getByTestId('song-kebab') })
                .first()
            await expect(itunesCard).toBeVisible({ timeout: 15000 })
            await itunesCard.click()

            await expect(dl.urlInput()).toBeVisible({ timeout: 5000 })
            await dl.urlInput().fill('https://archive.org/download/testmp3testfile/mpthreetest.mp3')
            await page.getByRole('button', { name: /^download$/i }).click()
            await page.getByRole('button', { name: /add to library/i }).click({ timeout: 90000 })

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
            const url = 'https://archive.org/download/testmp3testfile/mpthreetest.mp3'
            await page.goto(downloadUrlQuery(url))

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
            if (songUuid) {
                await api.delete(`/v1/library/${songUuid}`)
            }
            await api.dispose()
        }
    })

    // --- format-specific download + tag tests (local only) ---

    for (const format of ['mp3', 'm4a'] as const) {
        test(`download + tag as ${format}`, async ({ page }) => {
            test.skip(!!process.env.CI, 'requires yt-dlp + network — local only')
            test.slow()

            const dl = new DownloadPage(page)
            const api = await import('./helpers').then(h => h.apiLogin())
            let songUuid: string | null = null

            try {
                await api.put('/v1/settings', { data: { audio_format: format } })

                await dl.gotoSongSearch('jolene')

                const itunesCard = dl.songCards
                    .filter({ hasNot: page.getByTestId('song-kebab') })
                    .first()
                await expect(itunesCard).toBeVisible({ timeout: 15000 })

                await itunesCard.click()
                await expect(dl.urlInput()).toBeVisible({ timeout: 5000 })

                await dl.urlInput().fill('https://archive.org/download/testmp3testfile/mpthreetest.mp3')
                await page.getByRole('button', { name: /^download$/i }).click()

                await page.getByRole('button', { name: 'add to library', exact: true }).click({ timeout: 90000 })

                let found = false
                for (let i = 0; i < 30; i++) {
                    const res = await api.get('/v1/songs/library')
                    if (res.ok()) {
                        const songs = await res.json()
                        const song = songs.find((s: any) => s.properties?.trackName?.toLowerCase().includes('jolene'))
                        if (song) { songUuid = song.uuid; found = true; break }
                    }
                    await page.waitForTimeout(1000)
                }
                expect(found, `${format} song did not appear in library within 30s`).toBe(true)

                const fileRes = await api.get(`/v1/download/${songUuid}`)
                expect(fileRes.ok()).toBe(true)
                const contentType = fileRes.headers()['content-type']
                if (format === 'm4a') {
                    expect(contentType).toContain('audio/mp4')
                } else {
                    expect(contentType).toContain('audio/mpeg')
                }
            } finally {
                if (songUuid) await api.delete(`/v1/library/${songUuid}`)
                await api.put('/v1/settings', { data: { audio_format: 'mp3' } })
                await api.dispose()
            }
        })
    }
})
