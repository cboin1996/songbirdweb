import { Page, BrowserContext, Route, expect, APIRequestContext, request as pwRequest } from '@playwright/test'
import { routes } from './routes'
import { LibraryPage, PlayerBar } from './pages'

export const USERNAME = process.env.TEST_USERNAME!
export const PASSWORD = process.env.TEST_PASSWORD!
export const EDITOR_USERNAME = process.env.E2E_EDITOR_USERNAME!
export const EDITOR_PASSWORD = process.env.E2E_EDITOR_PASSWORD!
export const BULK_USERNAME = process.env.E2E_BULK_USERNAME!
export const BULK_PASSWORD = process.env.E2E_BULK_PASSWORD!
export const IMPORT_USERNAME = process.env.E2E_IMPORT_USERNAME!
export const IMPORT_PASSWORD = process.env.E2E_IMPORT_PASSWORD!
export const QUEUE_USERNAME = process.env.E2E_QUEUE_USERNAME!
export const QUEUE_PASSWORD = process.env.E2E_QUEUE_PASSWORD!
export const PLAYER_USERNAME = process.env.E2E_PLAYER_USERNAME!
export const PLAYER_PASSWORD = process.env.E2E_PLAYER_PASSWORD!
export const SYNC_USERNAME = process.env.E2E_SYNC_USERNAME!
export const SYNC_PASSWORD = process.env.E2E_SYNC_PASSWORD!
export const DOWNLOAD_USERNAME = process.env.E2E_DOWNLOAD_USERNAME!
export const DOWNLOAD_PASSWORD = process.env.E2E_DOWNLOAD_PASSWORD!
export const SETTINGS_USERNAME = process.env.E2E_SETTINGS_USERNAME!
export const SETTINGS_PASSWORD = process.env.E2E_SETTINGS_PASSWORD!
export const LIBRARY_USERNAME = process.env.E2E_LIBRARY_USERNAME!
export const LIBRARY_PASSWORD = process.env.E2E_LIBRARY_PASSWORD!
export const SEARCH_USERNAME = process.env.E2E_SEARCH_USERNAME!
export const SEARCH_PASSWORD = process.env.E2E_SEARCH_PASSWORD!
export const ERROR_USERNAME = process.env.E2E_ERROR_USERNAME!
export const ERROR_PASSWORD = process.env.E2E_ERROR_PASSWORD!
export const OFFLINE_USERNAME = process.env.E2E_OFFLINE_USERNAME!
export const OFFLINE_PASSWORD = process.env.E2E_OFFLINE_PASSWORD!
// .env.local sets NEXT_PUBLIC_API_BASE_URL='' (empty) so the browser uses
// relative URLs in dev. Tests call the API directly from outside the browser
// and need an absolute URL — use `||` so empty string also falls through.
// For non-local envs, set E2E_API_BASE_URL to override.
export const API_BASE = process.env.E2E_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'
export const API_V1 = `${API_BASE}/v1`

export function ignoreError(msg: string) {
    // Failed-to-fetch lines come from in-flight requests aborted by client-side
    // navigation; they're benign console noise, not real bugs.
    return /AbortError|favicon|401|no supported sources|Failed to fetch|Fetch error/i.test(msg)
}

// Bypass the React form: call the API from inside the browser so httpOnly cookies
// are set correctly in the Playwright browser context. If already authenticated via
// storageState, this is a no-op (visit /library to verify auth; if 200, skip login).
export async function login(page: Page, username = USERNAME, password = PASSWORD) {
    // Check if already authenticated by visiting a protected page.
    await page.goto(routes.library, { waitUntil: 'domcontentloaded' })
    const isAuth = page.url().includes(routes.library)
    if (isAuth) {
        // Already authenticated; skip login.
        return
    }

    // Not authenticated; perform login via API.
    await page.context().clearCookies()
    await page.goto(routes.home)
    const ok = await page.evaluate(
        async ({ url, username, password }) => {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                credentials: 'include',
            })
            return resp.ok
        },
        { url: `${API_BASE}/v1/auth/login`, username, password },
    )
    if (!ok) throw new Error(`Login API call failed for user: ${username}`)
    await page.goto(routes.download)
    await expect(page).toHaveURL(/\/download/, { timeout: 10000 })
}

// Build an APIRequestContext logged in as the test user — useful for state
// init/cleanup that doesn't need a browser context.
export async function apiLogin(): Promise<APIRequestContext> {
    return apiLoginAs(USERNAME, PASSWORD)
}

// Build an APIRequestContext logged in as an arbitrary user.
export async function apiLoginAs(username: string, password: string): Promise<APIRequestContext> {
    const ctx = await pwRequest.newContext({ baseURL: API_BASE })
    const res = await ctx.post(`${API_V1}/auth/login`, {
        data: { username, password },
    })
    if (!res.ok()) throw new Error(`apiLogin failed for ${username}: ${res.status()}`)
    return ctx
}

