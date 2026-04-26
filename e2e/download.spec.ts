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

test('unauthenticated user is redirected to login', async ({ page }) => {
    await page.goto('/download')
    await expect(page).toHaveURL('/')
})

test('download page loads after login', async ({ page }) => {
    await login(page)
    await expect(page.getByPlaceholder(/url/i)).toBeVisible({ timeout: 5000 })
})

test('song mode search shows results for jolene', async ({ page }) => {
    await login(page)
    await page.goto('/download/song?query=jolene&mode=song')
    const card = page.locator('[role="button"]').filter({ hasText: /jolene/i }).first()
    await expect(card).toBeVisible({ timeout: 10000 })
})

test('song search input updates url query', async ({ page }) => {
    await login(page)
    await page.goto('/download/song')
    const input = page.getByPlaceholder(/search/i).first()
    if (await input.isVisible()) {
        await input.fill('beatles')
        await expect(page).toHaveURL(/beatles/, { timeout: 3000 })
    }
})
