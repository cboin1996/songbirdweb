import { routes } from './routes'
import { test, expect } from '@playwright/test'
import { USERNAME, PASSWORD, login, ignoreError } from './helpers'


test.describe('admin page', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('admin page loads for admin user', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.locator('main').filter({ visible: true })).toBeVisible({ timeout: 10000 })
    })

    test('overview stats render songs and users', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.getByText('overview').first()).toBeVisible({ timeout: 10000 })
        await expect(page.getByText('songs', { exact: true }).first()).toBeVisible()
        await expect(page.getByText('users', { exact: true }).first()).toBeVisible()
    })

    test('disk stats show used / free / total', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.getByText('disk').first()).toBeVisible({ timeout: 10000 })
        await expect(page.getByText('used').first()).toBeVisible()
        await expect(page.getByText('free').first()).toBeVisible()
        await expect(page.getByText('total').first()).toBeVisible()
        await expect(page.getByText(/GB|MB|KB/i).first()).toBeVisible()
    })

    // ── Imports section ──

    test('imports section renders with global stats', async ({ page }) => {
        await page.goto(routes.admin)
        const importsHeading = page.getByText('imports', { exact: true })
        await expect(importsHeading.first()).toBeVisible({ timeout: 10000 })
        await expect(page.getByText('succeeded').first()).toBeVisible()
    })

    test('imports table has column headers', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.getByText('imports', { exact: true }).first()).toBeVisible({ timeout: 10000 })
        const section = page.locator('section').filter({ hasText: /^imports/ })
        await expect(section.locator('th', { hasText: 'date' })).toBeVisible()
        await expect(section.locator('th', { hasText: 'user' })).toBeVisible()
        await expect(section.locator('th', { hasText: 'song' })).toBeVisible()
        await expect(section.locator('th', { hasText: 'status' })).toBeVisible()
    })

    test('imports section has search input', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.getByText('imports', { exact: true }).first()).toBeVisible({ timeout: 10000 })
        await expect(page.getByPlaceholder(/filter by name, user, status, filename/)).toBeVisible()
    })

    // ── Edit Jobs section ──

    test('edit jobs section renders with global stats', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.getByText('edit jobs').first()).toBeVisible({ timeout: 10000 })
    })

    test('edit jobs table has column headers', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.getByText('edit jobs').first()).toBeVisible({ timeout: 10000 })
        const section = page.locator('section').filter({ hasText: /^edit jobs/ })
        await expect(section.locator('th', { hasText: 'date' })).toBeVisible()
        await expect(section.locator('th', { hasText: 'user' })).toBeVisible()
        await expect(section.locator('th', { hasText: 'status' })).toBeVisible()
    })

    test('edit jobs section has search input', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.getByText('edit jobs').first()).toBeVisible({ timeout: 10000 })
        await expect(page.getByPlaceholder(/filter by status, id, user, error, date/)).toBeVisible()
    })

    // ── Errors section ──

    test('errors section renders with global stats', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.getByText('errors', { exact: true }).first()).toBeVisible({ timeout: 10000 })
        await expect(page.getByText('error logs').first()).toBeVisible()
    })

    test('errors section has search input', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.getByText('errors', { exact: true }).first()).toBeVisible({ timeout: 10000 })
        await expect(page.getByPlaceholder(/filter by message, path, method, status, user, date/)).toBeVisible()
    })

    // ── Users section ──

    test('users section shows current admin username', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.getByText('users').first()).toBeVisible({ timeout: 10000 })
        await expect(page.getByText(USERNAME).first()).toBeVisible({ timeout: 10000 })
    })

    test('user table shows role badge and active status', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.getByText(USERNAME).first()).toBeVisible({ timeout: 10000 })
        await expect(page.getByText('admin').first()).toBeVisible()
        await expect(page.getByText('active').first()).toBeVisible()
    })

    test('user table has search input', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.getByText(USERNAME).first()).toBeVisible({ timeout: 10000 })
        await expect(page.getByPlaceholder(/filter by username, email, role/)).toBeVisible()
    })

    test('delete button opens password confirmation form', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.getByText(USERNAME).first()).toBeVisible({ timeout: 10000 })
        await page.getByText('delete', { exact: true }).first().click()
        await expect(page.getByPlaceholder('your password')).toBeVisible()
        await expect(page.getByText('confirm delete')).toBeVisible()
        await expect(page.getByText('cancel')).toBeVisible()
    })

    test('delete cancel closes confirmation form', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.getByText(USERNAME).first()).toBeVisible({ timeout: 10000 })
        await page.getByText('delete', { exact: true }).first().click()
        await expect(page.getByPlaceholder('your password')).toBeVisible()
        await page.getByText('cancel').click()
        await expect(page.getByPlaceholder('your password')).not.toBeVisible()
    })

    test('invite user form has username / email / password fields', async ({ page }) => {
        await page.goto(routes.admin)
        await expect(page.getByText('invite user').first()).toBeVisible({ timeout: 10000 })
        await expect(page.getByPlaceholder('username', { exact: true }).first()).toBeVisible()
        await expect(page.getByPlaceholder('email', { exact: true }).first()).toBeVisible()
        await expect(page.getByPlaceholder('password', { exact: true }).first()).toBeVisible()
    })

    test('page is stable with no uncaught errors', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error' && !ignoreError(msg.text())) errors.push(msg.text()) })
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await page.goto(routes.admin)
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })
})
