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

test('info page loads with version cards', async ({ page }) => {
    await login(page)
    await page.goto('/info')
    await expect(page.getByText(/v\d+\.\d+/)).toBeVisible({ timeout: 10000 })
})

test('three component version cards are present', async ({ page }) => {
    await login(page)
    await page.goto('/info')
    await expect(page.getByText(/songbirdweb/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/songbirdapi/i)).toBeVisible()
    await expect(page.getByText(/songbirdcore/i)).toBeVisible()
})

test('bug report links point to github', async ({ page }) => {
    await login(page)
    await page.goto('/info')
    const links = page.locator('a[href*="github.com/cboin1996"]')
    await expect(links.first()).toBeVisible({ timeout: 10000 })
    const count = await links.count()
    expect(count).toBeGreaterThanOrEqual(3)
})

test('navbar info icon navigates to /info', async ({ page }) => {
    await login(page)
    await page.goto('/download')
    const infoLink = page.locator('a[href="/info"]')
    await expect(infoLink).toBeVisible({ timeout: 5000 })
    await infoLink.click()
    await expect(page).toHaveURL(/\/info/)
})
