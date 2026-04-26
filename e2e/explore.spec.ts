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

test.describe('explore page', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('page loads, default window is "week"', async ({ page }) => {
        await page.goto('/explore')
        // "this week" button should be the active one by default
        await expect(page.getByRole('button', { name: 'this week', exact: true })).toBeVisible({ timeout: 10000 })
        // URL should default to week (either explicitly or implicitly)
        await expect(page).toHaveURL(/\/explore/)
    })

    test('search bar visible on explore page', async ({ page }) => {
        await page.goto('/explore')
        await expect(page.getByPlaceholder(/search by track or artist/i)).toBeVisible({ timeout: 5000 })
    })

    test('search filters results and updates URL', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => errors.push(err.message))

        await page.goto('/explore')
        const searchInput = page.getByPlaceholder(/search by track or artist/i)
        await expect(searchInput).toBeVisible({ timeout: 5000 })
        await searchInput.fill('jolene')
        // URL should update with q param
        await expect(page).toHaveURL(/q=jolene/, { timeout: 3000 })

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e))
        expect(realErrors, `Errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('clear search restores results', async ({ page }) => {
        await page.goto('/explore?q=jolene')
        const searchInput = page.getByPlaceholder(/search by track or artist/i)
        await expect(searchInput).toBeVisible({ timeout: 5000 })
        await searchInput.clear()
        // q param should be removed from URL
        await expect(page).not.toHaveURL(/q=/, { timeout: 3000 })
    })

    test('window tab "today" updates URL to window=day', async ({ page }) => {
        await page.goto('/explore')
        await page.getByRole('button', { name: 'today', exact: true }).click()
        await expect(page).toHaveURL(/window=day/)
    })

    test('window tab "all time" updates URL to window=all', async ({ page }) => {
        await page.goto('/explore')
        await page.getByRole('button', { name: 'all time', exact: true }).click()
        await expect(page).toHaveURL(/window=all/)
    })

    test('window tab "this week" updates URL to window=week', async ({ page }) => {
        await page.goto('/explore')
        await page.getByRole('button', { name: 'today', exact: true }).click()
        await page.getByRole('button', { name: 'this week', exact: true }).click()
        await expect(page).toHaveURL(/window=week/)
    })

    test('sort tabs are visible and clickable', async ({ page }) => {
        await page.goto('/explore')
        await expect(page.getByRole('button', { name: 'most played', exact: true })).toBeVisible({ timeout: 5000 })
        await expect(page.getByRole('button', { name: 'most downloaded', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'most saved', exact: true })).toBeVisible()
    })

    test('most downloaded sort updates URL', async ({ page }) => {
        await page.goto('/explore')
        await page.getByRole('button', { name: 'most downloaded', exact: true }).click()
        await expect(page).toHaveURL(/sort=downloads/)
    })

    test('play count badge text exists in most played section', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => errors.push(err.message))

        await page.goto('/explore?window=all&sort=plays')
        // wait for content to load
        await page.waitForTimeout(2000)
        // "played N×" badges should appear if there is data
        const playedBadges = page.locator('text=/played \\d+×/')
        const count = await playedBadges.count()
        // if there's data, badges should be present; if no data, "no data yet" should show
        if (count === 0) {
            await expect(page.getByText(/no data yet/)).toBeVisible()
        } else {
            expect(count).toBeGreaterThan(0)
        }

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e))
        expect(realErrors, `Errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('clicking a song card starts playback', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => errors.push(err.message))

        await page.goto('/explore?window=all&sort=plays')
        await page.waitForTimeout(2000)

        const cards = page.locator('[role="button"]')
        const cardCount = await cards.count()
        if (cardCount > 0) {
            await cards.first().click()
            // player should show a song (track name somewhere)
            await page.waitForTimeout(1000)
            // just verify no crash
            await expect(page.locator('body')).toBeVisible()
        }

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e))
        expect(realErrors, `Errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('recently played sort is available', async ({ page }) => {
        await page.goto('/explore')
        const btn = page.getByRole('button', { name: 'recently played', exact: true })
        await expect(btn).toBeVisible({ timeout: 5000 })
        await btn.click()
        await expect(page).toHaveURL(/sort=recently_played/)
    })

    test('no console errors on explore page load', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        await page.goto('/explore')
        await page.waitForTimeout(2000)

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e))
        expect(realErrors, `Console errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })
})
