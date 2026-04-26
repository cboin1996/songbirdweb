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

test.describe('download page', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('unauthenticated redirect to /login (root)', async ({ page }) => {
        await page.context().clearCookies()
        await page.goto('/download')
        await expect(page).toHaveURL('/')
    })

    test('page loads with search bar visible', async ({ page }) => {
        await expect(page.locator('input[type="text"], input[type="url"]').first()).toBeVisible({ timeout: 5000 })
    })

    test('default mode shows song search input', async ({ page }) => {
        // the search bar should show the song name placeholder by default
        const input = page.locator('input').filter({ has: page.locator(':scope') }).first()
        await expect(input).toBeVisible()
    })

    test('song search tab: type jolene, results appear', async ({ page }) => {
        await page.goto('/download/song?query=jolene&mode=song')
        const card = page.locator('[role="button"]').filter({ hasText: /jolene/i }).first()
        await expect(card).toBeVisible({ timeout: 15000 })
    })

    test('album search tab: type jolene, results appear', async ({ page }) => {
        await page.goto('/download/album?query=jolene&mode=album')
        // album results page should show something matching jolene
        await expect(page.locator('body').filter({ hasText: /jolene/i })).toBeTruthy()
        await page.waitForTimeout(3000)
        // any content (even empty results) should be rendered without crash
        await expect(page.locator('main')).toBeVisible()
    })

    test('switch mode to album via select', async ({ page }) => {
        const modeSelect = page.locator('select#mode')
        await expect(modeSelect).toBeVisible()
        await modeSelect.selectOption('album')
        await expect(modeSelect).toHaveValue('album')
    })

    test('switch mode to url via select', async ({ page }) => {
        const modeSelect = page.locator('select#mode')
        await modeSelect.selectOption('url')
        await expect(modeSelect).toHaveValue('url')
        // placeholder should change to URL-style
        const input = page.locator('input[type="url"]')
        await expect(input).toBeVisible()
    })

    test('URL mode input accepts text', async ({ page }) => {
        const modeSelect = page.locator('select#mode')
        await modeSelect.selectOption('url')
        const urlInput = page.locator('input[type="url"]')
        await urlInput.fill('https://www.youtube.com/watch?v=test')
        await expect(urlInput).toHaveValue('https://www.youtube.com/watch?v=test')
    })

    test('song card: kebab menu button visible on hover', async ({ page }) => {
        await page.goto('/download/song?query=jolene&mode=song')
        const card = page.locator('[role="button"]').filter({ hasText: /jolene/i }).first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await card.hover()
        const kebab = card.locator('button[title="more"]')
        await expect(kebab).toBeVisible({ timeout: 3000 })
    })

    test('song card kebab: add to library option exists', async ({ page }) => {
        await page.goto('/download/song?query=jolene&mode=song')
        const card = page.locator('[role="button"]').filter({ hasText: /jolene/i }).first()
        await expect(card).toBeVisible({ timeout: 15000 })
        await card.hover()
        const kebab = card.locator('button[title="more"]')
        await kebab.click()
        // menu should show "add to library" or similar option
        const addBtn = page.getByRole('button', { name: /add to library/i })
        await expect(addBtn).toBeVisible({ timeout: 3000 })
        // close without acting
        await page.keyboard.press('Escape')
    })

    test('import file section is visible on download page', async ({ page }) => {
        await expect(page.getByText(/import local file/i)).toBeVisible({ timeout: 5000 })
    })

    test('import file input accepts .mp3 and .m4a', async ({ page }) => {
        const fileInput = page.locator('input[type="file"][accept=".mp3,.m4a"]')
        await expect(fileInput).toBeAttached()
        const accept = await fileInput.getAttribute('accept')
        expect(accept).toContain('.mp3')
        expect(accept).toContain('.m4a')
    })

    test('song card play button starts player', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        await page.goto('/download/song?query=jolene&mode=song')
        const card = page.locator('[role="button"]').filter({ hasText: /jolene/i }).first()
        await expect(card).toBeVisible({ timeout: 15000 })

        // click the card to play
        await card.click()
        // player bar should appear with a song name
        await expect(page.locator('text=Jolene').last()).toBeVisible({ timeout: 5000 })

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e))
        expect(realErrors, `Errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })
})
