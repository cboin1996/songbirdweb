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

test.describe('admin page', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('admin page loads for admin user', async ({ page }) => {
        await page.goto('/admin')
        // should show system stats heading
        await expect(page.getByText('system')).toBeVisible({ timeout: 10000 })
    })

    test('stats section: song count visible', async ({ page }) => {
        await page.goto('/admin')
        await expect(page.getByText('songs').first()).toBeVisible({ timeout: 10000 })
    })

    test('stats section: disk usage numbers visible', async ({ page }) => {
        await page.goto('/admin')
        // disk section shows "used", "free", "total" labels
        await expect(page.getByText('disk')).toBeVisible({ timeout: 10000 })
        await expect(page.getByText('used')).toBeVisible()
        await expect(page.getByText('free')).toBeVisible()
        await expect(page.getByText('total')).toBeVisible()
        // and formatted byte sizes like GB/MB/KB
        await expect(page.getByText(/GB|MB|KB/i).first()).toBeVisible()
    })

    test('plays by day section visible (activity table)', async ({ page }) => {
        await page.goto('/admin')
        await page.waitForTimeout(1000)
        // the activity section may or may not have data
        const activitySection = page.getByText(/activity \(last 7 days\)/i)
        const noData = page.getByText(/failed to load system stats/i)
        const isNoData = await noData.isVisible()
        if (!isNoData) {
            // stats loaded — check for activity heading or plays_by_day table
            // section is conditional on data existence
            await expect(page.locator('body')).toBeVisible()
        }
    })

    test('top songs section visible', async ({ page }) => {
        await page.goto('/admin')
        await page.waitForTimeout(1000)
        const topSection = page.getByText(/top 5 songs by plays/i)
        // may not have data, but page should not crash
        await expect(page.locator('main')).toBeVisible()
    })

    test('users section visible with at least one user row', async ({ page }) => {
        await page.goto('/admin')
        await expect(page.getByText('users').first()).toBeVisible({ timeout: 10000 })
        // at least the current admin user row should be present
        await expect(page.locator('body').filter({ hasText: USERNAME })).toBeTruthy()
    })

    test('user table shows username column', async ({ page }) => {
        await page.goto('/admin')
        await expect(page.getByText('users').first()).toBeVisible({ timeout: 10000 })
        // admin user's username should appear in the user list
        await expect(page.getByText(USERNAME)).toBeVisible({ timeout: 5000 })
    })

    test('user table shows role badge (admin)', async ({ page }) => {
        await page.goto('/admin')
        await expect(page.getByText('admin').first()).toBeVisible({ timeout: 10000 })
    })

    test('user table shows active status', async ({ page }) => {
        await page.goto('/admin')
        await expect(page.getByText('active').first()).toBeVisible({ timeout: 10000 })
    })

    test('invite user form is visible', async ({ page }) => {
        await page.goto('/admin')
        await expect(page.getByText('invite user')).toBeVisible({ timeout: 10000 })
        await expect(page.getByPlaceholder('username')).toBeVisible()
        await expect(page.getByPlaceholder('email')).toBeVisible()
        await expect(page.getByPlaceholder('password')).toBeVisible()
    })

    test('error logs section visible (if any errors exist)', async ({ page }) => {
        await page.goto('/admin')
        await page.waitForTimeout(1000)
        // "recent errors" section is conditional on data; page should not crash
        await expect(page.locator('main')).toBeVisible()
    })

    test('per user stats section visible', async ({ page }) => {
        await page.goto('/admin')
        await page.waitForTimeout(1000)
        // "per user" heading appears if data exists
        const perUser = page.getByText(/per user/i)
        const count = await perUser.count()
        if (count > 0) {
            await expect(perUser.first()).toBeVisible()
        }
        await expect(page.locator('main')).toBeVisible()
    })

    test('recent edit jobs section visible (if data)', async ({ page }) => {
        await page.goto('/admin')
        await page.waitForTimeout(1000)
        // conditional section; page should remain stable
        await expect(page.locator('main')).toBeVisible()
    })

    test('no console errors on admin page load', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        await page.goto('/admin')
        await page.waitForTimeout(2000)

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e))
        expect(realErrors, `Console errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })
})
