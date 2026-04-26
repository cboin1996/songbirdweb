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

async function openEditorForEditMe(page: Page) {
    await page.goto('/library')
    const songCard = page.locator('[role="button"]').filter({ hasText: /edit-me/i }).first()
    await expect(songCard).toBeVisible({ timeout: 10000 })

    await songCard.hover()
    const kebabBtn = songCard.locator('button[title="more"]')
    await kebabBtn.click()

    await page.getByRole('button', { name: 'Edit', exact: true }).click()

    const modal = page.getByTestId('editor-modal')
    await expect(modal).toBeVisible()
    return modal
}

async function openEditorForJolene(page: Page) {
    await page.goto('/download/song?query=jolene&mode=song')
    // wait for song results
    const songCard = page.locator('[role="button"]').filter({ hasText: /jolene/i }).first()
    await expect(songCard).toBeVisible({ timeout: 10000 })

    // open kebab
    await songCard.hover()
    const kebabBtn = songCard.locator('button[title="more"]')
    await kebabBtn.click()

    // click Edit
    await page.getByRole('button', { name: 'Edit' }).click()

    // modal opens
    const modal = page.getByTestId('editor-modal')
    await expect(modal).toBeVisible()
    return modal
}

test.describe('editor modal', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('opens editor modal for Jolene', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorForJolene(page)
        await expect(modal.getByTestId('waveform')).toBeVisible()
        await expect(modal.getByRole('button', { name: 'audio' })).toBeVisible()
        await expect(modal.getByRole('button', { name: 'properties' })).toBeVisible()

        // give waveform time to load
        await page.waitForTimeout(3000)

        const abortErrors = errors.filter(e => /AbortError/i.test(e))
        expect(abortErrors, `AbortErrors found: ${abortErrors.join('\n')}`).toHaveLength(0)
    })

    test('waveform loads and play button becomes active', async ({ page }) => {
        const modal = await openEditorForJolene(page)

        // loop button is disabled until wsReady — use it as the waveform-ready signal
        await expect(modal.locator('button[title="loop trim region"]')).not.toBeDisabled({ timeout: 30000 })
    })

    test('sliders are interactive', async ({ page }) => {
        const modal = await openEditorForJolene(page)

        // wait for waveform ready (play button enabled)
        await expect(modal.locator('button[title="loop trim region"]')).not.toBeDisabled({ timeout: 30000 })

        const volumeSlider = modal.getByRole('slider', { name: 'Volume' })
        await expect(volumeSlider).toBeVisible()

        // drag volume down
        await volumeSlider.fill('0.5')
        await volumeSlider.dispatchEvent('input')

        // confirm the display updated (shows ~50%)
        await expect(modal.getByText(/50%/)).toBeVisible()
    })

    test('undo button activates after slider change', async ({ page }) => {
        const modal = await openEditorForJolene(page)
        await expect(modal.locator('button[title="loop trim region"]')).not.toBeDisabled({ timeout: 30000 })

        const undoBtn = modal.locator('button[title="undo (Ctrl+Z)"]')
        await expect(undoBtn).toBeDisabled()

        const volumeSlider = modal.getByRole('slider', { name: 'Volume' })
        await volumeSlider.fill('1.5')
        await volumeSlider.click()

        await expect(undoBtn).not.toBeDisabled()
    })

    test('redo button becomes enabled after undo', async ({ page }) => {
        const modal = await openEditorForJolene(page)
        await expect(modal.locator('button[title="loop trim region"]')).not.toBeDisabled({ timeout: 30000 })

        const undoBtn = modal.locator('button[title="undo (Ctrl+Z)"]')
        const redoBtn = modal.locator('button[title="redo (Ctrl+Shift+Z)"]')

        // redo starts disabled
        await expect(redoBtn).toBeDisabled()

        // make a change so undo becomes available
        const volumeSlider = modal.getByRole('slider', { name: 'Volume' })
        await volumeSlider.fill('1.5')
        await volumeSlider.click()
        await expect(undoBtn).not.toBeDisabled()

        // undo the change — redo should become enabled
        await undoBtn.click()
        await expect(redoBtn).not.toBeDisabled()
    })

    test('version badge shows "original" for Jolene', async ({ page }) => {
        const modal = await openEditorForJolene(page)
        await expect(modal.locator('button[title="loop trim region"]')).not.toBeDisabled({ timeout: 30000 })

        // Jolene has no edits so badge should read "original"
        await expect(modal.getByTestId('version-badge')).toHaveText('original')
    })

    test('add cut button disabled until waveform ready, then adds/removes a cut', async ({ page }) => {
        const modal = await openEditorForJolene(page)

        const addCutBtn = modal.getByRole('button', { name: '+ add cut' })
        await expect(addCutBtn).toBeVisible()

        // disabled before wsReady
        await expect(addCutBtn).toBeDisabled()

        // wait for waveform ready
        await expect(modal.locator('button[title="loop trim region"]')).not.toBeDisabled({ timeout: 30000 })

        // now enabled
        await expect(addCutBtn).not.toBeDisabled()

        // click to add a cut
        await addCutBtn.click()

        // a cut row with an X button should appear
        const removeCutBtn = modal.locator('button[title="remove cut"]').first()
        await expect(removeCutBtn).toBeVisible({ timeout: 5000 })

        // remove the cut
        await removeCutBtn.click()
        await expect(removeCutBtn).not.toBeVisible()
    })

    test('switches to properties tab and shows fields', async ({ page }) => {
        const modal = await openEditorForJolene(page)

        await modal.getByRole('button', { name: 'properties' }).click()
        await expect(modal.getByText('Track name')).toBeVisible()
        await expect(modal.getByText('Artist')).toBeVisible()
        await expect(modal.getByText('Album')).toBeVisible()

        // track name input should be pre-filled with Jolene
        const trackInput = modal.locator('input').first()
        await expect(trackInput).toHaveValue(/jolene/i)
    })

    test('closes on X button click', async ({ page }) => {
        const modal = await openEditorForJolene(page)
        await modal.getByTestId('editor-close').click()
        await expect(modal).not.toBeVisible()
    })

    test('draft auto-save fires (no console errors during interaction)', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorForJolene(page)
        await expect(modal.locator('button[title="loop trim region"]')).not.toBeDisabled({ timeout: 30000 })

        // clear init-time errors (draft 404 on open is expected)
        errors.length = 0

        // change volume to trigger draft save
        const volumeSlider = modal.getByRole('slider', { name: 'Volume' })
        await volumeSlider.fill('1.2')
        await volumeSlider.dispatchEvent('input')

        // wait for debounced draft save (1s)
        await page.waitForTimeout(1500)

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/favicon/i.test(e))
        expect(realErrors, `Console errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('discard draft resets params', async ({ page }) => {
        const modal = await openEditorForJolene(page)
        await expect(modal.locator('button[title="loop trim region"]')).not.toBeDisabled({ timeout: 30000 })

        const volumeSlider = modal.getByRole('slider', { name: 'Volume' })
        await volumeSlider.fill('1.8')
        await volumeSlider.dispatchEvent('input')
        await expect(modal.getByText(/180%/)).toBeVisible()

        await modal.getByRole('button', { name: /discard/i }).click()
        await expect(modal.getByText(/100%/)).toBeVisible()
    })

    test('fade in slider works without errors', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorForJolene(page)
        await expect(modal.locator('button[title="loop trim region"]')).not.toBeDisabled({ timeout: 30000 })
        errors.length = 0

        const fadeInSlider = modal.getByRole('slider', { name: 'Fade in' })
        await fadeInSlider.fill('3')
        await fadeInSlider.dispatchEvent('input')
        await page.waitForTimeout(200)

        const realErrors = errors.filter(e => !/favicon/i.test(e))
        expect(realErrors, `Errors after fade in: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('fade out slider works without errors', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorForJolene(page)
        await expect(modal.locator('button[title="loop trim region"]')).not.toBeDisabled({ timeout: 30000 })
        errors.length = 0

        const fadeOutSlider = modal.getByRole('slider', { name: 'Fade out' })
        await fadeOutSlider.fill('3')
        await fadeOutSlider.dispatchEvent('input')
        await page.waitForTimeout(200)

        const realErrors = errors.filter(e => !/favicon/i.test(e))
        expect(realErrors, `Errors after fade out: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('preview with fade in and fade out plays without errors', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorForJolene(page)
        await expect(modal.locator('button[title="loop trim region"]')).not.toBeDisabled({ timeout: 30000 })
        errors.length = 0

        // set fade in + fade out
        const fadeInSlider = modal.getByRole('slider', { name: 'Fade in' })
        const fadeOutSlider = modal.getByRole('slider', { name: 'Fade out' })
        await fadeInSlider.fill('3')
        await fadeInSlider.dispatchEvent('input')
        await fadeOutSlider.fill('3')
        await fadeOutSlider.dispatchEvent('input')

        // click Preview
        const previewBtn = modal.getByRole('button', { name: 'Preview' })
        await previewBtn.click()
        await page.waitForTimeout(500)

        // stop preview
        await modal.getByRole('button', { name: 'Stop preview' }).click()

        const realErrors = errors.filter(e => !/favicon/i.test(e))
        expect(realErrors, `Errors during fade preview: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('no AbortError overlay on open and close', async ({ page }) => {
        const overlayErrors: string[] = []
        page.on('pageerror', err => overlayErrors.push(err.message))

        const modal = await openEditorForJolene(page)
        await page.waitForTimeout(1000)

        // close modal (triggers WaveSurfer destroy)
        await modal.getByTestId('editor-close').click()
        await expect(modal).not.toBeVisible()

        // wait for async AbortError to surface (if any)
        await page.waitForTimeout(1000)

        const abortErrors = overlayErrors.filter(e => /AbortError/i.test(e))
        expect(abortErrors, `AbortErrors after close: ${abortErrors.join('\n')}`).toHaveLength(0)
    })

    test('properties tab: saves and reverts track name on edit-me', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorForEditMe(page)

        // switch to properties tab
        await modal.getByRole('button', { name: 'properties' }).click()
        await expect(modal.getByText('Track name')).toBeVisible()

        // track name field pre-filled with "edit-me"
        const trackInput = modal.locator('input').first()
        await expect(trackInput).toHaveValue(/edit-me/i)

        // change it temporarily
        const originalValue = await trackInput.inputValue()
        await trackInput.fill('edit-me-test')

        // save — use JS click to bypass player bar overlay
        const saveBtn = modal.getByRole('button', { name: 'Save' })
        const propFilter = (r: import('@playwright/test').Response) =>
            r.url().includes('/properties') && r.request().method() === 'PUT' && r.status() < 300
        const [saveRes] = await Promise.all([
            page.waitForResponse(propFilter, { timeout: 8000 }),
            saveBtn.evaluate((el: HTMLElement) => el.click()),
        ])
        expect(saveRes.ok(), `PUT /properties returned ${saveRes.status()}`).toBe(true)
        await expect(modal.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 3000 })

        // revert to original name
        await trackInput.fill(originalValue)
        const [revertRes] = await Promise.all([
            page.waitForResponse(propFilter, { timeout: 8000 }),
            saveBtn.evaluate((el: HTMLElement) => el.click()),
        ])
        expect(revertRes.ok(), `Revert PUT /properties returned ${revertRes.status()}`).toBe(true)
        await expect(modal.getByRole('button', { name: /saved/i })).toBeVisible({ timeout: 3000 })

        // 401s from background resource loads (artwork/audio served from API) are expected
        const realErrors = errors.filter(e =>
            !/AbortError/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e)
        )
        expect(realErrors, `Console errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('zoom slider is visible and interactive', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorForJolene(page)
        await expect(modal.locator('button[title="loop trim region"]')).not.toBeDisabled({ timeout: 30000 })

        const zoomSlider = modal.getByRole('slider', { name: 'zoom' })
        await expect(zoomSlider).toBeVisible()

        // zoom in
        await zoomSlider.fill('200')
        await zoomSlider.dispatchEvent('input')
        await page.waitForTimeout(200)

        // zoom back out
        await zoomSlider.fill('0')
        await zoomSlider.dispatchEvent('input')
        await page.waitForTimeout(200)

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/favicon/i.test(e))
        expect(realErrors, `Errors during zoom: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('cut shows time range in list and preview with cut has no errors', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorForJolene(page)
        await expect(modal.locator('button[title="loop trim region"]')).not.toBeDisabled({ timeout: 30000 })
        errors.length = 0

        // add a cut
        await modal.getByRole('button', { name: '+ add cut' }).click()

        // a cut row should appear showing a time range (e.g. "0:00 – 0:02")
        const cutRow = modal.locator('button[title="remove cut"]').first()
        await expect(cutRow).toBeVisible({ timeout: 5000 })

        // the cut list should display a formatted time range
        await expect(modal.locator('.tabular-nums').first()).toBeVisible()

        // preview with the cut active — should play without errors
        const previewBtn = modal.getByRole('button', { name: 'Preview' })
        await previewBtn.click()
        await page.waitForTimeout(800)
        await modal.getByRole('button', { name: 'Stop preview' }).click()

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/favicon/i.test(e))
        expect(realErrors, `Errors during cut preview: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('waveform play pauses when preview starts', async ({ page }) => {
        const modal = await openEditorForJolene(page)
        await expect(modal.locator('button[title="loop trim region"]')).not.toBeDisabled({ timeout: 30000 })

        // start waveform playback
        await modal.locator('button[title="play"]').click()
        await page.waitForTimeout(300)

        // click preview — waveform should stop, preview starts
        await modal.getByRole('button', { name: 'Preview' }).click()
        await page.waitForTimeout(300)

        // stop preview button visible means preview is playing (waveform paused it)
        await expect(modal.getByRole('button', { name: 'Stop preview' })).toBeVisible()
        await modal.getByRole('button', { name: 'Stop preview' }).click()
    })

    test('discard clears all cuts', async ({ page }) => {
        const modal = await openEditorForJolene(page)
        await expect(modal.locator('button[title="loop trim region"]')).not.toBeDisabled({ timeout: 30000 })

        // add two cuts
        await modal.getByRole('button', { name: '+ add cut' }).click()
        await modal.getByRole('button', { name: '+ add cut' }).click()
        await expect(modal.locator('button[title="remove cut"]')).toHaveCount(2, { timeout: 5000 })

        // discard resets everything
        await modal.getByRole('button', { name: /discard/i }).click()
        await expect(modal.locator('button[title="remove cut"]')).toHaveCount(0)
    })
})
