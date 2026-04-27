import { test, expect, Page } from '@playwright/test'
import { USERNAME, PASSWORD, login, ignoreError } from './helpers'


async function startPlayback(page: Page) {
    await page.goto('/library')
    const card = page.getByTestId('song-card').first()
    await expect(card).toBeVisible({ timeout: 10000 })
    await card.click()
    await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
}

test.describe('player bar', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('player bar appears after clicking a song', async ({ page }) => {
        await page.goto('/library')
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
    })

    test('player shows track name of clicked song', async ({ page }) => {
        await page.goto('/library')
        // pick the first card that has a non-empty track name displayed
        const card = page.getByTestId('song-card').filter({ hasText: /\w/ }).first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
        // wait for track name to populate (may be async)
        await expect(page.getByTestId('player-track-name').first()).not.toBeEmpty({ timeout: 5000 })
    })

    test('play/pause button toggles playback', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await startPlayback(page)
        const btn = page.getByTestId('player-play-pause')
        await expect(btn).toBeVisible()

        // click to pause
        await btn.click()
        await page.waitForTimeout(400)
        // click to resume
        await btn.click()
        await page.waitForTimeout(400)

        expect(errors).toHaveLength(0)
    })

    test('shuffle button toggles active class', async ({ page }) => {
        await startPlayback(page)
        const btn = page.getByTestId('player-shuffle')
        await expect(btn).toBeVisible()

        const before = await btn.getAttribute('class')
        await btn.click()
        await page.waitForTimeout(200)
        const after = await btn.getAttribute('class')
        expect(after).not.toEqual(before)

        // toggle back off
        await btn.click()
    })

    test('repeat cycles off → all → one → off', async ({ page }) => {
        await startPlayback(page)
        const btn = page.getByTestId('player-repeat')
        await expect(btn).toBeVisible()

        // off → all
        await btn.click()
        await expect(btn).toHaveClass(/text-sky-500/, { timeout: 2000 })
        await expect(btn.locator('span')).not.toBeVisible()

        // all → one (shows "1" superscript)
        await btn.click()
        await expect(btn.locator('span')).toBeVisible({ timeout: 2000 })

        // one → off
        await btn.click()
        await expect(btn).toHaveClass(/text-gray-400/, { timeout: 2000 })
    })

    test('queue toggle shows and hides queue panel', async ({ page }) => {
        await startPlayback(page)
        const btn = page.getByTestId('player-queue-toggle')
        await expect(btn).toBeVisible()

        // open queue
        await btn.click()
        await expect(btn).toHaveClass(/text-sky-500/, { timeout: 2000 })
        // panel may be present if queue has songs
        await page.waitForTimeout(200)

        // close queue
        await btn.click()
        await expect(btn).toHaveClass(/text-gray-400/, { timeout: 2000 })
    })

    test('progress bar click seeks without error', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await startPlayback(page)
        await page.waitForTimeout(500)

        const progressBar = page.getByTestId('player-progress')
        await expect(progressBar).toBeVisible({ timeout: 5000 })

        const box = await progressBar.boundingBox()
        if (box) {
            await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
        }
        await page.waitForTimeout(300)
        expect(errors).toHaveLength(0)
    })

    test('timestamps render in M:SS format', async ({ page }) => {
        await startPlayback(page)
        await page.waitForTimeout(500)

        const progress = page.getByTestId('player-progress')
        await expect(progress).toBeVisible({ timeout: 5000 })
        const text = await progress.textContent()
        expect(text).toMatch(/\d+:\d{2}/)
    })

    test('player shows "from Library" context link', async ({ page }) => {
        await page.goto('/library')
        const card = page.getByTestId('song-card').first()
        await expect(card).toBeVisible({ timeout: 10000 })
        await card.click()
        await expect(page.getByText(/from Library/i)).toBeVisible({ timeout: 5000 })
    })

    test('no console errors during playback', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error' && !ignoreError(msg.text())) errors.push(msg.text()) })
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await startPlayback(page)
        await page.waitForTimeout(2000)

        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })
})