// Unique suffix for state-isolation across parallel runs / re-runs.
export function uniq(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

// Delete every playlist on the current account whose name matches the prefix.
// Used in afterAll/afterEach cleanup so test runs don't leak state.
export async function purgePlaylistsByPrefix(api: APIRequestContext, prefix: string): Promise<number> {
    const res = await api.get(`${API_V1}/playlists`)
    if (!res.ok()) return 0
    const playlists = await res.json()
    let deleted = 0
    for (const pl of playlists) {
        if (typeof pl?.name === 'string' && pl.name.startsWith(prefix)) {
            const r = await api.delete(`${API_V1}/playlists/${pl.id}`)
            if (r.ok()) deleted++
        }
    }
    return deleted
}

// Pick the first song from /v1/songs/library — used for tests that need an
// arbitrary library song without depending on a particular fixture name.
export async function pickFirstLibrarySong(
    api: APIRequestContext,
): Promise<{ uuid: string; track: string } | null> {
    const res = await api.get(`${API_V1}/songs/library`)
    if (!res.ok()) return null
    const songs = await res.json()
    if (!Array.isArray(songs) || !songs.length) return null
    const s = songs.find((x: any) => x?.uuid && x?.properties?.trackName) ?? songs[0]
    return { uuid: s.uuid, track: s.properties?.trackName ?? '' }
}

// Empty the browser's offline audio store (OPFS directory and the IndexedDB
// fallback). Save-all skips songs already held locally, so a test that checks
// what a save attempts has to start from nothing or its assertions hold
// vacuously. Reload afterwards: the app scans the store once at launch.
export async function clearLocalAudio(page: Page): Promise<void> {
    await page.evaluate(async () => {
        try {
            const root = await navigator.storage.getDirectory()
            await root.removeEntry('audio', { recursive: true })
        } catch { /* nothing saved */ }
        await new Promise<void>(resolve => {
            const req = indexedDB.deleteDatabase('songbird-audio')
            req.onsuccess = () => resolve()
            req.onerror = () => resolve()
            req.onblocked = () => resolve()
        })
    })
}

// The library's song ids in the order Play All queues them. Each song renders
// two cards (the grid and list layouts), so the raw node order repeats every
// id; deduped, it is the queue order.
export async function libraryIds(page: Page): Promise<string[]> {
    return [...new Set(await page.locator('[data-song-id]').evaluateAll(
        els => els.map(el => el.getAttribute('data-song-id')!)
    ))]
}

// Save one library song offline through its menu and wait until it is held.
// Closes the menu by its backdrop: reloading instead would race the restore of
// this user's server-side player state against whatever the test does next.
export async function saveSongOffline(page: Page, uuid: string): Promise<void> {
    const lib = new LibraryPage(page)
    const card = lib.songById(uuid).first()
    await card.scrollIntoViewIfNeeded()
    await card.hover()
    await lib.kebab(card).click()
    await page.getByRole('button', { name: /save offline/i }).click()
    await expect(page.getByRole('button', { name: /remove offline copy/i })).toBeVisible({ timeout: 30000 })
    await page.mouse.click(5, 5)
    await expect(lib.kebabMenu()).toBeHidden()
}

// A phone between towers still reports a connection, and every request to the API
// fails. Playwright's offline mode also flips the browser's own report, so this
// puts it back: the network is gone and the browser has not noticed.
export async function enterDeadZone(page: Page, context: BrowserContext): Promise<void> {
    await context.setOffline(true)
    await page.evaluate(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true }))
}

// The first request to fail is what tells the app the server is gone. A change to
// the player is saved after two seconds, and that save is such a request.
export async function failAnApiRequest(page: Page, player: PlayerBar): Promise<void> {
    const failed = page.waitForEvent('requestfailed', { predicate: r => r.url().includes('/v1/player/state'), timeout: 15000 })
    await player.repeat.click()
    await failed
}

// Answers every GET of the player state the way the service worker does when the
// network is gone: with its cached copy, marked stale. The real marker is added by
// a worker on the page's own origin and is always readable; the API is another
// origin here, so the header has to be exposed for the page to see it at all.
export async function routeStalePlayerState(page: Page, body: Record<string, unknown>): Promise<void> {
    await page.route('**/v1/player/state', async route => {
        if (route.request().method() !== 'GET') return route.continue()
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'X-SW-Stale': '1', 'Access-Control-Expose-Headers': 'X-SW-Stale' },
            body: JSON.stringify(body),
        })
    })
}

