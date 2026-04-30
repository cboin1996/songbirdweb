import { routes } from './routes'
import { test, expect } from '@playwright/test'
import { login, apiLogin, pickFirstLibrarySong, API_V1, ignoreError } from './helpers'

// Locks in share-link behaviour at keebox-beta-1: kebab "Copy share link"
// flips to "Link copied!" and creates a token whose /share/[token] page
// renders the song. We don't read the clipboard (Playwright + Chromium needs
// permission grants); instead we hit POST /v1/share/songs/:id directly to
// fetch a token, then visit /share/[token] in the browser.

test.describe('share links', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('kebab "Copy share link" flips to "Link copied!"', async ({ page }) => {
        // grant clipboard so navigator.clipboard.writeText doesn't reject
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

        await page.goto(routes.library)
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })

        await card.hover()
        await card.getByTestId('song-kebab').click()
        const menu = page.getByTestId('song-kebab-menu')
        await expect(menu).toBeVisible()

        const shareBtn = menu.getByRole('button', { name: /copy share link/i })
        await shareBtn.click()

        // Button label flips — observable confirmation that the share token
        // was created and the link reached the clipboard. API call + setState =
        // can take a moment on first run; bumped timeout to 15s for network delays.
        await expect(menu.getByRole('button', { name: /link copied/i })).toBeVisible({ timeout: 15000 })
    })

    test('share/[token] page renders song properties for a valid token', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        const api = await apiLogin()
        try {
            const song = await pickFirstLibrarySong(api)
            test.skip(!song, 'no library song to share')

            const res = await api.post(`${API_V1}/share/songs/${song!.uuid}`)
            expect(res.ok(), `share token create returned ${res.status()}`).toBe(true)
            const body = await res.json()
            expect(body.token).toBeTruthy()

            await page.goto(`/share/${body.token}`)
            // The track name should appear somewhere on the share page.
            await expect(page.getByText(song!.track, { exact: false }).first()).toBeVisible({ timeout: 10000 })

            expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
        } finally {
            await api.dispose()
        }
    })

    test('share/[token] for invalid token shows error/empty state', async ({ page }) => {
        await page.goto('/share/this-token-does-not-exist-' + Date.now())
        // Either an error UI or a "not found" message — accept anything that's
        // not a hard 500 / blank page. We just check the page rendered.
        await expect(page.locator('body')).toBeVisible()
        // No song-card on a bogus share page
        await expect(page.getByTestId('song-card')).toHaveCount(0)
    })
})
