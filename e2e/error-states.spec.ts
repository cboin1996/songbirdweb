import { routes, editSongRoute, downloadSongQuery, downloadAlbumQuery } from './routes'
import { test, expect } from '@playwright/test'
import { login, apiLoginAs, expectStable, API_V1, ERROR_USERNAME, ERROR_PASSWORD, libraryIds } from './helpers'
import { EditorPage, CommonPage, LibraryPage, DownloadPage, PlayerBar } from './pages'

test.use({ storageState: 'e2e/.auth/error-user.json' })

test.describe('error states — page boundaries', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, ERROR_USERNAME, ERROR_PASSWORD)
    })

    test('import page shows QueryError when jobs API fails', async ({ page }) => {
        const common = new CommonPage(page)
        await page.route('**/v1/import?*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )
        await page.goto(routes.import)
        await expect(common.queryError('import-history')).toBeVisible({ timeout: 10000 })
    })

    test('import page retry button recovers after error', async ({ page }) => {
        const common = new CommonPage(page)
        let blocked = true
        await page.route('**/v1/import?*', route => {
            if (blocked) return route.fulfill({ status: 500, body: 'Internal Server Error' })
            return route.continue()
        })
        await page.goto(routes.import)
        const qe = common.queryError('import-history')
        await expect(qe).toBeVisible({ timeout: 10000 })

        blocked = false
        await qe.getByRole('button', { name: 'retry' }).click()
        await expect(qe).not.toBeVisible({ timeout: 10000 })
    })

    test('admin page shows QueryError when edit-jobs API fails', async ({ page }) => {
        const common = new CommonPage(page)
        await page.route('**/v1/admin/edit-jobs*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )
        await page.goto(routes.admin)
        await expect(common.queryError('edit-jobs')).toBeVisible({ timeout: 10000 })
    })

    test('admin page shows QueryError when errors API fails', async ({ page }) => {
        const common = new CommonPage(page)
        await page.route('**/v1/admin/errors*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )
        await page.goto(routes.admin)
        await expect(common.queryError('errors')).toBeVisible({ timeout: 10000 })
    })

    test('admin page shows QueryError when imports API fails', async ({ page }) => {
        const common = new CommonPage(page)
        await page.route('**/v1/admin/imports*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )
        await page.goto(routes.admin)
        await expect(common.queryError('imports')).toBeVisible({ timeout: 10000 })
    })

    test('admin page shows QueryError when users API fails', async ({ page }) => {
        const common = new CommonPage(page)
        await page.route('**/v1/admin/users*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )
        await page.goto(routes.admin)
        await expect(common.queryError('users')).toBeVisible({ timeout: 10000 })
    })

    test('admin page shows QueryError when stats API fails', async ({ page }) => {
        const common = new CommonPage(page)
        await page.route('**/v1/admin/stats*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )
        await page.goto(routes.admin)
        await expect(common.queryError('system-stats')).toBeVisible({ timeout: 10000 })
    })

    test('admin edit-jobs retry recovers after error', async ({ page }) => {
        const common = new CommonPage(page)
        let blocked = true
        await page.route('**/v1/admin/edit-jobs*', route => {
            if (blocked) return route.fulfill({ status: 500, body: 'Internal Server Error' })
            return route.continue()
        })
        await page.goto(routes.admin)
        const qe = common.queryError('edit-jobs')
        await expect(qe).toBeVisible({ timeout: 10000 })

        blocked = false
        await qe.getByRole('button', { name: 'retry' }).click()
        await expect(qe).not.toBeVisible({ timeout: 10000 })
    })

    test('admin imports retry recovers after error', async ({ page }) => {
        const common = new CommonPage(page)
        let blocked = true
        await page.route('**/v1/admin/imports*', route => {
            if (blocked) return route.fulfill({ status: 500, body: 'Internal Server Error' })
            return route.continue()
        })
        await page.goto(routes.admin)
        const qe = common.queryError('imports')
        await expect(qe).toBeVisible({ timeout: 10000 })

        blocked = false
        await qe.getByRole('button', { name: 'retry' }).click()
        await expect(qe).not.toBeVisible({ timeout: 10000 })
    })

    test('admin users retry recovers after error', async ({ page }) => {
        const common = new CommonPage(page)
        let blocked = true
        await page.route('**/v1/admin/users*', route => {
            if (blocked) return route.fulfill({ status: 500, body: 'Internal Server Error' })
            return route.continue()
        })
        await page.goto(routes.admin)
        const qe = common.queryError('users')
        await expect(qe).toBeVisible({ timeout: 10000 })

        blocked = false
        await qe.getByRole('button', { name: 'retry' }).click()
        await expect(qe).not.toBeVisible({ timeout: 10000 })
    })
})

test.describe('error states — mutations', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, ERROR_USERNAME, ERROR_PASSWORD)
    })

    test('remove from library shows error on failure', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        await page.route('**/v1/library/*', route => {
            if (route.request().method() === 'DELETE')
                return route.fulfill({ status: 500, body: 'Internal Server Error' })
            return route.continue()
        })

        const card = library.songCards.first()
        await library.libraryToggle(card).click()
        await expect(common.toastError).toContainText('could not remove from library', { timeout: 10000 })
    })

    test('change password shows error on failure', async ({ page }) => {
        await page.goto(routes.settings)
        await expect(page.getByPlaceholder('current password')).toBeVisible({ timeout: 10000 })

        await page.route('**/v1/auth/password', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )
        await page.getByPlaceholder('current password').fill('anything')
        await page.getByPlaceholder('new password', { exact: true }).fill('newpass123')
        await page.getByPlaceholder('confirm new password').fill('newpass123')
        await page.getByRole('button', { name: /update password/i }).click()
        await expect(page.getByText('server unavailable')).toBeVisible({ timeout: 5000 })
    })

    test('file upload shows failed status on error', async ({ page }) => {
        const common = new CommonPage(page)
        await page.route('**/v1/import*', route => {
            if (route.request().method() === 'POST')
                return route.fulfill({ status: 500, body: 'Internal Server Error' })
            if (route.request().method() === 'GET')
                return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0, jobs: [], status_counts: {} }) })
            return route.continue()
        })
        await page.goto(routes.import)
        await expect(common.importFileInput).toBeAttached({ timeout: 10000 })

        const buffer = Buffer.from('fake mp3 content for test')
        await common.importFileInput.setInputFiles({
            name: 'test-error.mp3',
            mimeType: 'audio/mpeg',
            buffer,
        })
        await expect(page.getByText('upload failed')).toBeVisible({ timeout: 10000 })
    })
})

