import { test, expect } from '../e2e/fixtures/test'
import { login } from '../e2e/helpers'
import { LibraryPage } from '../e2e/pages'

test('a tap on the kebab opens the menu, it stays open, and its first item is under the finger', async ({ page }) => {
  await login(page)
  const lib = new LibraryPage(page)
  await page.goto('/library')
  await lib.waitForSongs()
  const kebab = page.getByTestId('song-kebab').first()
  await kebab.tap()
  const menu = page.getByTestId('song-kebab-menu')
  await expect(menu).toBeVisible()
  await page.waitForTimeout(1500)
  await expect(menu).toBeVisible()
  const k = (await kebab.boundingBox())!
  const m = (await menu.boundingBox())!
  // The menu sits just under the button, not somewhere else on the screen.
  expect(Math.abs(m.y - (k.y + k.height))).toBeLessThan(24)
  const item = menu.getByRole('button').first()
  const ib = (await item.boundingBox())!
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? null, [ib.x + ib.width / 2, ib.y + ib.height / 2])
  expect(hit).toBe(await item.textContent())
})
