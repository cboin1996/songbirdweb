import { routes } from './routes'
import { test, expect, Page } from '@playwright/test'
import { LIBRARY_USERNAME, LIBRARY_PASSWORD, login, ignoreError, apiLoginAs, API_V1 } from './helpers'
import { LibraryPage, PlayerBar } from './pages'


test.describe('library page', () => {
    test.describe.configure({ mode: 'serial' })
    test.use({ storageState: 'e2e/.auth/library-user.json' })

    test.beforeEach(async ({ page }) => {
        await login(page, LIBRARY_USERNAME, LIBRARY_PASSWORD)
    })

    test('page loads and shows song cards', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()
    })

    test('default view is songs tab (active state)', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        const songsBtn = lib.tab('songs')
        await expect(songsBtn).toBeVisible({ timeout: 5000 })
        await expect(songsBtn).toHaveClass(/bg-sky-500/)
    })

    test('artists tab updates URL', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()
        await lib.tab('artists').click()
        await expect(page).toHaveURL(/view=artists/, { timeout: 10000 })
    })

    test('albums tab updates URL', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()
        const albumsBtn = lib.tab('albums')
        await expect(albumsBtn).toBeVisible({ timeout: 5000 })
        await albumsBtn.click()
        await expect(page).toHaveURL(/view=albums/, { timeout: 10000 })
    })

    test('genres tab updates URL', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()
        const genresBtn = lib.tab('genres')
        await expect(genresBtn).toBeVisible({ timeout: 5000 })
        await genresBtn.click()
        await expect(page).toHaveURL(/view=genres/, { timeout: 10000 })
    })

    test('songs tab switches back and becomes active', async ({ page }) => {
        const lib = new LibraryPage(page)
        await page.goto(routes.libraryAlbums)
        await expect(page.locator('[data-letter]').first()).toBeVisible({ timeout: 10000 })
        const songsBtn = lib.tab('songs')
        await songsBtn.click()
        await expect(page).toHaveURL(/view=songs/)
        await expect(songsBtn).toHaveClass(/bg-sky-500/)
    })

    test('A-Z letter rail updates URL on click', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()

        const sections = lib.sections()
        await expect(sections.first()).toBeVisible({ timeout: 5000 })
        const letter = await sections.first().getAttribute('data-letter')
        if (!letter) return

        const letterSpan = lib.letterRailActive.filter({ hasText: new RegExp(`^${letter}$`) })
        await letterSpan.click()
        await expect(page).toHaveURL(new RegExp(`letter=${letter}`), { timeout: 5000 })
    })

    test('play all button is visible', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await expect(lib.playAllBtn).toBeVisible({ timeout: 5000 })
    })

    test('save all offline button is visible', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await expect(page.getByRole('button', { name: /save all offline/i })).toBeVisible({ timeout: 5000 })
    })

    test('song card: library bookmark button visible', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        const card = lib.songCards.first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await expect(lib.libraryToggle(card)).toBeVisible()
    })

    test('song card: kebab button visible on hover', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        const card = lib.songCards.first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.hover()
        await expect(lib.kebab(card)).toBeVisible({ timeout: 3000 })
    })

    test('kebab menu shows Download, Play next, Edit, Copy share link options', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        const card = lib.songCards.first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.hover()
        await lib.kebab(card).click()
        const menu = lib.kebabMenu()
        await expect(menu).toBeVisible({ timeout: 3000 })
        await expect(menu.getByRole('button', { name: 'Download' })).toBeVisible()
        await expect(menu.getByRole('button', { name: 'Play next' })).toBeVisible()
        await expect(menu.getByRole('button', { name: 'Edit' })).toBeVisible()
        await expect(menu.getByRole('button', { name: /copy share link/i })).toBeVisible()
        await page.keyboard.press('Escape')
    })

    test('clicking a song card starts player and shows track name', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        const card = lib.songCards.first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await player.waitForBar()
        await expect(player.trackName).toBeVisible({ timeout: 5000 })

        expect(errors).toHaveLength(0)
    })

    test('clicking song card starts player', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        const card = lib.songCards.first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await player.waitForBar()
    })

    test('no console errors on library load', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error' && !ignoreError(msg.text())) errors.push(msg.text()) })
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()
        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })

    // === Tier 1 sort/group ordering ===

    test('songs view: "#" group sorts last when present', async ({ page }) => {
        const api = await apiLoginAs(LIBRARY_USERNAME, LIBRARY_PASSWORD)
        const res = await api.get(`${API_V1}/songs/library`)
        const songs = res.ok() ? await res.json() : []
        const hasHash = Array.isArray(songs) && songs.some((s: any) => {
            const t = (s?.properties?.trackName ?? '').trim()
            return t && !/^[A-Za-z]/.test(t)
        })
        await api.dispose()
        test.skip(!hasHash, 'no songs starting with non-letter — # group not present')

        const lib = new LibraryPage(page)
        await lib.goto('songs')
        await lib.waitForSongs()
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        const sections = lib.sections()
        const count = await sections.count()
        expect(count).toBeGreaterThan(0)
        const lastLetter = await sections.nth(count - 1).getAttribute('data-letter')
        expect(lastLetter).toBe('#')
    })

    test('artists view: "#" group sorts last when present', async ({ page }) => {
        const api = await apiLoginAs(LIBRARY_USERNAME, LIBRARY_PASSWORD)
        const res = await api.get(`${API_V1}/songs/library`)
        const songs = res.ok() ? await res.json() : []
        const hasHash = Array.isArray(songs) && songs.some((s: any) => {
            const a = (s?.properties?.artistName ?? '').trim()
            return a && !/^[A-Za-z]/.test(a)
        })
        await api.dispose()
        test.skip(!hasHash, 'no artist starting with non-letter — # group not present')

        const lib = new LibraryPage(page)
        await lib.goto('artists')
        await lib.waitForSongs()
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        const sections = lib.sections()
        const count = await sections.count()
        const lastLetter = await sections.nth(count - 1).getAttribute('data-letter')
        expect(lastLetter).toBe('#')
    })

    test('albums view: "#" group sorts last when present', async ({ page }) => {
        const api = await apiLoginAs(LIBRARY_USERNAME, LIBRARY_PASSWORD)
        const res = await api.get(`${API_V1}/songs/library`)
        const songs = res.ok() ? await res.json() : []
        const hasHash = Array.isArray(songs) && songs.some((s: any) => {
            const c = (s?.properties?.collectionName ?? '').trim()
            return c && !/^[A-Za-z]/.test(c)
        })
        await api.dispose()
        test.skip(!hasHash, 'no album with non-letter name — # group not present')

        await page.goto(routes.libraryAlbums)
        await expect(page.locator('[data-letter]').first()).toBeVisible({ timeout: 10000 })
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        const sections = page.locator('[data-letter]')
        const count = await sections.count()
        const lastLetter = await sections.nth(count - 1).getAttribute('data-letter')
        expect(lastLetter).toBe('#')
    })

    test('genres view: "Unknown" header sorts last when present', async ({ page }) => {
        const api = await apiLoginAs(LIBRARY_USERNAME, LIBRARY_PASSWORD)
        const res = await api.get(`${API_V1}/songs/library`)
        const songs = res.ok() ? await res.json() : []
        const hasUnknown = Array.isArray(songs) && songs.some((s: any) => {
            const g = (s?.properties?.primaryGenreName ?? '').trim()
            return !g
        })
        await api.dispose()
        test.skip(!hasUnknown, 'no songs missing primaryGenreName — Unknown bucket not present')

        await page.goto(routes.libraryGenres)
        await expect(page.locator('[data-letter]').first()).toBeVisible({ timeout: 10000 })
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        const sections = page.locator('[data-letter]')
        const count = await sections.count()
        const lastSection = sections.nth(count - 1)
        await expect(lastSection.locator('text=Unknown').first()).toBeVisible()
    })

    test('albums view: name+artist fallback grouping (>1 album when library is non-trivial)', async ({ page }) => {
        const api = await apiLoginAs(LIBRARY_USERNAME, LIBRARY_PASSWORD)
        const res = await api.get(`${API_V1}/songs/library`)
        const songs = res.ok() ? await res.json() : []
        await api.dispose()
        test.skip(!Array.isArray(songs) || songs.length < 4, 'library too small to test multi-album grouping')

        const lib = new LibraryPage(page)
        await lib.goto('albums')
        await expect(page.locator('[data-letter]').first()).toBeVisible({ timeout: 10000 })
        const albumButtons = page.locator('[data-letter] button')
        const albumCount = await albumButtons.count()
        expect(albumCount).toBeGreaterThan(1)
    })

    // === Tier 2 per-song deep-linking (scroll + highlight) ===

    test('?song=<uuid> scrolls to matching song card and applies highlight animation', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        await lib.waitForSongs()

        await lib.playAllBtn.click()
        await player.waitForBar()

        const contextLink = page.getByText(/from library/i)
        await expect(contextLink).toBeVisible({ timeout: 5000 })
        const href = await contextLink.locator('..').getAttribute('href')
        expect(href).toMatch(/\?song=/)
        const songId = new URL(href!, 'http://x').searchParams.get('song')
        expect(songId).toBeTruthy()

        await contextLink.locator('..').click()

        const targetCard = page.locator(`[data-song-id="${songId}"]`).first()
        await expect(targetCard).toBeVisible({ timeout: 5000 })
        await expect.poll(() =>
            targetCard.evaluate(el => (el as HTMLElement).dataset.animated)
        , { timeout: 5000 }).toBe('once')
    })

    test('?album=<id> scrolls to matching album and applies highlight animation', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await page.goto(routes.libraryAlbums)
        const albumLocator = lib.albums().first()
        await expect(albumLocator).toBeVisible({ timeout: 10000 })

        await lib.albumPlay(albumLocator).first().click()
        await player.waitForBar()

        const contextLink = page.locator('a[href*="album="]').first()
        await expect(contextLink).toBeVisible({ timeout: 5000 })
        const href = await contextLink.getAttribute('href')
        const albumId = new URL(href!, 'http://x').searchParams.get('album')
        expect(albumId).toBeTruthy()

        await contextLink.click()

        const targetAlbum = page.locator(`[data-album-id="${albumId}"]`).first()
        await expect(targetAlbum).toBeVisible({ timeout: 5000 })
        await expect.poll(() =>
            targetAlbum.evaluate(el => (el as HTMLElement).dataset.animated)
        , { timeout: 5000 }).toBe('once')

        await expect.poll(async () => {
            return targetAlbum.evaluate((el) => {
                const rect = el.getBoundingClientRect()
                return rect.top >= 0 && rect.top < window.innerHeight
            })
        }, { timeout: 5000 }).toBe(true)
    })

    // === Letter rail active-letter highlight ===

    test('letter rail highlights first present letter on initial load', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()

        const firstLetter = await lib.sections().first().getAttribute('data-letter')
        expect(firstLetter).toBeTruthy()

        const activeText = await lib.letterRailActive.textContent()
        expect(activeText?.trim()).toBe(firstLetter)

        await expect(lib.letterRailActive).toHaveClass(/text-sky-500/)
        await expect(lib.letterRailActive).toHaveClass(/font-bold/)
    })

    test.fixme('letter rail active letter updates when scrolling to a different section', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()

        const sections = lib.sections()
        const allLetters = await sections.evaluateAll(els =>
            els.map(e => e.getAttribute('data-letter')).filter(Boolean)
        )
        test.skip(allLetters.length < 2, 'need at least 2 letter sections to test scroll update')

        const targetLetter = allLetters[Math.floor(allLetters.length / 2)]

        await page.evaluate((letter) => {
            document.querySelector(`[data-letter="${letter}"]`)
                ?.scrollIntoView({ behavior: 'instant', block: 'start' })
        }, targetLetter)

        await expect.poll(async () =>
            (await lib.letterRailActive.textContent())?.trim()
        , { timeout: 5000 }).toBe(targetLetter)
    })

    test('active letter style is larger and bold blue (text-sky-500 font-bold)', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()

        await expect(lib.letterRailActive).toHaveClass(/text-sky-500/)
        await expect(lib.letterRailActive).toHaveClass(/font-bold/)

        const activeFontSize = await lib.letterRailActive.evaluate((el) => {
            return window.getComputedStyle(el).fontSize
        })

        const inactiveSpan = lib.letterRail.locator('span.font-semibold').first()
        const inactiveFontSize = await inactiveSpan.evaluate((el) => {
            return window.getComputedStyle(el).fontSize
        })

        const activePx = parseFloat(activeFontSize)
        const inactivePx = parseFloat(inactiveFontSize)
        expect(activePx).toBeGreaterThan(inactivePx)
    })

})
