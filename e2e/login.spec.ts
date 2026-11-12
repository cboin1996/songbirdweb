import { routes } from './routes'
import { test, expect } from './fixtures/test'
import { login, USERNAME, PASSWORD } from './helpers'

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

test('login follows a same-origin next path', async ({ page }) => {
  await page.goto('/?next=' + encodeURIComponent(routes.library))
  await page.getByPlaceholder('username').fill(USERNAME)
  await page.getByPlaceholder('password').fill(PASSWORD)
  await expect(page.getByTestId('login-submit')).toBeEnabled({ timeout: 5000 })
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(new RegExp(routes.library))
})

test('login says why when the session expired, and only then', async ({ page }) => {
  await page.goto('/?next=' + encodeURIComponent(routes.library) + '&expired=1')
  await expect(page.getByTestId('login-expired')).toBeVisible()
  await page.goto('/?next=' + encodeURIComponent(routes.library))
  await expect(page.getByTestId('login-submit')).toBeVisible()
  await expect(page.getByTestId('login-expired')).toHaveCount(0)
})

test('login ignores a next that points off-site', async ({ page }) => {
  // Stub the foreign host so a regression lands on a known page instead of the network.
  await page.route('https://evil.example/**', route => route.fulfill({ status: 200, body: 'off-site' }))
  await page.goto('/?next=' + encodeURIComponent('https://evil.example/phish'))
  await page.getByPlaceholder('username').fill(USERNAME)
  await page.getByPlaceholder('password').fill(PASSWORD)
  await expect(page.getByTestId('login-submit')).toBeEnabled({ timeout: 5000 })
  await page.getByTestId('login-submit').click()
  await expect(page).toHaveURL(/\/download/)
})

test('logout clears session and redirects to /', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL('/')
  await page.goto(routes.download)
  await expect(page).toHaveURL('/')
})
