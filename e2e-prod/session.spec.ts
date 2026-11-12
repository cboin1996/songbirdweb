import { test, expect } from '@playwright/test'
import { login, SEARCH_USERNAME, SEARCH_PASSWORD, API_V1 } from '../e2e/helpers'

// The session on the production build. Audio has no client-side 401 recovery (a resume after a
// long pause asks for ranges with no visibility event first), so the middleware refreshes an
// expired session on a song download. Everything else leaves refreshing to the page's own code.
test.describe('session on the production build', () => {
    test.beforeEach(async ({ page }) => {
        await login(page, SEARCH_USERNAME, SEARCH_PASSWORD)
    })

    async function firstSongId(page: import('@playwright/test').Page): Promise<string> {
        const res = await page.request.get(`${API_V1}/songs/library`)
        expect(res.ok()).toBe(true)
        const songs = await res.json() as { uuid: string }[]
        expect(songs.length).toBeGreaterThan(0)
        return songs[0].uuid
    }

    test('a download with an expired access cookie is refreshed and answered', async ({ page, context }) => {
        const id = await firstSongId(page)
        await context.clearCookies({ name: 'access_token' })
        expect((await context.cookies()).some(c => c.name === 'access_token')).toBe(false)

        const res = await page.request.get(`/v1/download/${id}`, { headers: { Range: 'bytes=0-1023' } })
        expect(res.status()).toBe(206)
        expect((await res.body()).length).toBe(1024)
        // The refreshed cookie reached the browser's jar.
        expect((await context.cookies()).some(c => c.name === 'access_token')).toBe(true)
    })

    test('a page load with an expired access cookie stays signed in, asking the browser to refresh at most once', async ({ page, context }) => {
        const refreshes: string[] = []
        page.on('request', r => { if (new URL(r.url()).pathname === '/v1/auth/refresh') refreshes.push(r.url()) })
        await context.clearCookies({ name: 'access_token' })
        await page.goto('/library')
        await expect(page).toHaveURL(/\/library/)
        await expect(page.locator('[data-song-id]').first()).toBeVisible({ timeout: 15000 })
        expect(refreshes.length).toBeLessThanOrEqual(1)
    })

    test('switching tabs asks for no current user', async ({ page }) => {
        await page.goto('/library')
        await expect(page.locator('[data-song-id]').first()).toBeVisible({ timeout: 15000 })
        await page.waitForTimeout(1500)
        const asked: string[] = []
        page.on('request', r => { if (new URL(r.url()).pathname === '/v1/auth/me') asked.push(r.url()) })
        await page.evaluate(() => {
            const setState = (s: string) => {
                Object.defineProperty(document, 'visibilityState', { value: s, configurable: true })
                document.dispatchEvent(new Event('visibilitychange'))
            }
            setState('hidden')
            setState('visible')
        })
        await page.waitForTimeout(1500)
        expect(asked).toEqual([])
    })
})
