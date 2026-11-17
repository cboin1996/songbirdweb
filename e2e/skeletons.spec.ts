import { routes, downloadSongQuery, downloadAlbumQuery } from './routes'
import { test, expect } from './fixtures/test'
import { login } from './helpers'
import { LibraryPage } from './pages'

// On a slow network a list shows skeleton rows, then content, then the empty or the
// error state: never a blank page and never a skeleton that stays.
// Each test holds the list's request, checks the skeleton, then lets the answer go.
type Route = import('@playwright/test').Route

function hold(page: import('@playwright/test').Page, pattern: string | RegExp) {
    const held: Route[] = []
    let answerWith: ((route: Route) => Promise<void>) | null = null
    // Until answered, requests wait; after that, every request (a retry too) gets the same answer.
    void page.route(pattern, route => answerWith ? answerWith(route) : void held.push(route))
    return {
        // Resolves once the page has asked and the answer is being held.
        waitHeld: () => expect.poll(() => held.length).toBeGreaterThan(0),
        async answer(fn: (route: Route) => Promise<void>) {
            answerWith = fn
            for (const r of held) await fn(r)
        },
    }
}

test.describe('loading skeletons', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('library shows skeleton rows, then the songs', async ({ page }) => {
        const lib = new LibraryPage(page)
        // The library may be answered from the device's copy first; hold the network request.
        const h = hold(page, '**/v1/songs/library')
        await page.goto(routes.library)
        await h.waitHeld()
        await expect(page.getByTestId('library-skeleton')).toBeVisible()
        await h.answer(r => r.continue())
        await lib.waitForSongs()
        await expect(page.getByTestId('library-skeleton')).toHaveCount(0)
    })

    test('a skeleton waits 200 ms before it fades in, so a fast load never flashes one', async ({ page }) => {
        const h = hold(page, '**/v1/songs/library')
        await page.goto(routes.library)
        await h.waitHeld()
        const root = page.getByTestId('library-skeleton').locator('> *').first()
        await expect(root).toHaveCSS('animation-delay', '0.2s')
        await expect(root).toHaveCSS('animation-name', 'skeleton-in')
        // Held for a while, it does show.
        await expect(root).toHaveCSS('opacity', '1', { timeout: 3000 })
        await h.answer(r => r.continue())
    })

    test('library skeleton gives way to the error state', async ({ page }) => {
        const h = hold(page, '**/v1/songs/library')
        await page.goto(routes.library)
        await h.waitHeld()
        await expect(page.getByTestId('library-skeleton')).toBeVisible()
        await h.answer(r => r.fulfill({ status: 500, body: 'boom' }))
        await expect(page.getByTestId('library-skeleton')).toHaveCount(0, { timeout: 15000 })
        await expect(page.getByTestId('query-error-your-library').first()).toBeVisible({ timeout: 15000 })
    })

    test('explore shows skeletons, then its content', async ({ page }) => {
        const h = hold(page, '**/v1/songs/explore*')
        await page.goto(routes.explore)
        await h.waitHeld()
        await expect(page.getByTestId('explore-skeleton')).toBeVisible()
        await h.answer(r => r.continue())
        await expect(page.getByTestId('explore-skeleton')).toHaveCount(0, { timeout: 15000 })
    })

    test('explore skeleton gives way to the error state', async ({ page }) => {
        const h = hold(page, '**/v1/songs/explore*')
        await page.goto(routes.explore)
        await h.waitHeld()
        await expect(page.getByTestId('explore-skeleton')).toBeVisible()
        await h.answer(r => r.fulfill({ status: 500, body: 'boom' }))
        await expect(page.getByTestId('explore-skeleton')).toHaveCount(0, { timeout: 15000 })
        await expect(page.getByTestId('query-error-explore').first()).toBeVisible({ timeout: 15000 })
    })

    for (const [name, url, pattern] of [
        ['song', downloadSongQuery('daft punk'), '**/v1/properties/itunes*'],
        ['album', downloadAlbumQuery('daft punk'), '**/v1/properties/itunes*'],
    ] as const) {
        test(`download ${name} results show skeleton rows, then the empty state`, async ({ page }) => {
            const h = hold(page, pattern)
            await page.goto(url)
            await h.waitHeld()
            await expect(page.getByTestId('download-skeleton')).toBeVisible()
            // The API answers a list of properties; none is the empty state.
            await h.answer(r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
            await expect(page.getByTestId('download-skeleton')).toHaveCount(0, { timeout: 15000 })
            if (name === 'song') await expect(page.getByText('no iTunes matches')).toBeVisible()
        })

        test(`download ${name} skeleton gives way to the error state`, async ({ page }) => {
            const h = hold(page, pattern)
            await page.goto(url)
            await h.waitHeld()
            await expect(page.getByTestId('download-skeleton')).toBeVisible()
            await h.answer(r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"boom"}' }))
            await expect(page.getByTestId('download-skeleton')).toHaveCount(0, { timeout: 15000 })
            await expect(page.getByTestId('query-error-search-results').first()).toBeVisible({ timeout: 15000 })
        })
    }
})
