import { test, expect } from '@playwright/test'
import { login, ignoreError } from './helpers'

// Locks in cross-page navigation at keebox-beta-1: every authenticated route
// reachable from the navbar must load, surface its top-level landmark, and
// not throw. This is the cheapest regression net for "I broke routing".

const ROUTES = [
    { path: '/download', anchor: /song|album|url/i },
    { path: '/library',  anchor: /play all|library/i },
    { path: '/explore',  anchor: /today|this week|all time/i },
    { path: '/import',   anchor: /\.mp3|drag/i },
    { path: '/settings', anchor: /password|settings/i },
    { path: '/info',     anchor: /about/i },
] as const

test.describe('navigation: every authenticated page loads', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    for (const r of ROUTES) {
        test(`${r.path} loads without console errors`, async ({ page }) => {
            const errors: string[] = []
            page.on('console', m => { if (m.type() === 'error' && !ignoreError(m.text())) errors.push(m.text()) })
            page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

            await page.goto(r.path)
            await expect(page.locator('main, body').first()).toBeVisible({ timeout: 10000 })
            await expect(page.getByText(r.anchor).first()).toBeVisible({ timeout: 10000 })

            expect(errors, `Console errors on ${r.path}:\n${errors.join('\n')}`).toHaveLength(0)
        })
    }

    test('navbar links are visible and clickable', async ({ page }) => {
        await page.goto('/download')
        await expect(page.getByRole('link', { name: 'library' })).toBeVisible()
        await expect(page.getByRole('link', { name: 'explore' })).toBeVisible()
        await expect(page.getByRole('link', { name: 'import' })).toBeVisible()
        await expect(page.getByRole('link', { name: 'download' })).toBeVisible()

        await page.getByRole('link', { name: 'library' }).click()
        await expect(page).toHaveURL(/\/library/)

        await page.getByRole('link', { name: 'explore' }).click()
        await expect(page).toHaveURL(/\/explore/)

        await page.getByRole('link', { name: 'download' }).click()
        await expect(page).toHaveURL(/\/download/)
    })
})
