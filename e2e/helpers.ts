import { Page, expect } from '@playwright/test'

export const USERNAME = process.env.TEST_USERNAME!
export const PASSWORD = process.env.TEST_PASSWORD!
const API_HOST = process.env.NEXT_PUBLIC_API_HOST ?? 'localhost'
const API_BASE = `http://${API_HOST}:8000`

export function ignoreError(msg: string) {
    return /AbortError|favicon|401|no supported sources/i.test(msg)
}

// Bypass the React form: call the API from inside the browser so httpOnly cookies
// are set correctly in the Playwright browser context.
export async function login(page: Page) {
    await page.context().clearCookies()
    await page.goto('/')
    const ok = await page.evaluate(
        async ({ url, username, password }) => {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                credentials: 'include',
            })
            return resp.ok
        },
        { url: `${API_BASE}/v1/auth/login`, username: USERNAME, password: PASSWORD },
    )
    if (!ok) throw new Error(`Login API call failed for user: ${USERNAME}`)
    await page.goto('/download')
    await expect(page).toHaveURL(/\/download/, { timeout: 10000 })
}
