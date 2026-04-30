import { routes } from './routes'
import { test, expect, Page } from '@playwright/test'
import { USERNAME, PASSWORD, login, ignoreError } from './helpers'


test.describe('explore page', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('page loads without crashing', async ({ page }) => {
        await page.goto(routes.explore)
        await expect(page.locator('main')).toBeVisible({ timeout: 10000 })
    })

    test('window tabs visible: today, week, all time', async ({ page }) => {
        await page.goto(routes.explore)
        await expect(page.getByRole('button', { name: 'today', exact: true })).toBeVisible({ timeout: 5000 })
        await expect(page.getByRole('button', { name: 'week', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'all time', exact: true })).toBeVisible()
    })

    test('"today" tab updates URL to window=day', async ({ page }) => {
        await page.goto(routes.explore)
        await page.getByRole('button', { name: 'today', exact: true }).click()
        await expect(page).toHaveURL(/window=day/)
    })

    test('"all time" tab updates URL to window=all', async ({ page }) => {
        await page.goto(routes.explore)
        await page.getByRole('button', { name: 'all time', exact: true }).click()
        await expect(page).toHaveURL(/window=all/)
    })

    test('"week" tab updates URL to window=week', async ({ page }) => {
        await page.goto(routes.explore)
        await page.getByRole('button', { name: 'today', exact: true }).click()
        await page.getByRole('button', { name: 'week', exact: true }).click()
        await expect(page).toHaveURL(/window=week/)
    })

    test('sort dropdown contains: most played, most downloaded, most saved', async ({ page }) => {
        await page.goto(routes.explore)
        // Sort was redesigned from buttons to a <select> dropdown.
        const sort = page.getByRole('combobox')
        await expect(sort).toBeVisible({ timeout: 5000 })
        const opts = sort.locator('option')
        await expect(opts.filter({ hasText: 'most played' })).toHaveCount(1)
        await expect(opts.filter({ hasText: 'most downloaded' })).toHaveCount(1)
        await expect(opts.filter({ hasText: 'most saved' })).toHaveCount(1)
    })

    test('"most downloaded" sort updates URL to sort=downloads', async ({ page }) => {
        await page.goto(routes.explore)
        await page.getByRole('combobox').selectOption('downloads')
        await expect(page).toHaveURL(/sort=downloads/)
    })

    test('"most saved" sort updates URL to sort=saves', async ({ page }) => {
        await page.goto(routes.explore)
        await page.getByRole('combobox').selectOption('saves')
        await expect(page).toHaveURL(/sort=saves/)
    })

    test('"recently played" sort updates URL', async ({ page }) => {
        await page.goto(routes.explore)
        // Recently played only appears when viewFilter === 'you'
        await page.getByRole('button', { name: 'you', exact: true }).click()
        await page.getByRole('combobox').selectOption('recently_played')
        await expect(page).toHaveURL(/sort=recently_played/)
    })

    test('search input is visible', async ({ page }) => {
        await page.goto(routes.explore)
        // Placeholder was simplified to just "search…" when toolbar was redesigned.
        await expect(page.getByPlaceholder(/search/i)).toBeVisible({ timeout: 5000 })
    })

    test('search filters results and updates URL', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await page.goto(routes.explore)
        const input = page.getByPlaceholder(/search/i)
        await expect(input).toBeVisible({ timeout: 5000 })
        await input.fill('jolene')
        await expect(page).toHaveURL(/q=jolene/, { timeout: 3000 })

        expect(errors).toHaveLength(0)
    })

    test('clearing search removes q param from URL', async ({ page }) => {
        await page.goto('/explore?q=jolene')
        const input = page.getByPlaceholder(/search/i)
        await expect(input).toBeVisible({ timeout: 5000 })
        await input.clear()
        await expect(page).not.toHaveURL(/q=/, { timeout: 3000 })
    })

    test('explore page shows song cards or empty state', async ({ page }) => {
        await page.goto('/explore?window=all&sort=plays')
        await page.waitForTimeout(2000)
        const hasCards = await page.getByTestId('song-card').count() > 0
        const hasEmpty = await page.getByText(/no data yet/i).isVisible()
        expect(hasCards || hasEmpty).toBe(true)
    })

    test('clicking a song card starts player', async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await page.goto('/explore?window=all&sort=plays')
        await page.waitForTimeout(2000)

        const cards = page.getByTestId('song-card')
        if (await cards.count() > 0) {
            await cards.first().click()
            await expect(page.getByTestId('player-bar')).toBeVisible({ timeout: 5000 })
        }
        expect(errors).toHaveLength(0)
    })

    test('no console errors on page load', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error' && !ignoreError(msg.text())) errors.push(msg.text()) })
        page.on('pageerror', err => { if (!ignoreError(err.message)) errors.push(err.message) })

        await page.goto(routes.explore)
        await page.waitForTimeout(2000)
        expect(errors, `Console errors: ${errors.join('\n')}`).toHaveLength(0)
    })

    // === Tier 2 relative timestamps ===

    test('"recently added" sort renders relative ago labels', async ({ page }) => {
        await page.goto('/explore?sort=recent')
        await page.waitForTimeout(1500)
        const cards = page.getByTestId('song-card')
        const cardCount = await cards.count()
        test.skip(cardCount === 0, 'no recently-added cards present')
        // Format: "added Xs ago", "Xm ago", "Xh ago", "Xd ago", "Xmo ago",
        // "Xy ago", or "added just now".
        const re = /(\d+)(s|m|h|d|mo|y) ago|just now/i
        const html = await page.locator('main').innerText()
        expect(html, `expected relative-time text in explore page: ${html}`).toMatch(re)
    })

    test('"recently played" sort renders relative ago labels (you view)', async ({ page }) => {
        await page.goto(routes.explore)
        // Recently played requires "you" view filter.
        await page.getByRole('button', { name: 'you', exact: true }).click()
        await page.getByRole('combobox').selectOption('recently_played')
        await page.waitForTimeout(1500)
        const cards = page.getByTestId('song-card')
        const cardCount = await cards.count()
        test.skip(cardCount === 0, 'no recently-played history')
        const re = /(\d+)(s|m|h|d|mo|y) ago|just now/i
        const html = await page.locator('main').innerText()
        expect(html).toMatch(re)
    })

    // === Tier 2 per-song deep-linking (explore context) ===

    test('explore: player link includes ?window=...&sort=...&song=<uuid>', async ({ page }) => {
        // Navigate to explore with specific window and sort params
        await page.goto('/explore?window=all&sort=plays')
        await page.waitForTimeout(2000)

        const cards = page.getByTestId('song-card')
        if (await cards.count() === 0) {
            test.skip()
        }

        // data-song-id is on the wrapper div around each Song, not on the card.
        const songId = await page.locator('[data-song-id]').first().getAttribute('data-song-id')
        expect(songId).toBeTruthy()

        await cards.first().click()
        const playerBar = page.getByTestId('player-bar')
        await expect(playerBar).toBeVisible({ timeout: 5000 })

        // Scope to the player bar; otherwise `a[href*="explore"]` matches
        // the navbar's plain /explore link first (no song= param).
        const link = playerBar.locator('a[href*="explore"]').first()
        const href = await link.getAttribute('href')
        expect(href).toContain('window=all')
        expect(href).toContain('sort=plays')
        expect(href).toContain(`song=${songId}`)
    })

    // === Tier 2 view filter persistence ===

    test('view filter persists in URL', async ({ page }) => {
        await page.goto(routes.explore)
        await expect(page.locator('main')).toBeVisible({ timeout: 10000 })

        // Click the "you" filter button
        const youBtn = page.getByRole('button', { name: 'you', exact: true })
        await expect(youBtn).toBeVisible({ timeout: 5000 })
        await youBtn.click()
        await page.waitForTimeout(300)

        // Assert URL contains view=you
        await expect(page).toHaveURL(/view=you/, { timeout: 5000 })

        // Verify the "you" button has active class
        await expect(youBtn).toHaveClass(/bg-sky-500|text-sky-500|bg-white/)

        // Reload page
        await page.reload()

        // Verify "you" filter is still active and URL still has view=you
        await expect(page).toHaveURL(/view=you/)
        await expect(youBtn).toHaveClass(/bg-sky-500|text-sky-500|bg-white/)
    })
})