test.describe('error states — editor', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, ERROR_USERNAME, ERROR_PASSWORD)
    })

    test('save to library shows toast on failure', async ({ page }) => {
        const editor = new EditorPage(page)
        const common = new CommonPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await editor.normalizeCheckbox.click()

        await page.route('**/v1/edit/songs/*', route => {
            if (route.request().method() === 'POST')
                return route.fulfill({ status: 500, body: 'Internal Server Error' })
            return route.continue()
        })

        await editor.saveToLibraryBtn.click()
        await expect(common.toastError).toBeVisible({ timeout: 5000 })
    })

    test('save draft shows toast on failure', async ({ page }) => {
        const editor = new EditorPage(page)
        const common = new CommonPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await editor.normalizeCheckbox.click()

        await page.route('**/v1/edit/songs/*/draft', route => {
            if (route.request().method() === 'PUT')
                return route.fulfill({ status: 500, body: 'Internal Server Error' })
            return route.continue()
        })

        await editor.saveDraftBtn.click()
        await expect(common.toastError).toContainText('draft save failed', { timeout: 5000 })
    })

    test('discard shows toast on failure', async ({ page }) => {
        const editor = new EditorPage(page)
        const common = new CommonPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await editor.normalizeCheckbox.click()

        await page.route('**/v1/edit/songs/*/draft', route => {
            if (route.request().method() === 'DELETE')
                return route.fulfill({ status: 500, body: 'Internal Server Error' })
            return route.continue()
        })

        await editor.discardBtn.click()
        await expect(common.toastError).toContainText('could not discard draft', { timeout: 5000 })
    })

    test('close with draft save failure shows banner', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await editor.addCutBtn.click()

        await page.route('**/v1/edit/songs/*/draft', route => {
            if (route.request().method() === 'PUT')
                return route.fulfill({ status: 500, body: 'Internal Server Error' })
            return route.continue()
        })

        await editor.closeBtn.click()
        await expect(editor.draftSaveFailedBanner).toBeVisible({ timeout: 5000 })
        await expect(editor.draftSaveFailedBanner.getByText('exit without saving')).toBeVisible()
    })

    test('waveform load error shows QueryError above each waveform', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        await page.goto(routes.library)
        await expect(library.songCards.first()).toBeVisible({ timeout: 10000 })

        const songId = await library.songCards.first().getAttribute('data-song-id')

        await page.route('**/v1/download/*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )

        await page.goto(editSongRoute(songId!))
        await expect(common.queryError('original-audio')).toBeVisible({ timeout: 15000 })
        await expect(common.queryError('edited-audio')).toBeVisible({ timeout: 5000 })
    })

    test('editor page shows QueryError when song data fails to load', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        await page.goto(routes.library)
        await expect(library.songCards.first()).toBeVisible({ timeout: 10000 })
        const songId = await library.songCards.first().getAttribute('data-song-id')

        await page.route('**/v1/songs/library*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )

        await page.goto(editSongRoute(songId!))
        await expect(common.queryError('song-editor')).toBeVisible({ timeout: 10000 })
    })
})