// Leaves the song listed as saved with nothing in it: the file is still there, empty,
// as after a write that was cut off. The scan lists names, so it still counts as saved.
export async function emptySavedFile(page: Page, uuid: string): Promise<void> {
    await page.evaluate(async id => {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('audio')
        for (const ext of ['mp3', 'm4a']) {
            try {
                const writable = await (await dir.getFileHandle(`${id}.${ext}`)).createWritable()
                await writable.close()
            } catch { /* the other format */ }
        }
    }, uuid)
}

// Queue the whole library with Play All, set shuffle and repeat, then pause.
// Paused before the network is cut: a stream that dies mid-song starts the
// failure cascade before the behaviour under test ever runs.
export async function playLibraryPaused(
    page: Page,
    opts: { shuffle?: boolean; repeat?: 'off' | 'one' | 'all' } = {},
): Promise<string> {
    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    await lib.playAllBtn.click()
    await player.waitForBar()
    await player.waitForTrackName()
    const started = await player.getTrackName()
    if (opts.repeat) {
        for (let i = 0; i < 3 && (await player.repeat.getAttribute('title')) !== `repeat: ${opts.repeat}`; i++) {
            await player.repeat.click()
        }
        await expect(player.repeat).toHaveAttribute('title', `repeat: ${opts.repeat}`)
    }
    if (opts.shuffle !== undefined && (await player.shuffle.getAttribute('aria-pressed')) !== String(opts.shuffle)) {
        await player.shuffle.click()
    }
    if (opts.shuffle !== undefined) await expect(player.shuffle).toHaveAttribute('aria-pressed', String(opts.shuffle))
    await player.playPause.click()
    await expect(player.playPause).toHaveAttribute('title', 'play')
    return started
}

// Playwright can't background a page without closing it, so drive the
// visibility transition the way the player observes it.
export async function setVisibility(page: Page, state: 'hidden' | 'visible') {
    await page.evaluate((s) => {
        Object.defineProperty(document, 'visibilityState', { get: () => s, configurable: true })
        document.dispatchEvent(new Event('visibilitychange'))
    }, state)
}

// The displayed track name of a library song, by id.
export async function songTrackName(page: Page, uuid: string): Promise<string> {
    const name = await page.locator(`[data-song-id="${uuid}"]`).first().getByTestId('song-track-name').first().textContent()
    return name?.trim() ?? ''
}

const DOWNLOAD_ID = /\/v1\/download\/([0-9a-f-]+)/i

// Every request the page makes for a song's audio, in order. Counting these is
// how a test tells an attempt that was never made from one that failed.
export function recordDownloadRequests(page: Page): string[] {
    const requested: string[] = []
    page.on('request', req => {
        const m = req.url().match(DOWNLOAD_ID)
        if (m) requested.push(m[1])
    })
    return requested
}

// Intercepts song downloads, recording the id of each. `respond` decides the
// answer (default: let it through) and applies to every download. `saveOnly`
// records only the saves' own fetches: the player's audio element asks for its
// own song too, and which song that is depends on the user's saved state, so a
// test counting what a save attempted cannot tell the two apart by id.
export async function recordDownloads(
    page: Page,
    respond: (route: Route) => Promise<void> = route => route.continue(),
    opts: { saveOnly?: boolean } = {},
): Promise<Set<string>> {
    const asked = new Set<string>()
    await page.route('**/v1/download/**', async route => {
        const m = route.request().url().match(DOWNLOAD_ID)
        if (m && (!opts.saveOnly || route.request().resourceType() === 'fetch')) asked.add(m[1])
        await respond(route)
    })
    return asked
}

// The song the player restored on load, read off the element's stream URL once
// the restore has assigned one. A test that wants "a different song" needs to
// know which one the restore will have put there.
export async function restoredSongId(page: Page): Promise<string | null> {
    const read = () => page.locator('audio').first().evaluate((el: HTMLAudioElement) => {
        const m = el.src.match(/\/v1\/download\/([0-9a-f-]+)/i)
        return m ? m[1] : null
    })
    try {
        await expect.poll(read, { timeout: 10000 }).not.toBeNull()
    } catch { /* a user with no saved state restores nothing */ }
    return read()
}

// Asserts `read()` does not change for `ms`. For "nothing happens" checks, where
// passing at once proves only that it has not happened yet, and a bare sleep is
// banned by the README. Fails as soon as the value moves.
export async function expectStable<T>(read: () => Promise<T> | T, ms = 1500): Promise<void> {
    const first = await read()
    const end = Date.now() + ms
    let moved: string | null = null
    await expect.poll(async () => {
        if (moved) return moved
        const now = await read()
        if (now !== first) moved = `changed: ${String(first)} -> ${String(now)}`
        return moved ?? (Date.now() >= end ? 'stable' : 'waiting')
    }, { timeout: ms + 5000, intervals: [100] }).toBe('stable')
}
