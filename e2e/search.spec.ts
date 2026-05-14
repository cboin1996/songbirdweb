import { test, expect } from '@playwright/test'
import { login, apiLogin, API_V1, ignoreError, QUEUE_USERNAME, QUEUE_PASSWORD, apiLoginAs } from './helpers'
import { LibraryPage, PlayerBar } from './pages'

test.describe('library search', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('search by artist filters songs', async ({ page }) => {
        const api = await apiLogin()
        const res = await api.get(`${API_V1}/songs/library`)
        const songs: any[] = res.ok() ? await res.json() : []
        await api.dispose()
        const withArtist = songs.find(s => s.properties?.artistName)
        test.skip(!withArtist, 'no songs with artist name')
        const artist = withArtist.properties.artistName

        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()
        const totalBefore = await lib.songCards.count()

        await lib.searchInput.fill(artist)
        await page.waitForTimeout(400)

        const totalAfter = await lib.songCards.count()
        expect(totalAfter).toBeGreaterThan(0)
        expect(totalAfter).toBeLessThanOrEqual(totalBefore)
    })

    test('search by track name filters songs', async ({ page }) => {
        const api = await apiLogin()
        const res = await api.get(`${API_V1}/songs/library`)
        const songs: any[] = res.ok() ? await res.json() : []
        await api.dispose()
        const withTrack = songs.find(s => s.properties?.trackName)
        test.skip(!withTrack, 'no songs with track name')
        const track = withTrack.properties.trackName

        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()

        await lib.searchInput.fill(track)
        await page.waitForTimeout(400)

        const count = await lib.songCards.count()
        expect(count).toBeGreaterThan(0)
    })

    test('clearing search restores full library', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()
        const totalBefore = await lib.songCards.count()

        await lib.searchInput.fill('zzzznonexistent')
        await page.waitForTimeout(400)
        await expect(lib.searchEmpty).toBeVisible()

        await lib.searchClear.click()
        await page.waitForTimeout(400)
        const totalAfter = await lib.songCards.count()
        expect(totalAfter).toBe(totalBefore)
    })

    test('no results shows empty message', async ({ page }) => {
        const lib = new LibraryPage(page)
        await lib.goto()
        await lib.waitForSongs()

        await lib.searchInput.fill('zzzz_no_match_9999')
        await page.waitForTimeout(400)
        await expect(lib.searchEmpty).toBeVisible()
        await expect(lib.searchEmpty).toContainText('no songs match')
    })

    test('Play All with search filter only queues matched songs', async ({ page }) => {
        const api = await apiLogin()
        const res = await api.get(`${API_V1}/songs/library`)
        const songs: any[] = res.ok() ? await res.json() : []
        await api.dispose()
        const artists = [...new Set(songs.filter(s => s.properties?.artistName).map(s => s.properties.artistName))]
        test.skip(artists.length < 2, 'need at least 2 distinct artists')
        const artist = artists.find(a => {
            const count = songs.filter(s => s.properties?.artistName === a).length
            return count >= 1 && count < songs.length
        })
        test.skip(!artist, 'no artist with partial match')

        const matchCount = songs.filter(s =>
            s.properties?.artistName?.toLowerCase().includes(artist!.toLowerCase()) ||
            s.properties?.trackName?.toLowerCase().includes(artist!.toLowerCase())
        ).length

        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        await lib.waitForSongs()

        await lib.searchInput.fill(artist!)
        await page.waitForTimeout(400)

        await lib.playAllBtn.click()
        await player.waitForBar()
        await player.openQueue()

        const queueCount = await player.queueRows().count()
        expect(queueCount).toBe(matchCount)
    })
})

test.describe('queue search', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page, QUEUE_USERNAME, QUEUE_PASSWORD)
    })

    test('queue search filters visibility without changing playback', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        await lib.waitForSongs()
        test.skip((await lib.songCards.count()) < 6, 'need 6+ songs for queue search to appear')

        await lib.playAllBtn.click()
        await player.waitForBar()
        await player.waitForTrackName()
        const currentTrack = await player.getTrackName()

        await player.openQueue()
        const totalBefore = await player.queueRows().count()
        test.skip(totalBefore <= 5, 'queue too small for search to appear')

        await player.queueSearch.fill('zzzz_no_match')
        await expect(player.queueSearchEmpty).toBeVisible()

        const trackAfter = await player.getTrackName()
        expect(trackAfter).toBe(currentTrack)
    })

    test('clearing queue search restores full queue', async ({ page }) => {
        const lib = new LibraryPage(page)
        const player = new PlayerBar(page)
        await lib.goto()
        await lib.waitForSongs()
        test.skip((await lib.songCards.count()) < 6, 'need 6+ songs')

        await lib.playAllBtn.click()
        await player.waitForBar()
        await player.openQueue()
        const totalBefore = await player.queueRows().count()
        test.skip(totalBefore <= 5, 'queue too small')

        await player.queueSearch.fill('zzzz_no_match')
        await expect(player.queueSearchEmpty).toBeVisible()

        await player.queueSearchClear.click()
        await page.waitForTimeout(300)
        const totalAfter = await player.queueRows().count()
        expect(totalAfter).toBe(totalBefore)
    })
})