test.describe('error states — library', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, ERROR_USERNAME, ERROR_PASSWORD)
    })

    test('library shows QueryError when API fails', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        await page.route('**/v1/songs/library*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )

        await page.reload()
        await expect(common.queryError('your-library')).toBeVisible({ timeout: 10000 })
    })
})

test.describe('error states — explore', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, ERROR_USERNAME, ERROR_PASSWORD)
    })

    test('explore shows QueryError when API fails', async ({ page }) => {
        const common = new CommonPage(page)
        await page.route('**/v1/songs/explore*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )
        await page.goto(routes.explore)
        await expect(common.queryError('explore')).toBeVisible({ timeout: 10000 })
    })
})

test.describe('error states — info', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, ERROR_USERNAME, ERROR_PASSWORD)
    })

    test('info page shows QueryError when version API fails', async ({ page }) => {
        const common = new CommonPage(page)
        await page.route('**/v1/version*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )
        await page.goto(routes.info)
        await expect(common.queryError('app-info')).toBeVisible({ timeout: 10000 })
    })
})

test.describe('error states — download', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, ERROR_USERNAME, ERROR_PASSWORD)
    })

    test('song search shows QueryError when API fails', async ({ page }) => {
        const common = new CommonPage(page)
        await page.route('**/v1/properties/itunes*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )
        await page.goto(downloadSongQuery('test'))
        await expect(common.queryError('search-results')).toBeVisible({ timeout: 10000 })
    })

    test('album search shows QueryError when API fails', async ({ page }) => {
        const common = new CommonPage(page)
        await page.route('**/v1/properties/itunes*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )
        await page.goto(downloadAlbumQuery('test'))
        await expect(common.queryError('search-results')).toBeVisible({ timeout: 10000 })
    })

    test('URL download shows error on failure', async ({ page }) => {
        await page.route('**/v1/download', route => {
            if (route.request().method() === 'POST')
                return route.fulfill({ status: 500, body: 'Internal Server Error' })
            return route.continue()
        })
        const download = new DownloadPage(page)
        await download.gotoUrlDownload('https://example.com/song.mp3')
        await expect(page.getByText('download failed')).toBeVisible({ timeout: 15000 })
    })
})

