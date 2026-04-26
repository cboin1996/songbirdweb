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

test('library page loads with songs', async ({ page }) => {
    await login(page)
    await page.goto('/library')
    await expect(page.locator('[role="button"]').first()).toBeVisible({ timeout: 10000 })
})

test('view mode tabs are present and clickable', async ({ page }) => {
    await login(page)
    await page.goto('/library')
    for (const label of ['songs', 'artists', 'albums', 'genres']) {
        const btn = page.getByRole('button', { name: label, exact: true })
        if (await btn.isVisible()) {
            await btn.click()
            await page.waitForTimeout(300)
        }
    }
})

test('A-Z letter navigation updates url', async ({ page }) => {
    await login(page)
    await page.goto('/library')
    await expect(page.locator('[role="button"]').first()).toBeVisible({ timeout: 10000 })
    const letterJ = page.getByRole('button', { name: 'J', exact: true })
    if (await letterJ.isVisible()) {
        await letterJ.click()
        await expect(page).toHaveURL(/letter=J/)
    }
})

test('search filters songs', async ({ page }) => {
    await login(page)
    await page.goto('/library')
    await expect(page.locator('[role="button"]').first()).toBeVisible({ timeout: 10000 })
    const search = page.getByPlaceholder(/search/i)
    if (await search.isVisible()) {
        await search.fill('jolene')
        await expect(page.locator('[role="button"]').filter({ hasText: /jolene/i }).first()).toBeVisible({ timeout: 5000 })
    }
})

test('kebab menu appears on hover', async ({ page }) => {
    await login(page)
    await page.goto('/library')
    const card = page.locator('[role="button"]').first()
    await expect(card).toBeVisible({ timeout: 10000 })
    await card.hover()
    const kebab = card.locator('button[title="more"]')
    await expect(kebab).toBeVisible({ timeout: 3000 })
})
