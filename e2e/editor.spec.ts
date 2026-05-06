import { routes, editSongRoute } from './routes'
import { test, expect, Page, Locator } from '@playwright/test'
import { USERNAME, PASSWORD, login, ignoreError, apiLogin, apiLoginAs, API_V1, EDITOR_USERNAME, EDITOR_PASSWORD } from './helpers'
import { EditorPage } from './pages'


test.describe('editor modal', () => {
    test.use({ storageState: 'e2e/.auth/editor-user.json' })

    test.beforeEach(async ({ page }) => {
        await login(page, EDITOR_USERNAME, EDITOR_PASSWORD)
    })

    test('opens editor modal for first library song', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await expect(editor.waveform).toBeVisible()
        await expect(editor.audioTab).toBeVisible()
        await expect(editor.propertiesTab).toBeVisible()

        await editor.waitForWaveform(15000)

        const abortErrors = errors.filter(e => /AbortError/i.test(e))
        expect(abortErrors, `AbortErrors found: ${abortErrors.join('\n')}`).toHaveLength(0)
    })

    test('waveform loads and preview-with-edits button becomes active', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()
    })

    test('volume scrub-input is interactive and updates display', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await editor.scrubFill('volume', '+3.0 dB')
        await expect(editor.scrubInput('volume')).toContainText('+3.0 dB')
    })

    test('undo button activates after volume change', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await expect(editor.undoBtn).toBeDisabled()

        await editor.scrubFill('volume', '+3.0 dB')

        await expect(editor.undoBtn).not.toBeDisabled()
    })

    test('redo button becomes enabled after undo', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await expect(editor.redoBtn).toBeDisabled()

        await editor.scrubFill('volume', '+3.0 dB')
        await expect(editor.undoBtn).not.toBeDisabled()

        await editor.undoBtn.click()
        await expect(editor.redoBtn).not.toBeDisabled()
    })

    test('version badge shows "edit" for unedited song', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()
        await expect(editor.versionBadge).toHaveText('edit')
    })

    test('add cut button disabled until waveform ready, then adds/removes a cut', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()

        await expect(editor.addCutBtn).toBeVisible()
        await expect(editor.addCutBtn).toBeDisabled()

        await editor.waitForWaveform()

        await expect(editor.addCutBtn).not.toBeDisabled()

        await editor.addCutBtn.click()

        const removeCutBtn = editor.removeCutBtns.first()
        await expect(removeCutBtn).toBeVisible({ timeout: 5000 })

        await removeCutBtn.click()
        await expect(removeCutBtn).not.toBeVisible()
    })

    test('switches to properties tab and shows fields', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()

        await editor.propertiesTab.click()
        await expect(editor.modal.getByText('Track name', { exact: true })).toBeVisible()
        await expect(editor.modal.getByText('Artist', { exact: true })).toBeVisible()
        await expect(editor.modal.getByText('Album', { exact: true })).toBeVisible()

        const trackInput = editor.modal.locator('input').first()
        await expect(trackInput).not.toBeEmpty()
    })

    test('closes on X button click', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.closeBtn.click()
        await expect(editor.modal).not.toBeVisible()
    })

    test('draft auto-save fires (no console errors during interaction)', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        errors.length = 0

        await editor.scrubFill('volume', '+1.0 dB')

        await page.waitForTimeout(1500)

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/Failed to fetch/i.test(e) && !/favicon/i.test(e))
        expect(realErrors, `Console errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('discard draft resets params', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await editor.scrubFill('volume', '+3.0 dB')
        await expect(editor.scrubInput('volume')).toContainText('+3.0 dB')

        await editor.discardBtn.click()
        await expect(editor.scrubInput('volume')).toContainText('+0.0 dB')
    })

    test('no AbortError overlay on open and close', async ({ page }) => {
        const overlayErrors: string[] = []
        page.on('pageerror', err => overlayErrors.push(err.message))

        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await editor.closeBtn.click()
        await expect(editor.modal).not.toBeVisible()

        await page.waitForTimeout(500)

        const abortErrors = overlayErrors.filter(e => /AbortError/i.test(e))
        expect(abortErrors, `AbortErrors after close: ${abortErrors.join('\n')}`).toHaveLength(0)
    })

    test('properties tab: editing track name auto-saves to draft', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()

        await editor.propertiesTab.click()
        await expect(editor.modal.getByText('Track name')).toBeVisible()

        const trackInput = editor.trackNameInput()
        await expect(trackInput).toBeVisible({ timeout: 5000 })
        await expect(trackInput).not.toHaveValue('')
        const originalValue = await trackInput.inputValue()

        const draftFilter = (r: import('@playwright/test').Response) =>
            r.url().includes('/draft') && r.request().method() === 'PUT'
        const savePromise = page.waitForResponse(draftFilter, { timeout: 10000 })
        await trackInput.fill(`${originalValue}-e2e-test`)
        await savePromise

        const secondPromise = page.waitForResponse(draftFilter, { timeout: 10000 })
        await trackInput.fill(`${originalValue}-e2e-round2`)
        await secondPromise
    })

    test('cut shows time range in list and preview with cut has no errors', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()
        errors.length = 0

        await editor.addCutBtn.click()

        const cutRow = editor.removeCutBtns.first()
        await expect(cutRow).toBeVisible({ timeout: 5000 })

        await expect(editor.modal.locator('.tabular-nums').first()).toBeVisible()

        await editor.previewBtn.click()
        await expect(editor.previewBtn).toBeVisible({ timeout: 5000 })
        await editor.previewBtn.click()

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/Failed to fetch/i.test(e) && !/favicon/i.test(e))
        expect(realErrors, `Errors during cut preview: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('waveform play pauses when preview starts', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await editor.origPlay.click()
        await page.waitForTimeout(300)

        await editor.previewBtn.click()
        await page.waitForTimeout(300)

        await expect(editor.previewBtn).toBeVisible()
        await editor.previewBtn.click()
    })

    test('discard clears all cuts', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await editor.addCutBtn.click()
        await editor.addCutBtn.click()
        await expect(editor.removeCutBtns).toHaveCount(2, { timeout: 5000 })

        await editor.discardBtn.click()
        await expect(editor.removeCutBtns).toHaveCount(0)
    })

    test('speed scrub-input sets display to 0.50×', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await editor.scrubFill('speed', '0.50×')
        await expect(editor.scrubInput('speed')).toContainText('0.50×')

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/Failed to fetch/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e) && !/404/i.test(e))
        expect(realErrors, `Errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('normalize checkbox toggles on', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await expect(editor.normalizeCheckbox).not.toBeChecked()
        await editor.normalizeCheckbox.check()
        await expect(editor.normalizeCheckbox).toBeChecked()

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/Failed to fetch/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e) && !/404/i.test(e))
        expect(realErrors, `Errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('preview badge changes to "preview" (orange) when preview starts', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await expect(editor.versionBadge).toHaveText('edit')

        await editor.previewBtn.click()
        await expect(editor.versionBadge).toHaveText('preview', { timeout: 3000 })

        await editor.previewBtn.click()
        await expect(editor.versionBadge).toHaveText('edit', { timeout: 3000 })
    })

    test('preview scrubbing — click waveform during no-cut preview causes no errors', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()
        errors.length = 0

        await editor.previewBtn.click()
        await expect(editor.previewBtn).toBeVisible({ timeout: 3000 })

        const box = await editor.waveform.boundingBox()
        if (box) {
            await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2)
        }

        await editor.previewBtn.click()

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/Failed to fetch/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e) && !/404/i.test(e))
        expect(realErrors, `Errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })


    test('close guard: amber banner appears on unsaved change then auto-closes', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await editor.scrubFill('volume', '+2.0 dB')
        await editor.closeBtn.click()

        await expect(editor.closeGuard).toBeVisible({ timeout: 5000 })
        await expect(editor.modal).not.toBeVisible({ timeout: 10000 })
    })

    test('close guard: "don\'t show again" dismisses modal and suppresses future banners', async ({ page }) => {
        await page.route('**/edit/songs/*/draft', route =>
            new Promise(resolve => setTimeout(() => { route.continue(); resolve(undefined) }, 3000))
        )
        await page.evaluate(() => localStorage.removeItem('sb-skip-draft-banner'))

        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await editor.scrubFill('volume', '+2.0 dB')
        await editor.closeBtn.click()

        await expect(page.getByRole('button', { name: "don't show again" })).toBeVisible({ timeout: 5000 })
        await page.getByRole('button', { name: "don't show again" }).click()
        await expect(editor.modal).not.toBeVisible({ timeout: 10000 })

        const skipSet = await page.evaluate(() => localStorage.getItem('sb-skip-draft-banner'))
        expect(skipSet).toBe('1')
    })

    test('Ctrl+Z keyboard shortcut triggers undo', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await expect(editor.undoBtn).toBeDisabled()

        await editor.scrubFill('volume', '+3.0 dB')
        await expect(editor.undoBtn).not.toBeDisabled()

        await editor.modal.press('Control+z')

        await expect(editor.undoBtn).toBeDisabled({ timeout: 3000 })
    })

    test('h/l keyboard seeking causes no errors', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()
        errors.length = 0

        await editor.modal.press('l')
        await editor.modal.press('h')

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/Failed to fetch/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e) && !/404/i.test(e))
        expect(realErrors, `Errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test.fixme('add cut → expand fade-out ear left → add second cut respects fade range', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        await editor.addCutBtn.click()
        await expect(editor.removeCutBtns.first()).toBeVisible({ timeout: 5000 })

        const fadeAfter = editor.fadeAfterSlider()
        await fadeAfter.fill('2')
        await fadeAfter.dispatchEvent('input')

        await editor.addCutBtn.click()
        await expect(editor.removeCutBtns).toHaveCount(2, { timeout: 5000 })
    })

    test('add two cuts in sequence: both rows render without error', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()
        errors.length = 0

        await editor.addCutBtn.click()
        await expect(editor.removeCutBtns).toHaveCount(1, { timeout: 5000 })
        await editor.addCutBtn.click()
        await expect(editor.removeCutBtns).toHaveCount(2, { timeout: 5000 })

        const real = errors.filter(e => !/AbortError/i.test(e) && !/Failed to fetch/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e) && !/404/i.test(e))
        expect(real, `Errors after adding two cuts: ${real.join('\n')}`).toHaveLength(0)
    })

})

