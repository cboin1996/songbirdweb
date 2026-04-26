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
        await expect(page).toHaveURL(/view=artists/)
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
        await expect(page.getByTestId('player-track-name')).toBeVisible()

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
})
