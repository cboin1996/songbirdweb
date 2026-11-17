import { test, expect } from '@playwright/test'
import { login } from '../e2e/helpers'
import { LibraryPage, PlayerBar } from '../e2e/pages'

// At phone width the drag handle and the remove button do not touch the row's edge.
const MIN_INSET = 8

test('queue rows keep the drag handle and remove button inset from the row edge', async ({ page }) => {
    await login(page)
    const lib = new LibraryPage(page)
    const player = new PlayerBar(page)
    await lib.goto()
    await lib.waitForSongs()
    await lib.playAllBtn.click()
    await player.waitForBar()
    await player.openQueue()

    const row = page.locator('[data-dpos]').first()
    await expect(row).toBeVisible()
    const rowBox = (await row.boundingBox())!
    const handle = (await row.locator('svg').first().boundingBox())!
    const remove = (await row.locator('button').last().locator('svg').boundingBox())!
    expect(handle.x - rowBox.x).toBeGreaterThanOrEqual(MIN_INSET)
    expect(rowBox.x + rowBox.width - (remove.x + remove.width)).toBeGreaterThanOrEqual(MIN_INSET)
})
