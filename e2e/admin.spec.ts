import { test, expect, Page } from '@playwright/test'
import { USERNAME, PASSWORD, login, ignoreError } from './helpers'


test.describe('admin page', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('admin page loads for admin user', async ({ page }) => {
        await page.goto('/admin')
        await expect(page.locator('main')).toBeVisible({ timeout: 10000 })
    })

    test('system stats section renders', async ({ page }) => {
        await page.goto('/admin')
        await expect(page.getByText('system')).toBeVisible({ timeout: 10000 })
    })

    test('disk stats show used / free / total', async ({ page }) => {
        await page.goto('/admin')
        await expect(page.getByText('disk')).toBeVisible({ timeout: 10000 })
        await expect(page.getByText('used')).toBeVisible()
        await expect(page.getByText('free')).toBeVisible()
        await expect(page.getByText('total')).toBeVisible()
        await expect(page.getByText(/GB|MB|KB/i).first()).toBeVisible()
    })

    test('songs count stat is visible', async ({ page }) => {
        await page.goto('/admin')
        await expect(page.getByText('songs').first()).toBeVisible({ timeout: 10000 })
    })

    test('users section shows current admin username', async ({ page }) => {
        await page.goto('/admin')
        await expect(page.getByText('users').first()).toBeVisible({ timeout: 10000 })
        await expect(page.getByText(USERNAME).first()).toBeVisible({ timeout: 5000 })
    })

    test('user table shows role badge (admin)', async ({ page }) => {
        await page.goto('/admin')
        await expect(page.getByText('admin').first()).toBeVisible({ timeout: 10000 })
    })

    test('user table shows active status', async ({ page }) => {
        await page.goto('/admin')
        await expect(page.getByText('active').first()).toBeVisible({ timeout: 10000 })
    })

    test('invite user form has username / email / password fields', async ({ page }) => {
        await page.goto('/admin')
        await expect(page.getByText('invite user')).toBeVisible({ timeout: 10000 })
        await expect(page.getByPlaceholder('username')).toBeVisible()
        await expect(page.getByPlaceholder('email')).toBeVisible()
        await expect(page.getByPlaceholder('password')).toBeVisible()
    })

    test('page is stable with no uncaught errors', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error' && !ignoreError(msg.text())) errors.push(msg.text()) })
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await page.goto('/admin')
        await page.waitForTimeout(2000)
        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })
})
