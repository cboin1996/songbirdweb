import { routes } from './routes'
import { test, expect } from '@playwright/test'
import { login } from './helpers'

test.describe('error states — page boundaries', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('import page shows QueryError when jobs API fails', async ({ page }) => {
        await page.route('**/v1/import?*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )
        await page.goto(routes.import)
        await expect(page.getByRole('button', { name: 'retry' }).first()).toBeVisible({ timeout: 10000 })
    })

    test('import page retry button recovers after error', async ({ page }) => {
        let blocked = true
        await page.route('**/v1/import?*', route => {
            if (blocked) return route.fulfill({ status: 500, body: 'Internal Server Error' })
            return route.continue()
        })
        await page.goto(routes.import)
        await expect(page.getByRole('button', { name: 'retry' }).first()).toBeVisible({ timeout: 10000 })

        blocked = false
        await page.getByRole('button', { name: 'retry' }).first().click()
        await expect(page.getByRole('button', { name: 'retry' })).not.toBeVisible({ timeout: 10000 })
    })

    test('admin page shows QueryError when edit-jobs API fails', async ({ page }) => {
        await page.route('**/v1/admin/edit-jobs*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )
        await page.goto(routes.admin)
        await expect(page.getByRole('button', { name: 'retry' }).first()).toBeVisible({ timeout: 10000 })
    })

    test('admin page shows QueryError when errors API fails', async ({ page }) => {
        await page.route('**/v1/admin/errors*', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )
        await page.goto(routes.admin)
        await expect(page.getByRole('button', { name: 'retry' }).first()).toBeVisible({ timeout: 10000 })
    })
})

test.describe('error states — mutations', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('remove from library shows error on failure', async ({ page }) => {
        await page.goto(routes.library)
        await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 15000 })

        await page.route('**/v1/library/*', route => {
            if (route.request().method() === 'DELETE')
                return route.fulfill({ status: 500, body: 'Internal Server Error' })
            return route.continue()
        })

        const card = page.getByTestId('song-card').first()
        await card.getByTestId('song-library-toggle').click()
        await expect(page.locator('text=library error, try again')).toBeVisible({ timeout: 5000 })
    })

    test('change password shows error on failure', async ({ page }) => {
        await page.goto(routes.settings)
        await expect(page.getByPlaceholder('current password')).toBeVisible({ timeout: 10000 })

        await page.route('**/v1/auth/password', route =>
            route.fulfill({ status: 500, body: 'Internal Server Error' })
        )
        await page.getByPlaceholder('current password').fill('anything')
        await page.getByPlaceholder('new password', { exact: true }).fill('newpass123')
        await page.getByPlaceholder('confirm new password').fill('newpass123')
        await page.getByRole('button', { name: /update password/i }).click()
        await expect(page.locator('text=incorrect current password')).toBeVisible({ timeout: 5000 })
    })

    test('file upload shows failed status on error', async ({ page }) => {
        await page.route('**/v1/import*', route => {
            if (route.request().method() === 'POST')
                return route.fulfill({ status: 500, body: 'Internal Server Error' })
            return route.continue()
        })
        await page.goto(routes.import)

        const buffer = Buffer.from('fake mp3 content for test')
        await page.getByTestId('import-file-input').setInputFiles({
            name: 'test-error.mp3',
            mimeType: 'audio/mpeg',
            buffer,
        })
        await expect(page.locator('text=upload failed')).toBeVisible({ timeout: 10000 })
    })
})
