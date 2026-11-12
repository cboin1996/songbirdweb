import { routes } from './routes'
import { test, expect } from './fixtures/test'

const navFilter = (page: import('@playwright/test').Page) =>
    page.locator('nav').first().evaluate(el => getComputedStyle(el).backdropFilter)

test.describe('frosted bars', () => {
    test('the toggle switches blur and solid, and the choice survives a reload', async ({ page }) => {
        await page.goto(routes.settings)
        await expect(page.getByTestId('this-device')).toBeVisible()
        await page.getByTestId('frosted-switch').click()
        await expect(page.getByTestId('frosted-switch')).toHaveAttribute('aria-checked', 'false')
        await expect.poll(() => navFilter(page)).toBe('none')
        await page.reload()
        await expect(page.getByTestId('frosted-switch')).toHaveAttribute('aria-checked', 'false')
        expect(await navFilter(page)).toBe('none')
        await page.getByTestId('frosted-switch').click()
        await expect.poll(() => navFilter(page)).toContain('blur')
        await page.reload()
        await expect(page.getByTestId('frosted-switch')).toHaveAttribute('aria-checked', 'true')
        expect(await navFilter(page)).toContain('blur')
    })

    test('a system asking for less transparency starts with the bars solid', async ({ page }) => {
        await page.addInitScript(() => {
            const real = window.matchMedia.bind(window)
            window.matchMedia = ((q: string) => q.includes('prefers-reduced-transparency')
                ? ({ ...real('all'), matches: true, media: q }) as MediaQueryList
                : real(q)) as typeof window.matchMedia
        })
        await page.goto(routes.settings)
        await expect(page.getByTestId('frosted-switch')).toHaveAttribute('aria-checked', 'false')
        expect(await navFilter(page)).toBe('none')
    })

    test('only the marked bars go solid; other blurred pieces keep their look', async ({ page }) => {
        await page.goto(routes.library)
        await page.evaluate(() => localStorage.setItem('songbird-frosted-bars', 'off'))
        await page.reload()
        await expect(page.locator('nav').first()).toBeVisible()
        const filters = await page.evaluate(() => ({
            marked: [...document.querySelectorAll('.frosted-bar')].map(el => getComputedStyle(el).backdropFilter),
            others: [...document.querySelectorAll('[class*="backdrop-blur-md"]:not(.frosted-bar)')].map(el => getComputedStyle(el).backdropFilter),
        }))
        expect(filters.marked.length).toBeGreaterThan(0)
        expect(filters.marked.every(f => f === 'none')).toBe(true)
        expect(filters.others.every(f => f !== 'none')).toBe(true)
    })
})