test.describe('error states — song card actions', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, ERROR_USERNAME, ERROR_PASSWORD)
    })

    test('share link shows toast on failure', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        await page.route('**/v1/share/songs/*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )

        const card = library.songCards.first()
        await library.kebab(card).click()
        await library.kebabMenu().getByText('Copy share link').click()
        await expect(common.toastError).toContainText('failed to create share link', { timeout: 5000 })
    })

    test('download file shows toast on failure', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        // Only the kebab's own fetch, not the audio element: the player shares
        // this endpoint, and a restored queue failing here would put its own
        // toast up in place of the one under test.
        await page.route('**/v1/download/*', route =>
            route.request().resourceType() === 'media'
                ? route.continue()
                : route.fulfill({ status: 500, body: 'Internal Server Error' })
        )

        const card = library.songCards.first()
        await library.kebab(card).click()
        await library.kebabMenu().getByText('Download').click()
        await expect(common.toastError).toContainText('download failed', { timeout: 5000 })
    })

    test('save offline shows toast when cache fails', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        // Audio requests pass through — see the note on the download test above.
        await page.route('**/v1/download/*', route =>
            route.request().resourceType() === 'media'
                ? route.continue()
                : route.fulfill({ status: 500, body: 'Internal Server Error' })
        )

        const card = library.songCards.first()
        await library.kebab(card).click()
        await library.kebabMenu().getByText('Save offline').click()
        await expect(common.toastError).toContainText('could not save offline', { timeout: 5000 })
    })

    test('save offline shows toast when server sync fails', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        await page.route('**/v1/library/offline/*', route => {
            if (route.request().method() === 'POST')
                return route.fulfill({ status: 500, body: 'Internal Server Error' })
            return route.continue()
        })

        const card = library.songCards.first()
        await library.kebab(card).click()
        await library.kebabMenu().getByText('Save offline').click()
        await expect(common.toastError).toContainText('could not save offline', { timeout: 15000 })
    })

    test('remove offline shows toast when server sync fails', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        // First save a song offline successfully
        const card = library.songCards.first()
        await library.kebab(card).click()
        await library.kebabMenu().getByText('Save offline').click()
        await expect(card.getByTitle('Remove offline copy')).toBeVisible({ timeout: 15000 })

        // Now block server DELETE and try to remove
        await page.route('**/v1/library/offline/*', route => {
            if (route.request().method() === 'DELETE')
                return route.fulfill({ status: 500, body: 'Internal Server Error' })
            return route.continue()
        })

        await library.kebab(card).click()
        await library.kebabMenu().getByText('Remove offline copy').click()
        await expect(common.toastError).toContainText('could not remove offline', { timeout: 5000 })
    })

    test('add to playlist shows toast on failure', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        const api = await apiLoginAs(ERROR_USERNAME, ERROR_PASSWORD)
        try {
            const created = await api.post(`${API_V1}/playlists`, { data: { name: 'e2e-err-pl', icon: 'music' } })
            const pl = await created.json()

            await page.goto(routes.library)
            await library.waitForSongs()

            await page.route('**/v1/playlists/*/songs', route => {
                if (route.request().method() === 'POST')
                    return route.fulfill({ status: 500, body: 'Internal Server Error' })
                return route.continue()
            })

            const card = library.songCards.first()
            await library.kebab(card).click()
            await library.kebabMenu().getByText('Add to playlist').click()
            await page.getByText('e2e-err-pl').click()
            await expect(common.toastError).toContainText('failed to add to playlist', { timeout: 5000 })

            await api.delete(`${API_V1}/playlists/${pl.id}`)
        } finally {
            await api.dispose()
        }
    })
})

