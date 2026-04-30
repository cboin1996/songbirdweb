import { Page, expect, APIRequestContext, request as pwRequest } from '@playwright/test'

export const USERNAME = process.env.TEST_USERNAME!
export const PASSWORD = process.env.TEST_PASSWORD!
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
export async function login(page: Page) {
    // Check if already authenticated by visiting a protected page.
    await page.goto('/library', { waitUntil: 'domcontentloaded' })
    const isAuth = page.url().includes('/library')
    if (isAuth) {
        // Already authenticated; skip login.
        return
    }

    // Not authenticated; perform login via API.
    await page.context().clearCookies()
    await page.goto('/')
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
        { url: `${API_BASE}/v1/auth/login`, username: USERNAME, password: PASSWORD },
    )
    if (!ok) throw new Error(`Login API call failed for user: ${USERNAME}`)
    await page.goto('/download')
    await expect(page).toHaveURL(/\/download/, { timeout: 10000 })
}

// Build an APIRequestContext logged in as the test user — useful for state
// init/cleanup that doesn't need a browser context.
export async function apiLogin(): Promise<APIRequestContext> {
    const ctx = await pwRequest.newContext({ baseURL: API_BASE })
    const res = await ctx.post(`${API_V1}/auth/login`, {
        data: { username: USERNAME, password: PASSWORD },
    })
    if (!res.ok()) throw new Error(`apiLogin failed: ${res.status()}`)
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
