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

test.beforeEach(async ({ page }) => {
    await page.context().clearCookies()
})

test('admin page loads for admin user', async ({ page }) => {
    await login(page)
    await page.goto('/admin')
    await expect(page.getByText(/songs/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/users/i)).toBeVisible()
})

test('user table shows at least one user', async ({ page }) => {
    await login(page)
    await page.goto('/admin')
    // user table rows show usernames
    await expect(page.locator('table, [data-testid="user-table"]').first()).toBeVisible({ timeout: 10000 })
})

test('disk usage stats are displayed', async ({ page }) => {
    await login(page)
    await page.goto('/admin')
    // system stats show some byte/size value
    await expect(page.getByText(/GB|MB|KB|disk/i).first()).toBeVisible({ timeout: 10000 })
})

test('no console errors on admin page load', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
    page.on('pageerror', err => errors.push(err.message))
    await login(page)
    await page.goto('/admin')
    await page.waitForTimeout(2000)
    const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e))
    expect(realErrors, `Console errors: ${realErrors.join('\n')}`).toHaveLength(0)
})
