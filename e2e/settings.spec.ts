import { routes } from './routes'
import { test, expect } from '@playwright/test'
import { login } from './helpers'

const API_BASE = `${process.env.E2E_API_BASE_URL ?? `http://${process.env.NEXT_PUBLIC_API_HOST ?? 'localhost'}:8000`}/v1`
const TEST_USER = 'test_pw_user'
const TEST_EMAIL = 'test_pw@songbird.test'
const TEST_INITIAL_PW = 'InitialPass1!'
const TEST_NEW_PW = 'NewPass2!'

let testUserId: string

async function loginAs(page: any, username: string, password: string) {
    await page.context().clearCookies()
    await page.goto(routes.home)
    const ok = await page.evaluate(
        async ({ url, u, p }: { url: string; u: string; p: string }) => {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u, password: p }),
                credentials: 'include',
            })
            return resp.ok
        },
        { url: `${API_BASE}/auth/login`, u: username, p: password },
    )
    if (!ok) throw new Error(`Login failed for ${username}`)
    await page.goto(routes.download)
    await expect(page).toHaveURL(/\/download/, { timeout: 10000 })
}

test.describe('settings - change password', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeAll(async ({ request }) => {
        await request.post(`${API_BASE}/auth/login`, {
            data: { username: process.env.TEST_USERNAME!, password: process.env.TEST_PASSWORD! },
        })
        // Clean up any leftover from a previous run
        const usersRes = await request.get(`${API_BASE}/admin/users`)
        const usersBody = await usersRes.json()
        const users = Array.isArray(usersBody) ? usersBody : usersBody.users
        const leftover = users.find((u: any) => u.username === TEST_USER)
        if (leftover) await request.delete(`${API_BASE}/admin/users/${leftover.id}`)

        const res = await request.post(`${API_BASE}/auth/register`, {
            data: { username: TEST_USER, email: TEST_EMAIL, password: TEST_INITIAL_PW },
        })
        const user = await res.json()
        testUserId = user.id
    })

    test.afterAll(async ({ request }) => {
        if (!testUserId) return
        await request.post(`${API_BASE}/auth/login`, {
            data: { username: process.env.TEST_USERNAME!, password: process.env.TEST_PASSWORD! },
        })
        await request.delete(`${API_BASE}/admin/users/${testUserId}`)
    })

    test('wrong current password shows error', async ({ page }) => {
        await loginAs(page, TEST_USER, TEST_INITIAL_PW)
        await page.goto(routes.settings)
        await page.getByPlaceholder('current password').fill('wrongpassword')
        await page.getByPlaceholder('new password', { exact: true }).fill(TEST_NEW_PW)
        await page.getByPlaceholder('confirm new password').fill(TEST_NEW_PW)
        await page.getByRole('button', { name: 'update password' }).click()
        await expect(page.getByText('incorrect current password')).toBeVisible()
    })

    test('correct password change succeeds', async ({ page }) => {
        await loginAs(page, TEST_USER, TEST_INITIAL_PW)
        await page.goto(routes.settings)
        await page.getByPlaceholder('current password').fill(TEST_INITIAL_PW)
        await page.getByPlaceholder('new password', { exact: true }).fill(TEST_NEW_PW)
        await page.getByPlaceholder('confirm new password').fill(TEST_NEW_PW)
        await page.getByRole('button', { name: 'update password' }).click()
        await expect(page.getByText('password updated')).toBeVisible()
    })

    test('new password works, old password does not', async ({ page }) => {
        await loginAs(page, TEST_USER, TEST_NEW_PW)

        // verify old password now rejected — test via API rather than UI form
        const rejected = await page.evaluate(
            async ({ url, u, p }: { url: string; u: string; p: string }) => {
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: u, password: p }),
                    credentials: 'include',
                })
                return resp.status
            },
            { url: `${API_BASE}/auth/login`, u: TEST_USER, p: TEST_INITIAL_PW },
        )
        expect(rejected).toBe(401)
    })
})

test.describe('settings - audio format', () => {
    test('defaults to MP3', async ({ page }) => {
        await login(page)
        await page.goto(routes.settings)
        const mp3 = page.getByRole('button', { name: 'MP3' })
        await expect(mp3).toBeVisible()
        await expect(mp3).toHaveClass(/bg-sky-500/)
    })

    test('switch to M4A persists across reload', async ({ page }) => {
        await login(page)
        await page.goto(routes.settings)

        const m4a = page.getByRole('button', { name: 'M4A' })
        await m4a.click()
        await expect(m4a).toHaveClass(/bg-sky-500/)

        await page.reload()
        await expect(page.getByRole('button', { name: 'M4A' })).toHaveClass(/bg-sky-500/)
    })

    test('switch back to MP3', async ({ page }) => {
        await login(page)
        await page.goto(routes.settings)

        await page.getByRole('button', { name: 'M4A' }).click()
        await expect(page.getByRole('button', { name: 'M4A' })).toHaveClass(/bg-sky-500/)

        await page.getByRole('button', { name: 'MP3' }).click()
        await expect(page.getByRole('button', { name: 'MP3' })).toHaveClass(/bg-sky-500/)

        await page.reload()
        await expect(page.getByRole('button', { name: 'MP3' })).toHaveClass(/bg-sky-500/)
    })

    test('format preference included in download request body', async ({ page }) => {
        await login(page)
        await page.goto(routes.settings)
        await page.getByRole('button', { name: 'M4A' }).click()
        await expect(page.getByRole('button', { name: 'M4A' })).toHaveClass(/bg-sky-500/)

        let capturedBody: any = null
        await page.route('**/v1/download', route => {
            capturedBody = route.request().postDataJSON()
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ song_ids: ['fake-id'], cached: false }),
            })
        })

        await page.goto(`${routes.downloadUrl}?query=${encodeURIComponent('https://example.com/test')}`)
        await expect.poll(() => capturedBody, { timeout: 10000 }).toBeTruthy()
        expect(capturedBody.file_format).toBe('m4a')
    })
})