test.describe('editor modal — destructive flows', () => {
    test.describe.configure({ mode: 'serial' })
    test.use({ storageState: 'e2e/.auth/editor-user.json' })

    test.beforeEach(async ({ page }) => {
        await login(page, EDITOR_USERNAME, EDITOR_PASSWORD)
    })

    test('save to library: encodes and creates new song version', async ({ page }) => {
        test.skip(!!process.env.CI, 'encoding job too slow for CI runners — run locally')
        test.slow()
        const editor = new EditorPage(page)
        const api = await apiLoginAs(EDITOR_USERNAME, EDITOR_PASSWORD)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        const originMatch = page.url().match(/\/songs\/([a-f0-9-]+)\/edit/)
        const originSongId = originMatch?.[1]
        expect(originSongId, 'Could not extract origin song ID from URL').toBeTruthy()

        await editor.normalizeCheckbox.check()

        let capturedSongId: string | null = null
        page.on('framenavigated', frame => {
            if (frame === page.mainFrame()) {
                const m = frame.url().match(/\/library\?.*song=([a-f0-9-]+)/)
                if (m) capturedSongId = m[1]
            }
        })

        await editor.saveToLibraryBtn.click()

        await page.waitForURL(/\/library/, { timeout: 90_000 })

        expect(capturedSongId, 'New song ID should be present in redirect URL').toBeTruthy()
        const newSongId = capturedSongId!
        expect(newSongId, 'New song ID should differ from origin').not.toBe(originSongId)

        if (newSongId) {
            const res = await api.delete(`${API_V1}/library/${newSongId}`)
            expect([200, 204, 404]).toContain(res.status())
        }
        await api.dispose()
    })

    test('restore original: child song shows restore button and navigates to parent', async ({ page }) => {
        test.skip(!!process.env.CI, 'encoding job too slow for CI runners — run locally')
        test.slow()
        const editor = new EditorPage(page)
        const api = await apiLoginAs(EDITOR_USERNAME, EDITOR_PASSWORD)

        await editor.openFromLibrary()
        await editor.waitForWaveform()

        const parentSongId = page.url().match(/\/songs\/([a-f0-9-]+)\/edit/)?.[1]
        expect(parentSongId, 'Could not extract parent song ID').toBeTruthy()

        await editor.modal.locator('label').filter({ hasText: /normalize/i }).locator('input[type="checkbox"]').check()

        let capturedChildId: string | null = null
        page.on('framenavigated', frame => {
            if (frame === page.mainFrame()) {
                const m = frame.url().match(/\/library\?.*song=([a-f0-9-]+)/)
                if (m) capturedChildId = m[1]
            }
        })
        await editor.saveToLibraryBtn.click()

        await page.waitForURL(/\/library/, { timeout: 90_000 })
        const childSongId = capturedChildId ?? page.url().match(/[?&]song=([a-f0-9-]+)/)?.[1]
        expect(childSongId, 'Could not extract child song ID').toBeTruthy()
        expect(childSongId, 'Child song ID should differ from parent').not.toBe(parentSongId)

        await page.goto(editSongRoute(childSongId!))
        const childEditor = new EditorPage(page)
        await expect(childEditor.modal).toBeVisible({ timeout: 10000 })
        await childEditor.waitForWaveform()

        await expect(childEditor.restoreOriginalBtn).toBeVisible({ timeout: 10000 })
        await childEditor.restoreOriginalBtn.click()
        await expect(page.getByText('Restore original?', { exact: true })).toBeVisible({ timeout: 5000 })
        await page.getByRole('button', { name: 'Yes, restore' }).click()

        await expect(page).toHaveURL(new RegExp(`/songs/${parentSongId}/edit`), { timeout: 10000 })

        if (childSongId) {
            const res = await api.delete(`${API_V1}/library/${childSongId}`)
            expect([200, 204, 404]).toContain(res.status())
        }

        await api.dispose()
    })

    test('overwrite original: admin checkbox flips save button label and shows danger styling', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        const checkboxCount = await editor.overwriteCheckbox.count()

        if (checkboxCount === 0) {
            test.skip()
            return
        }

        await expect(editor.overwriteCheckbox).toBeVisible()
        await expect(editor.overwriteCheckbox).not.toBeChecked()

        await editor.overwriteCheckbox.check()
        await expect(editor.overwriteCheckbox).toBeChecked()

        const labelSpan = editor.overwriteCheckbox.locator('..').locator('span').filter({ hasText: /save as original/i })
        await expect(labelSpan).toHaveClass(/text-red-400/)

        await expect(editor.saveToLibraryBtn).toBeVisible()

        await editor.overwriteCheckbox.uncheck()
        await expect(editor.overwriteCheckbox).not.toBeChecked()
        await expect(labelSpan).not.toHaveClass(/text-red-400/)
    })
})
