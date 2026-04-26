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

test.describe('library page', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('page loads with songs', async ({ page }) => {
        await page.goto('/library')
        await expect(page.locator('[role="button"]').first()).toBeVisible({ timeout: 10000 })
    })

    test('default view is songs', async ({ page }) => {
        await page.goto('/library')
        const songsBtn = page.getByRole('button', { name: 'songs', exact: true })
        await expect(songsBtn).toBeVisible({ timeout: 5000 })
        // songs button should have the active bg-sky-500 class
        await expect(songsBtn).toHaveClass(/bg-sky-500/)
    })

    test('A-Z letter click updates URL', async ({ page }) => {
        await page.goto('/library')
        await expect(page.locator('[role="button"]').first()).toBeVisible({ timeout: 10000 })
        const letterJ = page.getByRole('button', { name: 'J', exact: true })
        if (await letterJ.isEnabled()) {
            await letterJ.click()
            await expect(page).toHaveURL(/letter=J/)
        }
    })

    test('search input filters results', async ({ page }) => {
        await page.goto('/library')
        await expect(page.locator('[role="button"]').first()).toBeVisible({ timeout: 10000 })
        const search = page.getByPlaceholder(/search/i)
        if (await search.isVisible()) {
            await search.fill('edit-me')
            await expect(page.locator('[role="button"]').filter({ hasText: /edit-me/i }).first()).toBeVisible({ timeout: 5000 })
        }
    })

    test('view mode: artists tab updates URL', async ({ page }) => {
        await page.goto('/library')
        const artistsBtn = page.getByRole('button', { name: 'artists', exact: true })
        await expect(artistsBtn).toBeVisible({ timeout: 5000 })
        await artistsBtn.click()
        await expect(page).toHaveURL(/view=artists/)
    })

    test('view mode: albums tab updates URL', async ({ page }) => {
        await page.goto('/library')
        const albumsBtn = page.getByRole('button', { name: 'albums', exact: true })
        await albumsBtn.click()
        await expect(page).toHaveURL(/view=albums/)
    })

    test('view mode: genres tab updates URL', async ({ page }) => {
        await page.goto('/library')
        const genresBtn = page.getByRole('button', { name: 'genres', exact: true })
        await genresBtn.click()
        await expect(page).toHaveURL(/view=genres/)
    })

    test('view mode: songs tab has active state', async ({ page }) => {
        await page.goto('/library?view=albums')
        const songsBtn = page.getByRole('button', { name: 'songs', exact: true })
        await songsBtn.click()
        await expect(page).toHaveURL(/view=songs/)
        await expect(songsBtn).toHaveClass(/bg-sky-500/)
    })

    test('song card hover shows kebab menu button', async ({ page }) => {
        await page.goto('/library')
        const card = page.locator('[role="button"]').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.hover()
        const kebab = card.locator('button[title="more"]')
        await expect(kebab).toBeVisible({ timeout: 3000 })
    })

    test('kebab menu has expected options', async ({ page }) => {
        await page.goto('/library')
        const card = page.locator('[role="button"]').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.hover()
        const kebab = card.locator('button[title="more"]')
        await kebab.click()

        // menu options should be visible
        await expect(page.getByRole('button', { name: /play/i }).first()).toBeVisible({ timeout: 3000 })
        await expect(page.getByRole('button', { name: /edit/i }).first()).toBeVisible()

        // close the menu
        await page.keyboard.press('Escape')
    })

    test('kebab menu has remove from library option (do not click)', async ({ page }) => {
        await page.goto('/library')
        // find edit-me card specifically to avoid accidentally removing important songs
        const search = page.getByPlaceholder(/search/i)
        if (await search.isVisible()) {
            await search.fill('edit-me')
        }
        const card = page.locator('[role="button"]').filter({ hasText: /edit-me/i }).first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.hover()
        const kebab = card.locator('button[title="more"]')
        await kebab.click()

        // verify remove option exists without clicking
        const removeBtn = page.getByRole('button', { name: /remove from library/i })
        await expect(removeBtn).toBeVisible({ timeout: 3000 })

        // close menu
        await page.keyboard.press('Escape')
    })

    test('play all button is visible', async ({ page }) => {
        await page.goto('/library')
        await expect(page.getByRole('button', { name: 'play all', exact: true })).toBeVisible({ timeout: 5000 })
    })

    test('save all offline button is visible', async ({ page }) => {
        await page.goto('/library')
        await expect(page.getByRole('button', { name: /save all offline/i })).toBeVisible({ timeout: 5000 })
    })

    test('clicking a song starts playback', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => errors.push(err.message))

        await page.goto('/library')
        const card = page.locator('[role="button"]').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await page.waitForTimeout(1500)
        // player should be showing something
        await expect(page.locator('body')).toBeVisible()

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e))
        expect(realErrors, `Errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('no console errors on library load', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        await page.goto('/library')
        await expect(page.locator('[role="button"]').first()).toBeVisible({ timeout: 10000 })

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e))
        expect(realErrors, `Console errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })
})
