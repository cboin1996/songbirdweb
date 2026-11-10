import { test, expect } from '@playwright/test'
import {
  login, clearLocalAudio, libraryIds, saveSongOffline, playLibraryPaused,
  songTrackName, recordDownloadRequests, recordDownloads, restoredSongId, expectStable,
  OFFLINE_USERNAME, OFFLINE_PASSWORD,
} from '../e2e/helpers'
import { LibraryPage, PlayerBar, CommonPage } from '../e2e/pages'

// Everything here saves songs, which writes this user's server-side offline list,
// and plays them, which writes its player state. The main test user is shared by
// read-only specs, so these run as their own user, one at a time: two tests
// pressing Play All as the same user would restore each other's queue.
test.describe('Offline saving and playback', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(async ({ page }) => {
    await login(page, OFFLINE_USERNAME, OFFLINE_PASSWORD)
  })

  test('saved-offline song plays after going offline', async ({ page, context }) => {
    test.setTimeout(60000)

    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)

    await lib.goto()
    await lib.waitForSongs()

    const songId = await page.locator('[data-song-id]').first().getAttribute('data-song-id')
    expect(songId).toBeTruthy()

    const card = lib.songCards.first()
    await card.hover()
    await lib.kebab(card).click()
    await page.getByRole('button', { name: /save offline/i }).click()
    await expect(
      page.getByRole('button', { name: /remove offline copy/i })
    ).toBeVisible({ timeout: 30000 })

    const opfsHasFile = await page.evaluate(async (id) => {
      const root = await navigator.storage.getDirectory()
      try {
        const dir = await root.getDirectoryHandle('audio')
        for (const ext of ['mp3', 'm4a']) {
          try {
            const fh = await dir.getFileHandle(`${id}.${ext}`)
            const f = await fh.getFile()
            if (f.size > 0) return f.size
          } catch { /* try next */ }
        }
        return 0
      } catch { return 0 }
    }, songId)
    expect(opfsHasFile).toBeGreaterThan(0)

    await page.reload()
    await lib.waitForSongs()

    await page.locator(`[data-song-id="${songId}"]`).first().click()
    await player.waitForBar()

    await expect.poll(
      () => page.locator('audio').first().evaluate((el: HTMLAudioElement) => el.src),
      { timeout: 10000, message: 'audio.src never became blob: URL' }
    ).toMatch(/^blob:/)

    await expect.poll(
      () => page.locator('audio').first().evaluate((el: HTMLAudioElement) => el.readyState),
      { timeout: 5000 }
    ).toBeGreaterThanOrEqual(2)

    await context.setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))

    const offlineSrc = await page.locator('audio').first().evaluate((el: HTMLAudioElement) => el.src)
    expect(offlineSrc).toMatch(/^blob:/)

    const offlineReadyState = await page.locator('audio').first().evaluate((el: HTMLAudioElement) => el.readyState)
    expect(offlineReadyState).toBeGreaterThanOrEqual(2)

    await context.setOffline(false)
  })

  test('offline advance steps over uncached songs to the next saved one', async ({ page, context }) => {
    test.setTimeout(90000)

    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    const common = new CommonPage(page)

    // Every request the audio element makes for a song. Counting these is what
    // distinguishes a pre-filtered advance from one that tries each uncached
    // song and fails: the failure path is observable only as the attempt.
    const requested = recordDownloadRequests(page)

    await lib.goto()
    await lib.waitForSongs()

    const ids = await libraryIds(page)
    // Three songs minimum: landing on index 1 is where the unfiltered advance
    // goes anyway, so only a saved song further along discriminates.
    expect(ids.length).toBeGreaterThanOrEqual(3)
    const savedId = ids[2]
    const skippedId = ids[1]

    const firstName = await songTrackName(page, ids[0])
    const savedName = await songTrackName(page, savedId)
    expect(firstName).toBeTruthy()
    expect(savedName).toBeTruthy()

    const savedCard = lib.songById(savedId).first()
    await savedCard.scrollIntoViewIfNeeded()
    await savedCard.hover()
    await lib.kebab(savedCard).click()
    await page.getByRole('button', { name: /save offline/i }).click()
    await expect(
      page.getByRole('button', { name: /remove offline copy/i })
    ).toBeVisible({ timeout: 30000 })
    // Close the kebab via its backdrop. Reloading instead would race the restore
    // of this user's server-side player state against Play All.
    await page.mouse.click(5, 5)
    await expect(lib.kebabMenu()).toBeHidden()

    await lib.playAllBtn.click()
    await player.waitForBar()
    await expect(player.trackName).toHaveText(firstName!, { timeout: 10000 })

    // Pause before cutting the network: a stream that dies mid-song would start
    // ticket 04's failure cascade before the advance under test ever runs.
    await player.playPause.click()
    await expect(player.playPause).toHaveAttribute('title', 'play')

    await common.goOffline()
    const mark = requested.length

    await player.next.click()

    await expect(player.trackName).toHaveText(savedName!, { timeout: 15000 })
    await expect.poll(
      () => page.locator('audio').first().evaluate((el: HTMLAudioElement) => el.src),
      { timeout: 10000, message: 'audio.src never became blob: URL' }
    ).toMatch(/^blob:/)

    // The uncached song in between was never requested, so there was no failure
    // to report; the saved song is playing, not stopped.
    expect(requested.slice(mark)).not.toContain(skippedId)
    await expect(player.playPause).toHaveAttribute('title', 'pause')

    await context.setOffline(false)
  })

  test('offline advance with nothing saved stops instead of failing song by song', async ({ page, context }) => {
    test.setTimeout(90000)

    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    const common = new CommonPage(page)

    const requested = recordDownloadRequests(page)

    // Nothing is saved offline: each prod test gets its own browser profile, so
    // OPFS and IndexedDB start empty.
    await lib.goto()
    await lib.waitForSongs()

    await lib.playAllBtn.click()
    await player.waitForBar()
    await player.waitForTrackName()
    const started = await player.getTrackName()

    await player.playPause.click()
    await expect(player.playPause).toHaveAttribute('title', 'play')

    await common.goOffline()
    const mark = requested.length

    await player.next.click()

    await expect(common.toastError).toHaveText(/no offline copies left/i, { timeout: 15000 })
    // A known state, not a crash: the player stays put and stays stopped.
    await expect(player.playPause).toHaveAttribute('title', 'play')
    await expect(player.trackName).toHaveText(started)
    expect(requested.slice(mark)).toEqual([])

    await context.setOffline(false)
  })

  test('offline advance with shuffle and repeat all still finds the one saved song at a lap boundary', async ({ page }) => {
    test.setTimeout(90000)

    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    const common = new CommonPage(page)

    await lib.goto()
    await lib.waitForSongs()
    const ids = await libraryIds(page)
    expect(ids.length).toBeGreaterThanOrEqual(3)

    // The saved song is the one Play All starts on, so shuffle pins it first and
    // every other song in the queue is a song to step over.
    await saveSongOffline(page, ids[0])
    const savedName = await playLibraryPaused(page, { shuffle: true, repeat: 'all' })

    await common.goOffline()
    // The lap boundary picks the next lap's first song at random, from every song
    // but the one just passed. Pin it to the last candidate: never the saved song,
    // which is where the walk used to run out of steps and give up.
    await page.evaluate(() => { Math.random = () => 0.999999 })

    await player.next.click()

    // The only saved song plays again, as repeat-all promises, rather than the
    // player stopping with a saved song still in the queue.
    await expect(player.playPause).toHaveAttribute('title', 'pause', { timeout: 15000 })
    await expect(player.trackName).toHaveText(savedName)
    await expect.poll(
      () => page.locator('audio').first().evaluate((el: HTMLAudioElement) => el.src),
      { timeout: 10000, message: 'audio.src never became blob: URL' }
    ).toMatch(/^blob:/)
  })

  test('offline advance ends quietly at the last song of a queue that does not repeat', async ({ page }) => {
    test.setTimeout(90000)

    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    const common = new CommonPage(page)

    await lib.goto()
    await lib.waitForSongs()
    const ids = await libraryIds(page)
    expect(ids.length).toBeGreaterThanOrEqual(3)

    const lastId = ids[ids.length - 1]
    const lastName = (await lib.songById(lastId).first().getByTestId('song-track-name').first().textContent())?.trim()
    expect(lastName).toBeTruthy()
    await saveSongOffline(page, lastId)
    await playLibraryPaused(page, { shuffle: false, repeat: 'off' })

    await common.goOffline()
    // Steps over every unsaved song in between and lands on the last.
    await player.next.click()
    await expect(player.trackName).toHaveText(lastName!, { timeout: 15000 })
    await expect(player.playPause).toHaveAttribute('title', 'pause', { timeout: 15000 })

    // The queue is over. Online, next here does nothing and the song plays on;
    // offline it must not turn the album ending into a red error and a stop.
    await player.next.click()
    // A stop would pause the player and leave the song where it is; holding for a
    // moment is what tells "still playing" from "has not stopped yet".
    await expectStable(async () => `${await player.getTrackName()}|${await player.playPause.getAttribute('title')}`)
    await expect(player.trackName).toHaveText(lastName!)
    await expect(player.playPause).toHaveAttribute('title', 'pause')
  })

  test('offline advance past the last saved song says the rest is not saved', async ({ page }) => {
    test.setTimeout(90000)

    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    const common = new CommonPage(page)

    await lib.goto()
    await lib.waitForSongs()
    const ids = await libraryIds(page)
    expect(ids.length).toBeGreaterThanOrEqual(3)

    await saveSongOffline(page, ids[0])
    const started = await playLibraryPaused(page, { shuffle: false, repeat: 'off' })

    await common.goOffline()
    await player.next.click()

    // Songs were stepped over and the queue ended with none saved: that is worth
    // saying, unlike an album simply finishing.
    await expect(common.toastError).toHaveText(/not saved offline/i, { timeout: 15000 })
    await expect(player.playPause).toHaveAttribute('title', 'play')
    await expect(player.trackName).toHaveText(started)
  })

  test('offline pre-filter works on a session that never opened the library', async ({ page, context }) => {
    test.setTimeout(90000)

    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    const common = new CommonPage(page)

    await lib.goto()
    await lib.waitForSongs()

    // The queue is saved on a 2s debounce, and navigating before it lands leaves
    // the server holding whatever queue an earlier test left behind — a one-song
    // queue restores with next disabled, which is not what this test is about.
    const queueSaved = page.waitForResponse(
      r => r.url().includes('/v1/player/state') && r.request().method() === 'PUT' && r.ok(),
      { timeout: 20000 },
    )
    await lib.playAllBtn.click()
    await player.waitForBar()
    await player.waitForTrackName()
    await player.playPause.click()
    await expect(player.playPause).toHaveAttribute('title', 'play')
    await queueSaved

    // Reload on a page that has no library list. The queue comes back from the
    // server, but nothing on this page scans for local copies — only the
    // provider's own mount scan does, and without it the player would believe
    // the user has nothing saved and never pre-filter at all.
    await page.goto('/download')
    await expect(page).toHaveURL(/\/download/)
    await player.waitForTrackName(10000)
    // The restore has to bring back a multi-song queue or next stays disabled
    // and the pre-filter never runs.
    await expect(player.next).toBeEnabled({ timeout: 10000 })
    const started = await player.getTrackName()

    await common.goOffline()
    await player.next.click()

    await expect(common.toastError).toHaveText(/no offline copies left/i, { timeout: 15000 })
    await expect(player.trackName).toHaveText(started)

    await context.setOffline(false)
  })

  test('first play in airplane mode starts on a song that is saved offline', async ({ page, context }) => {
    test.setTimeout(90000)

    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    const common = new CommonPage(page)

    await lib.goto()
    await lib.waitForSongs()

    // Wait for the restore to land, then pick a song it did not: clicking the song
    // that is already current pauses or resumes it instead of starting a fresh
    // load, which is not the path under test.
    const restoredId = await restoredSongId(page)
    const ids = await libraryIds(page)
    const targetId = ids.find(id => id !== restoredId)!
    expect(targetId).toBeTruthy()

    const card = page.locator(`[data-song-id="${targetId}"]`).first()
    const savedName = await card.getByTestId('song-track-name').innerText()
    await card.hover()
    await lib.kebab(card).click()
    await page.getByRole('button', { name: /save offline/i }).click()
    await expect(
      page.getByRole('button', { name: /remove offline copy/i })
    ).toBeVisible({ timeout: 30000 })
    await page.mouse.click(5, 5)
    await expect(lib.kebabMenu()).toBeHidden()
    // Saving offline fetched the song, so the stream URL is now in the HTTP
    // cache and would play happily with the network cut — the stream guess has
    // to really fail for this to be airplane mode at all.
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.clearBrowserCache')
    await page.evaluate(async () => { for (const k of await caches.keys()) await caches.delete(k) })

    // Nothing has played yet, so this is the gesture-window path: the stream URL
    // is assigned synchronously and fails, and the local copy arrives after.
    await common.goOffline()
    await player.waitForBar()
    // A card swallows clicks for 400ms after its kebab closes, so that dismissing
    // the menu does not also start the song, and a click inside that window does
    // nothing. Click until the song takes, but never again once it has: a second
    // click on the current song pauses it, which is not the path under test. Also
    // without this the assertions below can pass on whatever song a restore left
    // on the element.
    await expect(async () => {
      if ((await player.getTrackName()) !== savedName) await card.click()
      await expect(player.trackName).toHaveText(savedName, { timeout: 1000 })
    }).toPass({ timeout: 10000 })

    await expect.poll(
      () => page.locator('audio').first().evaluate((el: HTMLAudioElement) => el.src),
      { timeout: 10000, message: 'audio.src never became blob: URL' }
    ).toMatch(/^blob:/)
    await expect.poll(
      () => page.locator('audio').first().evaluate((el: HTMLAudioElement) => el.currentTime),
      { timeout: 10000, message: 'playback never progressed' }
    ).toBeGreaterThan(0.5)
    // Playing, not stopped on an error: the stream guess failed and was held, and
    // the swap to the local copy had the last word.
    await expect(player.playPause).toHaveAttribute('title', 'pause')

    await context.setOffline(false)
  })

  test('a 401 on the download costs a retry, not the save', async ({ page }) => {
    test.setTimeout(90000)

    const lib = new LibraryPage(page)

    await lib.goto()
    await lib.waitForSongs()

    // Scope the fault to one song, and not the one the restore is holding: the
    // player requests its own song from the same endpoint and would otherwise
    // eat the single 401 this test hands out.
    const restoredId = await restoredSongId(page)
    const ids = await libraryIds(page)
    const targetId = ids.find(id => id !== restoredId)!
    const requested = recordDownloadRequests(page)

    let served401 = false
    await page.route(`**/v1/download/${targetId}**`, async route => {
      if (!served401) {
        served401 = true
        await route.fulfill({ status: 401, body: 'token expired' })
        return
      }
      await route.continue()
    })

    const card = page.locator(`[data-song-id="${targetId}"]`).first()
    await card.hover()
    await lib.kebab(card).click()
    await page.getByRole('button', { name: /save offline/i }).click()

    // The save survives the expiry: refresh, ask again, finish.
    await expect(
      page.getByRole('button', { name: /remove offline copy/i })
    ).toBeVisible({ timeout: 30000 })
    expect(served401).toBe(true)
    // One request refused, one retry that took: the song was asked for twice, not
    // once (it would have failed) and not more (it would be looping).
    expect(requested.filter(id => id === targetId)).toHaveLength(2)

    const size = await page.evaluate(async (id) => {
      const root = await navigator.storage.getDirectory()
      try {
        const dir = await root.getDirectoryHandle('audio')
        for (const ext of ['m4a', 'mp3']) {
          try { return (await (await dir.getFileHandle(`${id}.${ext}`)).getFile()).size } catch { /* next */ }
        }
        return 0
      } catch { return 0 }
    }, targetId)
    expect(size).toBeGreaterThan(0)
  })

  test('save all offline stops at a dead refresh instead of failing every song', async ({ page }) => {
    test.setTimeout(90000)

    const lib = new LibraryPage(page)

    await lib.goto()
    await lib.waitForSongs()

    await clearLocalAudio(page)
    await page.reload()
    await lib.waitForSongs()
    const restoredId = await restoredSongId(page)

    const asked = await recordDownloads(page, route => route.fulfill({ status: 401, body: 'token expired' }))
    // The seven-day refresh token is gone too, so there is no way back. The
    // page's first refresh, made before the first song because a page cannot
    // know how old its token is, still succeeds: this test is about the
    // refresh that follows a 401, so the first download has to reach the server.
    let refreshes = 0
    await page.route('**/v1/auth/refresh', route =>
      route.fulfill({ status: ++refreshes === 1 ? 200 : 401, body: 'refresh' }))

    // Watch for the trip to the login page at the context level, not the page
    // level: the service worker handles navigations with its own fetch, so
    // /?next= never surfaces as a page request, and the still-valid session
    // cookie means middleware bounces it onward before the URL settles.
    // askedAtRedirect also freezes the download count at that moment — the
    // player starts retrying its own song once the new page loads.
    let askedAtRedirect: string[] | null = null
    page.context().on('request', req => {
      if (askedAtRedirect === null && /\/\?next=/.test(req.url())) askedAtRedirect = [...asked]
    })

    await page.getByTestId('save-all-offline').click()

    // Sent to log in rather than told that every song failed.
    await expect.poll(() => askedAtRedirect, { timeout: 30000 }).not.toBeNull()
    // Exactly one song asked, not the whole library: the rest were never
    // attempted, so they are not sitting in the failed list waiting for a retry
    // that cannot work. The player's own song is left out of the count: it may ask
    // for itself too, and is not part of the save.
    expect(askedAtRedirect!.filter(id => id !== restoredId)).toHaveLength(1)
  })

  test('save all offline refreshes before each song instead of waiting for a 401', async ({ page }) => {
    test.setTimeout(90000)

    const lib = new LibraryPage(page)

    await lib.goto()
    await lib.waitForSongs()
    const ids = await libraryIds(page)
    expect(ids.length).toBeGreaterThanOrEqual(3)

    await clearLocalAudio(page)
    await page.reload()
    await lib.waitForSongs()

    // Treat the token as stale immediately, standing in for a save that has
    // been running longer than its fifteen minutes. Set after the reload: the
    // override lives on window.
    await page.evaluate(() => {
      (window as unknown as { __tokenRefreshStaleMs?: number }).__tokenRefreshStaleMs = 0
    })

    // Both go through to the real API, in the order the page sends them.
    const events: string[] = []
    await page.route('**/v1/auth/refresh', route => { events.push('refresh'); return route.continue() })
    await recordDownloads(page, route => { events.push('song'); return route.continue() })

    await page.getByTestId('save-all-offline').click()
    await expect.poll(() => events.filter(e => e === 'song').length, { timeout: 60000 }).toBe(ids.length)

    // A refresh immediately before every song, not just the first: with the token
    // stale throughout, each one is a chance to be refused, and none was.
    expect(events).toEqual(ids.flatMap(() => ['refresh', 'song']))
  })

  test('save all offline pauses instead of signing out when the refresh cannot be answered', async ({ page }) => {
    test.setTimeout(90000)

    const lib = new LibraryPage(page)
    const common = new CommonPage(page)

    await lib.goto()
    await lib.waitForSongs()
    await clearLocalAudio(page)
    await page.reload()
    await lib.waitForSongs()

    const asked = await recordDownloads(page, route => route.fulfill({ status: 401, body: 'token expired' }))
    // The server is struggling, not refusing: a 503 says nothing about whether
    // the session is alive.
    await page.route('**/v1/auth/refresh', route => route.fulfill({ status: 503, body: 'unavailable' }))

    let redirected = false
    page.context().on('request', req => {
      if (/\/\?next=/.test(req.url())) redirected = true
    })

    await page.getByTestId('save-all-offline').click()

    // Nothing could be saved, and the user is told so, with the songs left in
    // the failed list for a retry that works once the server is back.
    await expect(page.getByText(/\d+ songs? failed to download offline/)).toBeVisible({ timeout: 30000 })
    await expect(common.toastError).toContainText('saving paused')
    expect(asked.size).toBe(0)
    // Still on the library page, still signed in.
    expect(redirected).toBe(false)
    await expect(page).toHaveURL(/\/library/)
  })

  test('save all offline stops at the first 401 that a good refresh does not cure', async ({ page }) => {
    test.setTimeout(90000)

    const lib = new LibraryPage(page)

    await lib.goto()
    await lib.waitForSongs()
    await clearLocalAudio(page)
    await page.reload()
    await lib.waitForSongs()
    const restoredId = await restoredSongId(page)

    const asked = await recordDownloads(page, route => route.fulfill({ status: 401, body: 'refused' }))
    // The refresh is left alone: the real API accepts it, so the token is good
    // and still every download is refused. Nothing a later song does will differ.

    let askedAtRedirect: string[] | null = null
    page.context().on('request', req => {
      if (askedAtRedirect === null && /\/\?next=/.test(req.url())) askedAtRedirect = [...asked]
    })

    await page.getByTestId('save-all-offline').click()

    await expect.poll(() => askedAtRedirect, { timeout: 30000 }).not.toBeNull()
    // Exactly one song was tried. Not "fewer than the library": one, so a retry
    // of the rest is not preceded by a refresh and a refused request per song.
    expect(askedAtRedirect!.filter(id => id !== restoredId)).toHaveLength(1)
  })
})
