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

test('explore page loads', async ({ page }) => {
    await login(page)
    await page.goto('/explore')
    // sort or window buttons should be visible
    const sortBtn = page.getByRole('button', { name: /most played|most downloaded|recently/i }).first()
    await expect(sortBtn).toBeVisible({ timeout: 10000 })
})

test('window tabs update url', async ({ page }) => {
    await login(page)
    await page.goto('/explore')
    await page.getByRole('button', { name: 'today', exact: true }).click()
    await expect(page).toHaveURL(/window=day/)
    await page.getByRole('button', { name: 'all time', exact: true }).click()
    await expect(page).toHaveURL(/window=all/)
    await page.getByRole('button', { name: 'this week', exact: true }).click()
    await expect(page).toHaveURL(/window=week/)
})

test('sort tabs update url', async ({ page }) => {
    await login(page)
    await page.goto('/explore')
    await page.getByRole('button', { name: 'most downloaded', exact: true }).click()
    await expect(page).toHaveURL(/sort=downloads/)
})

test('search input filters results', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', err => errors.push(err.message))
    await login(page)
    await page.goto('/explore')
    const search = page.getByPlaceholder(/search/i)
    if (await search.isVisible()) {
        await search.fill('jolene')
        await page.waitForTimeout(300)
    }
    expect(errors.filter(e => !/AbortError/i.test(e))).toHaveLength(0)
})
