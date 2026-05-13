import { routes, editSongRoute, downloadSongQuery, downloadAlbumQuery } from './routes'
import { test, expect } from '@playwright/test'
import { login, apiLoginAs, API_V1, USERNAME, PASSWORD } from './helpers'
import { EditorPage, CommonPage, LibraryPage, DownloadPage, PlayerBar } from './pages'

test.describe('error states — page boundaries', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
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
        await login(page)
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
        await login(page)
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
        await login(page)
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
        await login(page)
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
        await login(page)
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
        await login(page)
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
        await login(page)
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

        await page.route('**/v1/download/*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
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

        await page.route('**/v1/download/*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
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
        const api = await apiLoginAs(USERNAME, PASSWORD)
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
        await login(page)
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
        const api = await apiLoginAs(USERNAME, PASSWORD)
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
        await login(page)
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
        await login(page)
    })

    test('audio playback failure shows toast', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        await page.route('**/v1/download/*', route =>
            route.fulfill({ status: 404, body: 'Not Found' })
        )

        await library.songCards.first().click()
        await expect(common.toastError).toContainText('skipped', { timeout: 10000 })
    })

    test('playback error auto-skips to next song', async ({ page }) => {
        const common = new CommonPage(page)
        const library = new LibraryPage(page)
        const player = new PlayerBar(page)
        await page.goto(routes.library)
        await library.waitForSongs()

        const firstName = await library.songCards.first().locator('[data-testid="song-track-name"]').textContent()

        await page.route('**/v1/download/*', route => route.fulfill({ status: 404, body: 'Not Found' }))

        await library.songCards.first().click()
        await expect(common.toastError).toContainText('skipped', { timeout: 10000 })
        await player.waitForBar()
        const currentName = await page.locator('[data-testid="player-track-name"]').textContent()
        expect(currentName).not.toBe(firstName)
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
