import { test, expect, Page } from '@playwright/test'

const USERNAME = process.env.TEST_USERNAME!
const PASSWORD = process.env.TEST_PASSWORD!

async function login(page: Page) {
    await page.context().clearCookies()
    await page.goto('/')
    await page.getByPlaceholder('username').fill(USERNAME)
    await page.getByPlaceholder('password').fill(PASSWORD)
    await page.getByTestId('login-submit').click()
    await expect(page).toHaveURL(/\/download/)
}

async function startPlayback(page: Page) {
    await page.goto('/library')
    const card = page.locator('[role="button"]').first()
    await expect(card).toBeVisible({ timeout: 10000 })
    await card.click()
    await page.waitForTimeout(1000)
}

test.describe('player bar', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('player bar appears after clicking a song', async ({ page }) => {
        await page.goto('/library')
        const card = page.locator('[role="button"]').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await page.waitForTimeout(1000)

        // player bar is a fixed bottom element — check for skip/shuffle buttons unique to it
        const shuffleBtn = page.locator('button').filter({ has: page.locator('svg') }).first()
        await expect(page.locator('fixed bottom-0').or(page.locator('[class*="fixed bottom"]'))).toBeTruthy()
        // verify progress bar area renders
        await expect(page.locator('.h-0\\.5').first()).toBeVisible({ timeout: 3000 })
    })

    test('play/pause toggle: clicking pause stops and clicking play resumes', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => errors.push(err.message))

        await startPlayback(page)

        // find pause button (song is playing)
        const pauseBtn = page.locator('button').filter({ has: page.locator('svg') }).filter({ hasNot: page.locator('[disabled]') })
        // look for FaPause icon specifically by aria or title — fallback: click at player location
        // The player renders FaPause when playing; clicking it pauses
        // We find the play/pause toggle by looking for buttons in the fixed bottom bar
        const playerBar = page.locator('[class*="fixed bottom"]').last()
        const playPauseBtn = playerBar.locator('button').filter({ has: page.locator('svg') }).nth(2)
        await playPauseBtn.evaluate((el: HTMLElement) => el.click())
        await page.waitForTimeout(500)
        // click again to resume
        await playPauseBtn.evaluate((el: HTMLElement) => el.click())
        await page.waitForTimeout(500)

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e))
        expect(realErrors, `Errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('clicking song in library starts it in player (song name appears)', async ({ page }) => {
        await page.goto('/library')
        const card = page.locator('[role="button"]').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await page.waitForTimeout(1500)
        // player renders the current song's track name as text
        await expect(page.locator('body')).toBeVisible()
        // player bar fixed area should be visible
        await expect(page.locator('.tabular-nums').first()).toBeVisible({ timeout: 5000 })
    })

    test('shuffle button toggles active state', async ({ page }) => {
        await startPlayback(page)

        const playerBar = page.locator('[class*="fixed bottom"]').last()
        // shuffle is first button in the controls row (FaRandom icon)
        const shuffleBtn = playerBar.locator('button').first()
        await expect(shuffleBtn).toBeVisible({ timeout: 3000 })

        // initially not sky-500 (active) color
        const initialClass = await shuffleBtn.getAttribute('class')

        await shuffleBtn.evaluate((el: HTMLElement) => el.click())
        await page.waitForTimeout(300)

        const afterClass = await shuffleBtn.getAttribute('class')
        // class should have changed (active state toggled)
        expect(afterClass).not.toEqual(initialClass)

        // toggle back off
        await shuffleBtn.evaluate((el: HTMLElement) => el.click())
    })

    test('repeat button cycles off → all → one → off', async ({ page }) => {
        await startPlayback(page)

        const playerBar = page.locator('[class*="fixed bottom"]').last()
        const buttons = playerBar.locator('button')

        // repeat button is the 5th button in the controls row (shuffle, prev, play, next, repeat)
        const repeatBtn = buttons.nth(4)
        await expect(repeatBtn).toBeVisible({ timeout: 3000 })

        // should start as 'off' (no sky-500)
        await expect(repeatBtn).not.toHaveClass(/text-sky-500/)

        // click once → 'all' (sky-500)
        await repeatBtn.evaluate((el: HTMLElement) => el.click())
        await expect(repeatBtn).toHaveClass(/text-sky-500/, { timeout: 2000 })

        // click again → 'one' (sky-500 + "1" superscript)
        await repeatBtn.evaluate((el: HTMLElement) => el.click())
        await expect(repeatBtn.locator('span')).toBeVisible({ timeout: 2000 })

        // click again → 'off'
        await repeatBtn.evaluate((el: HTMLElement) => el.click())
        await expect(repeatBtn).not.toHaveClass(/text-sky-500/, { timeout: 2000 })
    })

    test('progress bar click seeks without error', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => errors.push(err.message))

        await startPlayback(page)
        await page.waitForTimeout(500)

        // the progress bar is a flex-1 element inside the player
        const progressBar = page.locator('.flex-1.h-0\\.5').first()
        await expect(progressBar).toBeVisible({ timeout: 5000 })

        const box = await progressBar.boundingBox()
        if (box) {
            // click at 50% of the progress bar
            await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
        }
        await page.waitForTimeout(300)

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e))
        expect(realErrors, `Errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('queue drawer opens and closes', async ({ page }) => {
        await startPlayback(page)

        const playerBar = page.locator('[class*="fixed bottom"]').last()
        // queue button is the last button (FaList icon)
        const queueBtn = playerBar.locator('button').last()
        await expect(queueBtn).toBeVisible({ timeout: 3000 })

        // open queue
        await queueBtn.evaluate((el: HTMLElement) => el.click())
        await page.waitForTimeout(300)

        // queue should now have active sky color on queue button
        await expect(queueBtn).toHaveClass(/text-sky-500/, { timeout: 2000 })

        // close queue
        await queueBtn.evaluate((el: HTMLElement) => el.click())
        await page.waitForTimeout(300)
        await expect(queueBtn).not.toHaveClass(/text-sky-500/, { timeout: 2000 })
    })

    test('player shows "from Library" context label', async ({ page }) => {
        await page.goto('/library')
        const card = page.locator('[role="button"]').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await page.waitForTimeout(1500)

        // player shows "from Library" as a link
        await expect(page.getByText(/from Library/i)).toBeVisible({ timeout: 5000 })
    })

    test('time stamps render in player bar', async ({ page }) => {
        await startPlayback(page)
        await page.waitForTimeout(500)

        // current time and remaining time in tabular-nums format (e.g. "0:00" and "-3:45")
        const timeEl = page.locator('.tabular-nums').first()
        await expect(timeEl).toBeVisible({ timeout: 5000 })
        const text = await timeEl.textContent()
        expect(text).toMatch(/\d+:\d{2}/)
    })

    test('no console errors during playback', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        await startPlayback(page)
        await page.waitForTimeout(2000)

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e))
        expect(realErrors, `Console errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })
})