test.describe('error states — bulk operations', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, ERROR_USERNAME, ERROR_PASSWORD)
    })

    test('bulk remove from library shows toast on failure', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        await page.route('**/v1/library/bulk', route => {
            if (route.request().method() === 'DELETE')
                return route.fulfill({ status: 500, body: 'Internal Server Error' })
            return route.continue()
        })

        await library.enterSelectMode()
        await expect(library.cancelBtn).toBeVisible({ timeout: 3000 })
        await library.songCards.first().click()
        await expect(library.selectedCount()).toBeVisible({ timeout: 3000 })
        await library.bulkRemoveBtn.click()
        await expect(common.toastError).toContainText('could not remove from library', { timeout: 10000 })
    })

    test('bulk save offline shows toast on failure and keeps failed selected', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        await page.route('**/v1/download/*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )

        await library.enterSelectMode()
        await expect(library.cancelBtn).toBeVisible({ timeout: 3000 })
        await library.songCards.first().click()
        await expect(library.selectedCount()).toBeVisible({ timeout: 3000 })
        await library.bulkSaveOfflineBtn.click()
        await expect(common.toastError).toContainText('failed to save offline', { timeout: 15000 })
        await expect(library.selectedCount()).toBeVisible()
    })

    test('bulk download shows toast on failure and keeps failed selected', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        await page.route('**/v1/download/*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )

        await library.enterSelectMode()
        await expect(library.cancelBtn).toBeVisible({ timeout: 3000 })
        await library.songCards.first().click()
        await expect(library.selectedCount()).toBeVisible({ timeout: 3000 })
        await library.bulkDownloadBtn.click()
        await expect(common.toastError).toContainText('download', { timeout: 5000 })
        await expect(library.selectedCount()).toBeVisible()
    })

    test('bulk add to playlist shows toast on failure', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        const api = await apiLoginAs(ERROR_USERNAME, ERROR_PASSWORD)
        try {
            const created = await api.post(`${API_V1}/playlists`, { data: { name: 'e2e-bulk-err', icon: 'music' } })
            const pl = await created.json()

            await page.goto(routes.library)
            await library.waitForSongs()

            await page.route('**/v1/playlists/*/songs/bulk', route => {
                if (route.request().method() === 'POST')
                    return route.fulfill({ status: 500, body: 'Internal Server Error' })
                return route.continue()
            })

            await library.enterSelectMode()
            await expect(library.cancelBtn).toBeVisible({ timeout: 3000 })
            await library.songCards.first().click()
            await expect(library.selectedCount()).toBeVisible({ timeout: 3000 })
            await library.bulkPlaylistBtn.click()
            await page.getByText('e2e-bulk-err').click()
            await expect(common.toastError).toContainText('failed to add to playlist', { timeout: 5000 })

            await api.delete(`${API_V1}/playlists/${pl.id}`)
        } finally {
            await api.dispose()
        }
    })
})

test.describe('error states — admin mutations', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, ERROR_USERNAME, ERROR_PASSWORD)
    })

    test('invite user shows error on failure', async ({ page }) => {
        await page.route('**/v1/auth/register', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )
        await page.goto(routes.admin)
        await expect(page.getByText('invite user').first()).toBeVisible({ timeout: 10000 })

        await page.getByPlaceholder('username', { exact: true }).first().fill('failuser')
        await page.getByPlaceholder('email', { exact: true }).first().fill('fail@test.com')
        await page.getByPlaceholder('password', { exact: true }).first().fill('pass123')
        await page.getByPlaceholder('confirm password').first().fill('pass123')
        await page.getByRole('button', { name: 'invite' }).click()
        await expect(page.getByText('invite failed')).toBeVisible({ timeout: 5000 })
    })

    test('invite user shows passwords do not match', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.getByText('invite user').first()).toBeVisible({ timeout: 10000 })

        await page.getByPlaceholder('username', { exact: true }).first().fill('failuser')
        await page.getByPlaceholder('email', { exact: true }).first().fill('fail@test.com')
        await page.getByPlaceholder('password', { exact: true }).first().fill('pass123')
        await page.getByPlaceholder('confirm password').first().fill('different')
        await page.getByRole('button', { name: 'invite' }).click()
        await expect(page.getByText('passwords do not match')).toBeVisible({ timeout: 5000 })
    })
})

