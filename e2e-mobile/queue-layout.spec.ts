import { test, expect } from '@playwright/test'
import { login } from '../e2e/helpers'
import { BENCH_USER, BENCH_PASS } from '../e2e/seed-bench'
import { LibraryPage, PlayerBar } from '../e2e/pages'
import { skipWithoutBench } from '../e2e/bench-gate'

// The queue panel at phone width: the search field has room around it, rows
// stay inside the panel, and nothing scrolls sideways. A long queue (the bench
// user's 1000 songs) so the search field shows and rows are long-named.
skipWithoutBench()
test.use({ storageState: { cookies: [], origins: [] } })

test('queue panel fits the phone screen', async ({ page }) => {
    await login(page, BENCH_USER, BENCH_PASS)
    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    await lib.goto()
    await lib.waitForSongs()
    await lib.playAllBtn.click()
    await player.waitForBar()
    await player.openQueue()

    const search = page.getByTestId('queue-search')
    await expect(search).toBeVisible()
    const viewport = page.viewportSize()!

    // No sideways scroll: neither the page nor the queue list.
    const overflow = await page.evaluate(() => {
        const list = document.querySelector('[data-testid="queue-scroll"]')!
        return {
            page: document.documentElement.scrollWidth - window.innerWidth,
            list: list.scrollWidth - list.clientWidth,
        }
    })
    expect(overflow.page).toBeLessThanOrEqual(0)
    expect(overflow.list).toBeLessThanOrEqual(0)

    // Every visible row ends inside the screen.
    const rowEdges = await page.locator('[data-dpos]').evaluateAll(rows => rows.map(r => r.getBoundingClientRect().right))
    expect(rowEdges.length).toBeGreaterThan(0)
    for (const right of rowEdges) expect(right).toBeLessThanOrEqual(viewport.width)

    // The field is inset from the panel edge on both sides (room for its focus ring).
    const box = (await search.boundingBox())!
    const panel = (await search.evaluate(el => {
        const wrap = el.closest('.shrink-0')!.getBoundingClientRect()
        return { left: wrap.left, right: wrap.right }
    }))
    expect(box.x - panel.left).toBeGreaterThanOrEqual(4)
    expect(panel.right - (box.x + box.width)).toBeGreaterThanOrEqual(4)
})
