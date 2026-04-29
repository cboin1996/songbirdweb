import { test, expect, Page } from '@playwright/test'
import { USERNAME, PASSWORD, login, ignoreError, apiLogin, API_V1 } from './helpers'


test.describe('library page', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('page loads and shows song cards', async ({ page }) => {
        await page.goto('/library')
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })
    })

    test('default view is songs tab (active state)', async ({ page }) => {
        await page.goto('/library')
        const songsBtn = page.getByRole('button', { name: 'songs', exact: true })
        await expect(songsBtn).toBeVisible({ timeout: 5000 })
        await expect(songsBtn).toHaveClass(/bg-sky-500/)
    })

    test('artists tab updates URL', async ({ page }) => {
        await page.goto('/library')
        await page.getByRole('button', { name: 'artists', exact: true }).click()
        await expect(page).toHaveURL(/view=artists/, { timeout: 10000 })
    })

    test('albums tab updates URL', async ({ page }) => {
        await page.goto('/library')
        await page.getByRole('button', { name: 'albums', exact: true }).click()
        await expect(page).toHaveURL(/view=albums/)
    })

    test('genres tab updates URL', async ({ page }) => {
        await page.goto('/library')
        await page.getByRole('button', { name: 'genres', exact: true }).click()
        await expect(page).toHaveURL(/view=genres/)
    })

    test('songs tab switches back and becomes active', async ({ page }) => {
        await page.goto('/library?view=albums')
        const songsBtn = page.getByRole('button', { name: 'songs', exact: true })
        await songsBtn.click()
        await expect(page).toHaveURL(/view=songs/)
        await expect(songsBtn).toHaveClass(/bg-sky-500/)
    })

    test('A-Z letter button updates URL', async ({ page }) => {
        await page.goto('/library')
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })
        // find an enabled letter button
        const enabledLetter = page.locator('button').filter({ hasNotText: /songs|artists|albums|genres|play|save|offline/ }).filter({ has: page.locator(':scope:not([disabled])') }).first()
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
        for (const letter of letters) {
            const btn = page.getByRole('button', { name: letter, exact: true })
            if (await btn.isEnabled()) {
                await btn.click()
                await expect(page).toHaveURL(new RegExp(`letter=${letter}`))
                break
            }
        }
    })

    test('play all button is visible', async ({ page }) => {
        await page.goto('/library')
        await expect(page.getByRole('button', { name: 'play all', exact: true })).toBeVisible({ timeout: 5000 })
    })

    test('save all offline button is visible', async ({ page }) => {
        await page.goto('/library')
        await expect(page.getByRole('button', { name: /save all offline/i })).toBeVisible({ timeout: 5000 })
    })

    test('song card: library bookmark button visible', async ({ page }) => {
        await page.goto('/library')
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await expect(card.getByTestId('song-library-toggle')).toBeVisible()
    })

    test('song card: kebab button visible on hover', async ({ page }) => {
        await page.goto('/library')
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.hover()
        await expect(card.getByTestId('song-kebab')).toBeVisible({ timeout: 3000 })
    })

    test('kebab menu shows Download, Play next, Edit, Copy share link options', async ({ page }) => {
        await page.goto('/library')
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.hover()
        await card.getByTestId('song-kebab').click()
        const menu = page.getByTestId('song-kebab-menu')
        await expect(menu).toBeVisible({ timeout: 3000 })
        await expect(menu.getByRole('button', { name: 'Download' })).toBeVisible()
        await expect(menu.getByRole('button', { name: 'Play next' })).toBeVisible()
        await expect(menu.getByRole('button', { name: 'Edit' })).toBeVisible()
        await expect(menu.getByRole('button', { name: /copy share link/i })).toBeVisible()
        // close without acting
        await page.keyboard.press('Escape')
    })

    test('clicking a song card starts player and shows track name', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await page.goto('/library')
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
        await expect(page.getByTestId('player-track-name').first()).toBeVisible({ timeout: 5000 })

        expect(errors).toHaveLength(0)
    })

    test('play button on card starts player', async ({ page }) => {
        await page.goto('/library')
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.getByTestId('song-play').click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
    })

    test('no console errors on library load', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error' && !ignoreError(msg.text())) errors.push(msg.text()) })
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await page.goto('/library')
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })
        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })

    // === Tier 1 sort/group ordering ===

    test('songs view: "#" group sorts last when present', async ({ page }) => {
        // Quick API peek — only run if the user has any non-letter-leading songs.
        const api = await apiLogin()
        const res = await api.get(`${API_V1}/songs/library`)
        const songs = res.ok() ? await res.json() : []
        const hasHash = Array.isArray(songs) && songs.some((s: any) => {
            const t = (s?.properties?.trackName ?? '').trim()
            return t && !/^[A-Za-z]/.test(t)
        })
        await api.dispose()
        test.skip(!hasHash, 'no songs starting with non-letter — # group not present')

        await page.goto('/library?view=songs')
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })
        // Scroll to bottom of list so the last section renders.
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        const sections = page.locator('[data-letter]')
        const count = await sections.count()
        expect(count).toBeGreaterThan(0)
        const lastLetter = await sections.nth(count - 1).getAttribute('data-letter')
        expect(lastLetter).toBe('#')
    })

    test('artists view: "#" group sorts last when present', async ({ page }) => {
        const api = await apiLogin()
        const res = await api.get(`${API_V1}/songs/library`)
        const songs = res.ok() ? await res.json() : []
        const hasHash = Array.isArray(songs) && songs.some((s: any) => {
            const a = (s?.properties?.artistName ?? '').trim()
            return a && !/^[A-Za-z]/.test(a)
        })
        await api.dispose()
        test.skip(!hasHash, 'no artist starting with non-letter — # group not present')

        await page.goto('/library?view=artists')
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        const sections = page.locator('[data-letter]')
        const count = await sections.count()
        const lastLetter = await sections.nth(count - 1).getAttribute('data-letter')
        expect(lastLetter).toBe('#')
    })

    test('albums view: "#" group sorts last when present', async ({ page }) => {
        const api = await apiLogin()
        const res = await api.get(`${API_V1}/songs/library`)
        const songs = res.ok() ? await res.json() : []
        const hasHash = Array.isArray(songs) && songs.some((s: any) => {
            const c = (s?.properties?.collectionName ?? '').trim()
            return c && !/^[A-Za-z]/.test(c)
        })
        await api.dispose()
        test.skip(!hasHash, 'no album with non-letter name — # group not present')

        await page.goto('/library?view=albums')
        // Wait for at least one section to render.
        await expect(page.locator('[data-letter]').first()).toBeVisible({ timeout: 10000 })
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        const sections = page.locator('[data-letter]')
        const count = await sections.count()
        const lastLetter = await sections.nth(count - 1).getAttribute('data-letter')
        expect(lastLetter).toBe('#')
    })

    test('genres view: "Unknown" header sorts last when present', async ({ page }) => {
        const api = await apiLogin()
        const res = await api.get(`${API_V1}/songs/library`)
        const songs = res.ok() ? await res.json() : []
        const hasUnknown = Array.isArray(songs) && songs.some((s: any) => {
            const g = (s?.properties?.primaryGenreName ?? '').trim()
            return !g
        })
        await api.dispose()
        test.skip(!hasUnknown, 'no songs missing primaryGenreName — Unknown bucket not present')

        await page.goto('/library?view=genres')
        await expect(page.locator('[data-letter]').first()).toBeVisible({ timeout: 10000 })
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        const sections = page.locator('[data-letter]')
        const count = await sections.count()
        // The visible header text inside the last section should literally read "Unknown".
        const lastSection = sections.nth(count - 1)
        await expect(lastSection.locator('text=Unknown').first()).toBeVisible()
    })

    test('albums view: name+artist fallback grouping (>1 album when library is non-trivial)', async ({ page }) => {
        // Hard to assert directly on collectionId-less songs. Loose proxy:
        // a non-trivial library should NOT collapse into a single album bucket.
        const api = await apiLogin()
        const res = await api.get(`${API_V1}/songs/library`)
        const songs = res.ok() ? await res.json() : []
        await api.dispose()
        test.skip(!Array.isArray(songs) || songs.length < 4, 'library too small to test multi-album grouping')

        await page.goto('/library?view=albums')
        await expect(page.locator('[data-letter]').first()).toBeVisible({ timeout: 10000 })
        // Albums grid: sections contain album buttons. Count buttons inside data-letter
        // sections only (excludes toolbar/letter-rail buttons).
        const albumButtons = page.locator('[data-letter] button')
        const albumCount = await albumButtons.count()
        expect(albumCount).toBeGreaterThan(1)
    })

    // === Tier 2: save-all-offline beforeunload warning ===

    // FIXME: hard to time — the beforeunload listener is only registered while
    // savingAll is true (library-list.tsx:125-130). Save-all needs to be
    // genuinely in-flight when the navigation is attempted. The button
    // immediately starts saving but cache writes are fast for an empty/small
    // library, so the in-flight window is tiny. Skip when unable to keep
    // savingAll true through the dialog setup.
    test.fixme('save all offline: beforeunload warning fires while in-flight', async ({ page }) => {
        await page.goto('/library')
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        let dialogFired = false
        page.on('dialog', d => { dialogFired = true; d.dismiss() })

        const saveAllBtn = page.getByRole('button', { name: /save all offline/i })
        await saveAllBtn.click()
        // Try to navigate away while save-all is running.
        await page.evaluate(() => { window.location.href = '/explore' })
        await page.waitForTimeout(500)
        expect(dialogFired).toBe(true)
    })
})
