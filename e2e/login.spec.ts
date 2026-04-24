import { test, expect } from '@playwright/test'

const USERNAME = process.env.TEST_USERNAME!
const PASSWORD = process.env.TEST_PASSWORD!

async function login(page: any) {
  await page.goto('/')
  await page.getByPlaceholder('username').fill(USERNAME)
  await page.getByPlaceholder('password').fill(PASSWORD)
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/download/)
}

test.beforeEach(async ({ page }) => {
  await page.context().clearCookies()
})

test('shows username and password fields', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByPlaceholder('username')).toBeVisible()
  await expect(page.getByPlaceholder('password')).toBeVisible()
})

test('invalid credentials shows error', async ({ page }) => {
  await page.goto('/')
  await page.getByPlaceholder('username').fill('nobody')
  await page.getByPlaceholder('password').fill('wrongpass')
  await page.getByTestId('login-submit').click()
  await expect(page.getByText('invalid credentials')).toBeVisible()
  await expect(page).toHaveURL('/')
})

test('valid credentials redirects to /download', async ({ page }) => {
  await login(page)
})

test('authenticated user visiting / is redirected to /download', async ({ page }) => {
  await login(page)
  await page.goto('/')
  await expect(page).toHaveURL(/\/download/)
})

test('unauthenticated user visiting /download is redirected to /', async ({ page }) => {
  await page.goto('/download')
  await expect(page).toHaveURL('/')
})

test('logout clears session and redirects to /', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL('/')
  await page.goto('/download')
  await expect(page).toHaveURL('/')
})
