import { routes } from './routes'
import { test, expect } from '@playwright/test'
import { login } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.context().clearCookies()
})

test('shows username and password fields', async ({ page }) => {
  await page.goto(routes.home)
  await expect(page.getByPlaceholder('username')).toBeVisible()
  await expect(page.getByPlaceholder('password')).toBeVisible()
})

test('invalid credentials shows error', async ({ page }) => {
  await page.goto(routes.home)
  await page.getByPlaceholder('username').fill('nobody')
  await page.getByPlaceholder('password').fill('wrongpass')
  await expect(page.getByTestId('login-submit')).toBeEnabled({ timeout: 5000 })
  await page.getByTestId('login-submit').click()
  await expect(page.getByText('invalid credentials')).toBeVisible({ timeout: 5000 })
  await expect(page).toHaveURL('/')
})

test('valid credentials redirects to /download', async ({ page }) => {
  await login(page)
})

test('authenticated user visiting / is redirected to /download', async ({ page }) => {
  await login(page)
  await page.goto(routes.home)
  await expect(page).toHaveURL(/\/download/)
})

test('unauthenticated user visiting /download is redirected to /', async ({ page }) => {
  await page.goto(routes.download)
  await expect(page).toHaveURL('/')
})

test('logout clears session and redirects to /', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL('/')
  await page.goto(routes.download)
  await expect(page).toHaveURL('/')
})