test.describe('error states — player', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, ERROR_USERNAME, ERROR_PASSWORD)
    })

    test('audio playback failure on a one-song queue stops instead of looping', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        await page.route('**/v1/download/*', route =>
            route.fulfill({ status: 404, body: 'Not Found' })
        )

        // Clicking a card queues that song alone, so the failure limit is one:
        // there is nothing to skip to, and the old code reloaded the same song
        // forever because repeat defaults to all.
        await library.songCards.first().click()
        await expect(common.toastError).toContainText('playback stopped', { timeout: 15000 })
    })

    test('audio playback failure skips a bounded number of songs, then stops', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        const player = new PlayerBar(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        // Counting toasts cannot measure the cascade: the provider holds exactly
        // one toast and each new one replaces the last, so the DOM never shows
        // more than one. Count requests to the download endpoint instead.
        let downloads = 0
        page.on('request', r => { if (r.url().includes('/v1/download/')) downloads += 1 })
        const firstId = (await libraryIds(page))[0]
        const stopSaved = page.waitForRequest(r =>
            r.method() === 'PUT' && r.url().includes('/v1/player/state'), { timeout: 30000 })
        // Spaced out so the cascade cannot outrun the assertions below.
        await page.route('**/v1/download/*', async route => {
            await new Promise(r => setTimeout(r, 200))
            await route.fulfill({ status: 404, body: 'Not Found' })
        })

        // Play All queues the whole library, so the limit is five and the walk is
        // observable: intermediate failures keep their per-song "skipped" toast.
        await library.playAllBtn.click()
        const started = await player.getTrackName()
        expect(started).not.toBe('')
        await expect(common.toastError).toContainText('skipped', { timeout: 15000 })
        // The walk is bounded and ends in one explicit stop. Before the fix it
        // wrapped and never ended, because repeat defaults to all.
        await expect(common.toastError).toContainText('playback stopped', { timeout: 20000 })

        // Stable: nothing starts trying again on its own. Asserting the play
        // control alone would race the loop, which clears the playing flag
        // between loads.
        await expectStable(() => downloads, 4000)
        await expect(player.playPause).toHaveAttribute('title', 'play')
        // Landed back on the song it started from, not wherever the walk ended.
        await expect(player.trackName).toHaveText(started)
        // And the server was told so: the walk had saved the song it was on, and
        // a reload would otherwise open on that one.
        const saved = await stopSaved
        expect(saved.postDataJSON().current_song_uuid).toBe(firstId)
    })

    test('playback recovers when the user presses play after the stop', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        const player = new PlayerBar(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        let blocked = true
        await page.route('**/v1/download/*', async route => {
            if (!blocked) return route.continue()
            await new Promise(r => setTimeout(r, 200))
            await route.fulfill({ status: 404, body: 'Not Found' })
        })

        await library.playAllBtn.click()
        await expect(common.toastError).toContainText('playback stopped', { timeout: 25000 })

        // Nothing but the user leaves the stopped state; pressing play reloads the
        // errored element.
        blocked = false
        await player.playPause.click()
        await expect(player.playPause).toHaveAttribute('title', 'pause', { timeout: 15000 })
        await expect.poll(
            () => page.evaluate(() => document.querySelector('audio')?.currentTime ?? 0),
            { timeout: 15000 },
        ).toBeGreaterThan(0.5)
    })

    test('a 401 on the stream refreshes the session and the same song carries on', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        const player = new PlayerBar(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        // No proactive refresh: the only refresh this test can see is the one the
        // failed stream triggers. Without this the page's own first-play refresh
        // could be the one counted, or could be joined by the retry and hide it.
        await page.evaluate(() => { (window as unknown as { __tokenRefreshStaleMs: number }).__tokenRefreshStaleMs = Infinity })

        // The token stays expired until a refresh has actually happened, as a
        // real expiry would. A one-shot 401 is not enough: the first play holds
        // its first failure and reloads the source once for free, which would
        // recover without ever refreshing.
        let served401 = false
        let refreshes = 0
        page.on('response', r => {
            if (r.url().includes('/v1/auth/refresh')) refreshes += 1
        })
        await page.route('**/v1/download/*', async route => {
            if (refreshes === 0) {
                served401 = true
                return route.fulfill({ status: 401, body: 'token expired' })
            }
            return route.continue()
        })

        await library.playAllBtn.click()
        const started = await player.getTrackName()
        expect(started).not.toBe('')

        // The expiry costs one refresh and a reload of the same song, which then
        // plays on from where it was: not a skip, not a stop.
        await expect.poll(
            () => page.evaluate(() => document.querySelector('audio')?.currentTime ?? 0),
            { timeout: 15000 },
        ).toBeGreaterThan(0.5)
        expect(served401).toBe(true)
        expect(refreshes).toBe(1)
        // Still on the same song and still playing it, not skipped past or stopped.
        await expect(player.trackName).toHaveText(started)
        await expect(player.playPause).toHaveAttribute('title', 'pause')
    })

    test('a dead session on the stream sends the user to sign in instead of walking the queue', async ({ page }) => {
        const library = new LibraryPage(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        // The restored song can still be fetching ranges of itself, and a refusal
        // that lands on one of those redirects before the test is ready to see it.
        // Wait for the restore to hand it its stream (it does so after the page's
        // own fetch of the saved state, and a detach any earlier is undone by it),
        // cut it loose, and arm the refusals only when the click is about to
        // happen.
        await expect.poll(
            () => page.evaluate(() => document.querySelector('audio')?.getAttribute('src') ?? ''),
            { timeout: 5000 },
        ).not.toBe('').catch(() => { /* a user with no saved state has nothing to detach */ })
        await page.evaluate(() => {
            const audio = document.querySelector('audio')
            if (!audio) return
            audio.pause()
            audio.removeAttribute('src')
            audio.load()
        })
        let armed = false
        // Songs asked for, not requests made: the browser may fetch one stream more
        // than once (a probe, a range, the held-error reload), and that is not the
        // queue being walked.
        const songsAsked = new Set<string>()
        page.on('request', r => {
            const m = armed ? r.url().match(/\/v1\/download\/([^/?]+)/) : null
            if (m) songsAsked.add(m[1])
        })
        await page.route('**/v1/download/*', route =>
            armed ? route.fulfill({ status: 401, body: 'token expired' }) : route.continue())
        // The refresh token is gone: no song in the queue can play.
        await page.route('**/v1/auth/refresh', route =>
            armed ? route.fulfill({ status: 401, body: 'expired' }) : route.continue())

        // The trip to the login page, watched on the context because the page is
        // navigating away. The session cookie is really still valid, so the
        // middleware bounces it straight back; the request is what shows intent.
        let songsAtRedirect: number | null = null
        let redirectUrl = ''
        page.context().on('request', req => {
            if (armed && songsAtRedirect === null && /\/\?next=/.test(req.url())) {
                songsAtRedirect = songsAsked.size
                redirectUrl = req.url()
            }
        })

        // The click starts a chain that ends in a navigation, and the page it lands
        // on fails the same way and navigates again. A real click waits for the
        // page to settle, before and after, and in that loop never gets to return;
        // dispatching the event just hands it to the button.
        armed = true
        await library.playAllBtn.dispatchEvent('click')

        await expect.poll(() => songsAtRedirect, { timeout: 15000 }).not.toBeNull()
        // The first song's failure was enough. Walking the queue to the failure
        // limit would have asked for five songs before saying anything, and then
        // blamed the connection.
        expect(songsAtRedirect).toBe(1)
        // The page is gone before a toast could be read, so the login page is told why.
        expect(redirectUrl).toContain('expired=1')
    })

    test('a failure on the last song of a queue that does not repeat stops instead of going quiet', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        const player = new PlayerBar(page)
        await page.goto(routes.library)
        await library.waitForSongs()
        const ids = await libraryIds(page)
        expect(ids.length).toBeGreaterThanOrEqual(3)
        const lastId = ids[ids.length - 1]

        // Only the last song fails, so the walk to it is ordinary playback.
        await page.route(`**/v1/download/${lastId}**`, route =>
            route.fulfill({ status: 404, body: 'Not Found' })
        )

        await library.playAllBtn.click()
        await player.waitForTrackName()
        // Repeat is off, so the last song has nowhere to skip to. (Default is all.)
        for (let i = 0; i < 3 && (await player.repeat.getAttribute('title')) !== 'repeat: off'; i++) {
            await player.repeat.click()
        }
        await expect(player.repeat).toHaveAttribute('title', 'repeat: off')

        // Step to the end by hand.
        for (let i = 0; i < ids.length - 1; i++) {
            const before = await player.getTrackName()
            await player.next.click()
            await expect(player.trackName).not.toHaveText(before, { timeout: 10000 })
        }

        // The failure of the last song is the whole cascade: "skipped" would be a
        // lie, and silence would leave the player claiming to play.
        await expect(common.toastError).toContainText('playback stopped', { timeout: 20000 })
        await expect(player.playPause).toHaveAttribute('title', 'play')
    })

    test('a song that plays through restores the full failure budget', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        // Shorten the ten-second progress window so the test does not wait it out.
        await page.evaluate(() => { (window as unknown as { __playerProgressResetSec: number }).__playerProgressResetSec = 1 })

        const firstId = await library.songCards.first().getAttribute('data-song-id')
        expect(firstId).toBeTruthy()
        // Which songs the walk reached, deduped: each one is requested twice (the
        // load and its one retry), and a Set makes the count independent of that.
        const requested: string[] = []
        page.on('request', r => {
            const m = r.url().match(/\/v1\/download\/([^/?]+)/)
            if (m) requested.push(m[1])
        })
        let blockAll = false
        await page.route('**/v1/download/*', async route => {
            if (blockAll || route.request().url().includes(firstId!)) {
                await new Promise(r => setTimeout(r, 150))
                return route.fulfill({ status: 404, body: 'Not Found' })
            }
            return route.continue()
        })

        // First song fails and is skipped, so the budget is down one. The second
        // song plays past the progress window, which puts it back.
        await library.playAllBtn.click()
        await expect(common.toastError).toContainText('skipped', { timeout: 20000 })
        await expect.poll(
            () => page.evaluate(() => document.querySelector('audio')?.currentTime ?? 0),
            { timeout: 25000 },
        ).toBeGreaterThan(1.3)

        // End of track is not a user-initiated start, so the budget the next walk
        // spends is whatever the progress reset left — five songs, not four.
        blockAll = true
        const mark = requested.length
        await page.evaluate(() => document.querySelector('audio')!.dispatchEvent(new Event('ended')))
        await expect(common.toastError).toContainText('playback stopped', { timeout: 25000 })
        expect(new Set(requested.slice(mark)).size).toBe(5)
    })

})

test.describe('error states — login', () => {
    test('login shows server unavailable when API is down', async ({ page }) => {
        await page.context().clearCookies()
        await page.goto(routes.home)
        await page.getByPlaceholder('username').fill('testuser')
        await page.getByPlaceholder('password').fill('testpass')

        await page.route('**/v1/auth/login', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )

        const common = new CommonPage(page)
        await common.loginSubmit.click()
        await expect(page.getByText('server unavailable')).toBeVisible({ timeout: 5000 })
    })
})
