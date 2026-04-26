import { test, expect, Page } from '@playwright/test'

const USERNAME = process.env.TEST_USERNAME!
const PASSWORD = process.env.TEST_PASSWORD!

async function login(page: Page) {
    await page.context().clearCookies()
    await page.goto('/')
    await page.getByPlaceholder('username').fill(USERNAME)
    await page.getByPlaceholder('password').fill(PASSWORD)
    await page.getByTestId('login-submit').click()
    await expect(page).toHaveURL(/\/download/)
}

function ignoreError(msg: string) {
    return /AbortError|favicon|401/i.test(msg)
}

test.describe('download page', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('unauthenticated user is redirected to root', async ({ page }) => {
        await page.context().clearCookies()
        await page.goto('/download')
        await expect(page).toHaveURL('/')
    })

    test('download page shows song, album, URL options', async ({ page }) => {
        await page.goto('/download')
        await expect(page.getByRole('link', { name: 'Song' })).toBeVisible({ timeout: 5000 })
        await expect(page.getByRole('link', { name: 'Album' })).toBeVisible()
        await expect(page.getByRole('link', { name: 'URL' })).toBeVisible()
    })

    test('Song link navigates to /download/song', async ({ page }) => {
        await page.goto('/download')
        await page.getByRole('link', { name: 'Song' }).click()
        await expect(page).toHaveURL(/\/download\/song/)
    })

    test('Album link navigates to /download/album', async ({ page }) => {
        await page.goto('/download')
        await page.getByRole('link', { name: 'Album' }).click()
        await expect(page).toHaveURL(/\/download\/album/)
    })

    test('URL link navigates to /download/url', async ({ page }) => {
        await page.goto('/download')
        await page.getByRole('link', { name: 'URL' }).click()
        await expect(page).toHaveURL(/\/download\/url/)
    })

    // --- song search sub-page ---

    test('song search: results appear for "jolene"', async ({ page }) => {
        await page.goto('/download/song?query=jolene')
        const card = page.getByTestId('song-card').filter({ hasText: /jolene/i }).first()
        await expect(card).toBeVisible({ timeout: 15000 })
    })

    test('song search: kebab menu opens on hover', async ({ page }) => {
        await page.goto('/download/song?query=jolene')
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await card.hover()
        await expect(card.getByTestId('song-kebab')).toBeVisible({ timeout: 3000 })
    })

    test('song search: kebab menu shows expected actions', async ({ page }) => {
        await page.goto('/download/song?query=jolene')
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await card.hover()
        await card.getByTestId('song-kebab').click()
        const menu = page.getByTestId('song-kebab-menu')
        await expect(menu).toBeVisible({ timeout: 3000 })
        await expect(menu.getByRole('button', { name: /download/i })).toBeVisible()
        await expect(menu.getByRole('button', { name: /play next/i })).toBeVisible()
        await expect(menu.getByRole('button', { name: /edit/i })).toBeVisible()
        await page.keyboard.press('Escape')
    })

    test('song search: clicking card starts player', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await page.goto('/download/song?query=jolene')
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
        await expect(page.getByTestId('player-track-name')).toBeVisible()

        expect(errors).toHaveLength(0)
    })

    test('song search: library bookmark button visible on card', async ({ page }) => {
        await page.goto('/download/song?query=jolene')
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await expect(card.getByTestId('song-library-toggle')).toBeVisible()
    })

    // --- URL download sub-page ---

    test('URL sub-page: input field is present', async ({ page }) => {
        await page.goto('/download/url')
        await expect(page.locator('input[type="url"], input[type="text"]').first()).toBeVisible({ timeout: 5000 })
    })

    test('no console errors on download page', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error' && !ignoreError(msg.text())) errors.push(msg.text()) })
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await page.goto('/download')
        await page.waitForTimeout(1000)
        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })
})
