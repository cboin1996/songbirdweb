import { test, expect } from '@playwright/test'

const API_BASE = `http://${process.env.NEXT_PUBLIC_API_HOST ?? 'localhost'}:8000/v1`
const TEST_USER = 'test_pw_user'
const TEST_EMAIL = 'test_pw@songbird.test'
const TEST_INITIAL_PW = 'InitialPass1!'
const TEST_NEW_PW = 'NewPass2!'

let testUserId: string

async function loginAs(page: any, username: string, password: string) {
    await page.context().clearCookies()
    await page.goto('/')
    await page.getByPlaceholder('username').fill(username)
    await page.getByPlaceholder('password').fill(password)
    await page.getByTestId('login-submit').click()
    await expect(page).toHaveURL(/\/download/)
}

test.describe('settings - change password', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeAll(async ({ request }) => {
        await request.post(`${API_BASE}/auth/login`, {
            data: { username: process.env.TEST_USERNAME!, password: process.env.TEST_PASSWORD! },
        })
        // Clean up any leftover from a previous run
        const usersRes = await request.get(`${API_BASE}/admin/users`)
        const users = await usersRes.json()
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
        await page.goto('/settings')
        await page.getByPlaceholder('current password').fill('wrongpassword')
        await page.getByPlaceholder('new password').fill(TEST_NEW_PW)
        await page.getByPlaceholder('confirm new password').fill(TEST_NEW_PW)
        await page.getByRole('button', { name: 'update password' }).click()
        await expect(page.getByText('incorrect current password')).toBeVisible()
    })

    test('correct password change succeeds', async ({ page }) => {
        await loginAs(page, TEST_USER, TEST_INITIAL_PW)
        await page.goto('/settings')
        await page.getByPlaceholder('current password').fill(TEST_INITIAL_PW)
        await page.getByPlaceholder('new password').fill(TEST_NEW_PW)
        await page.getByPlaceholder('confirm new password').fill(TEST_NEW_PW)
        await page.getByRole('button', { name: 'update password' }).click()
        await expect(page.getByText('password updated')).toBeVisible()
    })

    test('new password works, old password does not', async ({ page }) => {
        await loginAs(page, TEST_USER, TEST_NEW_PW)

        await page.context().clearCookies()
        await page.goto('/')
        await page.getByPlaceholder('username').fill(TEST_USER)
        await page.getByPlaceholder('password').fill(TEST_INITIAL_PW)
        await page.getByTestId('login-submit').click()
        await expect(page.getByText('invalid credentials')).toBeVisible()
    })
})
