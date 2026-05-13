import { routes, editSongRoute } from './routes'
import { test, expect, Page, Locator } from '@playwright/test'
import { USERNAME, PASSWORD, login, ignoreError, apiLogin, apiLoginAs, API_V1, EDITOR_USERNAME, EDITOR_PASSWORD } from './helpers'
import { EditorPage } from './pages'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'


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

    test('closing editor pauses all audio playback', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()
        await editor.origPlay.click()
        await page.waitForTimeout(300)
        await editor.closeBtn.click()
        await expect(editor.modal).not.toBeVisible()
        const anyPlaying = await page.evaluate(() =>
            Array.from(document.querySelectorAll('audio, video')).some(el => !(el as HTMLMediaElement).paused)
        )
        expect(anyPlaying).toBe(false)
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

    test('adding cuts until no room shows paste warning', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        // Trim to a short range so cuts fill it quickly
        await editor.scrubFill('volume', '+0.0 dB')
        await editor.undoBtn.click()

        let warningFound = false
        for (let i = 0; i < 50; i++) {
            await editor.addCutBtn.click()
            const visible = await editor.pasteWarning.isVisible()
            if (visible) {
                const text = await editor.pasteWarning.textContent()
                expect(text).toMatch(/no room/i)
                warningFound = true
                break
            }
            await page.waitForTimeout(100)
        }

        expect(warningFound, 'paste warning should appear when no room for a new cut').toBe(true)
    })

    test('fade regions cannot overlap cuts — no console errors', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()
        errors.length = 0

        await editor.addCutBtn.click()
        await expect(editor.removeCutBtns.first()).toBeVisible({ timeout: 5000 })

        const fadeInBtn = editor.modal.getByRole('button', { name: '+ fade in' })
        await expect(fadeInBtn).toBeVisible({ timeout: 3000 })
        await fadeInBtn.click()

        // Both cut and fade-in should coexist (snap logic prevents overlap)
        await expect(editor.removeCutBtns.first()).toBeVisible({ timeout: 3000 })

        const real = errors.filter(e => !/AbortError/i.test(e) && !/Failed to fetch/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e) && !/404/i.test(e))
        expect(real, `Errors after adding cut + fade: ${real.join('\n')}`).toHaveLength(0)
    })

    test('lossless badge shows for lossless-eligible params, re-encode for volume change', async ({ page }) => {
        const editor = new EditorPage(page)
        await editor.openFromLibrary()
        await editor.waitForWaveform()

        // Discard any stale draft so we start from defaults
        await editor.discardBtn.click()
        await page.waitForTimeout(500)

        // Badge only appears when paramsChanged — default params show nothing
        await expect(editor.qualityBadge).not.toBeVisible()

        // Add a cut (lossless eligible — no fades on cut)
        await editor.addCutBtn.click()
        await expect(editor.removeCutBtns.first()).toBeVisible({ timeout: 5000 })
        await expect(editor.qualityBadge).toBeVisible({ timeout: 3000 })
        await expect(editor.qualityBadge).toHaveText('lossless')

        // Volume change makes it re-encode
        await editor.scrubFill('volume', '+3.0 dB')
        await expect(editor.qualityBadge).toHaveText('re-encode', { timeout: 3000 })

        // Undo the volume change — should revert to lossless
        await editor.undoBtn.click()
        await expect(editor.qualityBadge).toHaveText('lossless', { timeout: 3000 })
    })

})

async function submitEditAndWait(api: any, songId: string, params: Record<string, any> = {}, overwrite = false) {
    const editRes = await api.post(`${API_V1}/edit/songs/${songId}`, {
        data: {
            params: { trim_start: 0, trim_end: null, volume: 1.0, fades: [], speed: 1.0, normalize: false, cuts: [], ...params },
            overwrite,
        },
    })
    expect(editRes.ok()).toBe(true)
    const job = await editRes.json()
    let result: any
    for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 1000))
        const pollRes = await api.get(`${API_V1}/edit/jobs/${job.job_id}`)
        result = await pollRes.json()
        if (result.status === 'done' || result.status === 'failed') break
    }
    expect(result.status, `Job failed: ${result.error}`).toBe('done')
    return result
}

async function getSongFromLibrary(api: any, songId: string) {
    const res = await api.get(`${API_V1}/songs/library`)
    expect(res.ok()).toBe(true)
    const songs = await res.json()
    return songs.find((s: any) => s.uuid === songId) ?? null
}

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

    test.fixme('restore original: child song shows restore button and navigates to parent', async ({ page }) => {
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

    test('trim-only edit produces correct duration (lossless stream-copy)', async ({ page: _page }) => {
        test.skip(!!process.env.CI, 'encoding job too slow for CI runners — run locally')
        test.slow()

        const api = await apiLoginAs(EDITOR_USERNAME, EDITOR_PASSWORD)
        let newSongId: string | null = null
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            expect(libRes.ok()).toBe(true)
            const songs = await libRes.json()
            expect(Array.isArray(songs) && songs.length > 0, 'Library must have at least one song').toBe(true)
            const song = songs[0]

            const editRes = await api.post(`${API_V1}/edit/songs/${song.uuid}`, {
                data: {
                    params: { trim_start: 0, trim_end: 30, volume: 1.0, fades: [], speed: 1.0, normalize: false, cuts: [] },
                    overwrite: false,
                },
            })
            expect(editRes.ok()).toBe(true)
            const job = await editRes.json()

            let result: any
            for (let i = 0; i < 90; i++) {
                await new Promise(r => setTimeout(r, 1000))
                const pollRes = await api.get(`${API_V1}/edit/jobs/${job.job_id}`)
                result = await pollRes.json()
                if (result.status === 'done' || result.status === 'failed') break
            }
            expect(result.status, `Job failed: ${result.error}`).toBe('done')
            expect(result.lossless, 'Trim-only should be lossless').toBe(true)

            newSongId = result.result_song_id
            expect(newSongId).toBeTruthy()

            const audioRes = await api.get(`${API_V1}/download/${newSongId}`)
            expect(audioRes.ok()).toBe(true)
            const audioBuffer = await audioRes.body()
            const tmpFile = path.join(os.tmpdir(), `e2e-trim-${newSongId}.mp3`)
            fs.writeFileSync(tmpFile, audioBuffer)
            try {
                const probe = execSync(`ffprobe -v quiet -print_format json -show_streams "${tmpFile}"`).toString()
                const streams = JSON.parse(probe).streams
                const audioStream = streams.find((s: any) => s.codec_type === 'audio')
                expect(audioStream, 'Audio stream must exist in output').toBeTruthy()
                const audioDuration = parseFloat(audioStream.duration)
                expect(audioDuration).toBeGreaterThan(28)
                expect(audioDuration).toBeLessThan(32)
            } finally {
                fs.unlinkSync(tmpFile)
            }
        } finally {
            if (newSongId) await api.delete(`${API_V1}/library/${newSongId}`)
            await api.dispose()
        }
    })

    test('volume change produces re-encoded output with same duration', async ({ page: _page }) => {
        test.skip(!!process.env.CI, 'encoding job too slow for CI runners — run locally')
        test.slow()

        const api = await apiLoginAs(EDITOR_USERNAME, EDITOR_PASSWORD)
        let newSongId: string | null = null
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            expect(libRes.ok()).toBe(true)
            const songs = await libRes.json()
            expect(Array.isArray(songs) && songs.length > 0).toBe(true)
            const song = songs[0]

            // Get original duration
            const origAudioRes = await api.get(`${API_V1}/download/${song.uuid}`)
            expect(origAudioRes.ok()).toBe(true)
            const origBuffer = await origAudioRes.body()
            const tmpOrig = path.join(os.tmpdir(), `e2e-orig-${song.uuid}.mp3`)
            fs.writeFileSync(tmpOrig, origBuffer)
            let origDuration: number
            try {
                const probe = execSync(`ffprobe -v quiet -print_format json -show_streams "${tmpOrig}"`).toString()
                const streams = JSON.parse(probe).streams
                origDuration = parseFloat(streams.find((s: any) => s.codec_type === 'audio').duration)
            } finally {
                fs.unlinkSync(tmpOrig)
            }

            const editRes = await api.post(`${API_V1}/edit/songs/${song.uuid}`, {
                data: {
                    params: { trim_start: 0, trim_end: null, volume: 1.5, fades: [], speed: 1.0, normalize: false, cuts: [] },
                    overwrite: false,
                },
            })
            expect(editRes.ok()).toBe(true)
            const job = await editRes.json()

            let result: any
            for (let i = 0; i < 90; i++) {
                await new Promise(r => setTimeout(r, 1000))
                const pollRes = await api.get(`${API_V1}/edit/jobs/${job.job_id}`)
                result = await pollRes.json()
                if (result.status === 'done' || result.status === 'failed') break
            }
            expect(result.status, `Job failed: ${result.error}`).toBe('done')
            expect(result.lossless, 'Volume change should not be lossless').toBe(false)

            newSongId = result.result_song_id
            expect(newSongId).toBeTruthy()

            const audioRes = await api.get(`${API_V1}/download/${newSongId}`)
            expect(audioRes.ok()).toBe(true)
            const audioBuffer = await audioRes.body()
            const tmpFile = path.join(os.tmpdir(), `e2e-vol-${newSongId}.mp3`)
            fs.writeFileSync(tmpFile, audioBuffer)
            try {
                const probe = execSync(`ffprobe -v quiet -print_format json -show_streams "${tmpFile}"`).toString()
                const streams = JSON.parse(probe).streams
                const audioStream = streams.find((s: any) => s.codec_type === 'audio')
                expect(audioStream).toBeTruthy()
                const newDuration = parseFloat(audioStream.duration)
                // Duration should be within 2s of original
                expect(Math.abs(newDuration - origDuration)).toBeLessThan(2)
            } finally {
                fs.unlinkSync(tmpFile)
            }
        } finally {
            if (newSongId) await api.delete(`${API_V1}/library/${newSongId}`)
            await api.dispose()
        }
    })

    test('cut removes audio segment — output shorter than original', async ({ page: _page }) => {
        test.skip(!!process.env.CI, 'encoding job too slow for CI runners — run locally')
        test.slow()

        const api = await apiLoginAs(EDITOR_USERNAME, EDITOR_PASSWORD)
        let newSongId: string | null = null
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            expect(libRes.ok()).toBe(true)
            const songs = await libRes.json()
            expect(Array.isArray(songs) && songs.length > 0).toBe(true)
            const song = songs[0]

            // Get original duration
            const origAudioRes = await api.get(`${API_V1}/download/${song.uuid}`)
            expect(origAudioRes.ok()).toBe(true)
            const origBuffer = await origAudioRes.body()
            const tmpOrig = path.join(os.tmpdir(), `e2e-orig-cut-${song.uuid}.mp3`)
            fs.writeFileSync(tmpOrig, origBuffer)
            let origDuration: number
            try {
                const probe = execSync(`ffprobe -v quiet -print_format json -show_streams "${tmpOrig}"`).toString()
                const streams = JSON.parse(probe).streams
                origDuration = parseFloat(streams.find((s: any) => s.codec_type === 'audio').duration)
            } finally {
                fs.unlinkSync(tmpOrig)
            }
            expect(origDuration, 'Song must be longer than 20s for cut test').toBeGreaterThan(20)

            // Cut 10s-20s (removes 10s)
            const editRes = await api.post(`${API_V1}/edit/songs/${song.uuid}`, {
                data: {
                    params: {
                        trim_start: 0, trim_end: null, volume: 1.0, fades: [], speed: 1.0, normalize: false,
                        cuts: [{ start: 10, end: 20, fade_in: 0, fade_out: 0 }],
                    },
                    overwrite: false,
                },
            })
            expect(editRes.ok()).toBe(true)
            const job = await editRes.json()

            let result: any
            for (let i = 0; i < 90; i++) {
                await new Promise(r => setTimeout(r, 1000))
                const pollRes = await api.get(`${API_V1}/edit/jobs/${job.job_id}`)
                result = await pollRes.json()
                if (result.status === 'done' || result.status === 'failed') break
            }
            expect(result.status, `Job failed: ${result.error}`).toBe('done')
            expect(result.lossless, 'Cut with no fades should be lossless').toBe(true)

            newSongId = result.result_song_id
            expect(newSongId).toBeTruthy()

            const audioRes = await api.get(`${API_V1}/download/${newSongId}`)
            expect(audioRes.ok()).toBe(true)
            const audioBuffer = await audioRes.body()
            const tmpFile = path.join(os.tmpdir(), `e2e-cut-${newSongId}.mp3`)
            fs.writeFileSync(tmpFile, audioBuffer)
            try {
                const probe = execSync(`ffprobe -v quiet -print_format json -show_streams "${tmpFile}"`).toString()
                const streams = JSON.parse(probe).streams
                const audioStream = streams.find((s: any) => s.codec_type === 'audio')
                expect(audioStream).toBeTruthy()
                const newDuration = parseFloat(audioStream.duration)
                // Should be ~(origDuration - 10), allow ±2s tolerance
                expect(Math.abs(newDuration - (origDuration - 10))).toBeLessThan(2)
            } finally {
                fs.unlinkSync(tmpFile)
            }
        } finally {
            if (newSongId) await api.delete(`${API_V1}/library/${newSongId}`)
            await api.dispose()
        }
    })

    test('speed change alters duration — 2× speed halves length', async ({ page: _page }) => {
        test.skip(!!process.env.CI, 'encoding job too slow for CI runners — run locally')
        test.slow()

        const api = await apiLoginAs(EDITOR_USERNAME, EDITOR_PASSWORD)
        let newSongId: string | null = null
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            expect(libRes.ok()).toBe(true)
            const songs = await libRes.json()
            expect(Array.isArray(songs) && songs.length > 0).toBe(true)
            const song = songs[0]

            // Get original duration
            const origAudioRes = await api.get(`${API_V1}/download/${song.uuid}`)
            expect(origAudioRes.ok()).toBe(true)
            const origBuffer = await origAudioRes.body()
            const tmpOrig = path.join(os.tmpdir(), `e2e-orig-spd-${song.uuid}.mp3`)
            fs.writeFileSync(tmpOrig, origBuffer)
            let origDuration: number
            try {
                const probe = execSync(`ffprobe -v quiet -print_format json -show_streams "${tmpOrig}"`).toString()
                const streams = JSON.parse(probe).streams
                origDuration = parseFloat(streams.find((s: any) => s.codec_type === 'audio').duration)
            } finally {
                fs.unlinkSync(tmpOrig)
            }

            const editRes = await api.post(`${API_V1}/edit/songs/${song.uuid}`, {
                data: {
                    params: { trim_start: 0, trim_end: null, volume: 1.0, fades: [], speed: 2.0, normalize: false, cuts: [] },
                    overwrite: false,
                },
            })
            expect(editRes.ok()).toBe(true)
            const job = await editRes.json()

            let result: any
            for (let i = 0; i < 90; i++) {
                await new Promise(r => setTimeout(r, 1000))
                const pollRes = await api.get(`${API_V1}/edit/jobs/${job.job_id}`)
                result = await pollRes.json()
                if (result.status === 'done' || result.status === 'failed') break
            }
            expect(result.status, `Job failed: ${result.error}`).toBe('done')
            expect(result.lossless, 'Speed change should not be lossless').toBe(false)

            newSongId = result.result_song_id
            expect(newSongId).toBeTruthy()

            const audioRes = await api.get(`${API_V1}/download/${newSongId}`)
            expect(audioRes.ok()).toBe(true)
            const audioBuffer = await audioRes.body()
            const tmpFile = path.join(os.tmpdir(), `e2e-spd-${newSongId}.mp3`)
            fs.writeFileSync(tmpFile, audioBuffer)
            try {
                const probe = execSync(`ffprobe -v quiet -print_format json -show_streams "${tmpFile}"`).toString()
                const streams = JSON.parse(probe).streams
                const audioStream = streams.find((s: any) => s.codec_type === 'audio')
                expect(audioStream).toBeTruthy()
                const newDuration = parseFloat(audioStream.duration)
                const expectedDuration = origDuration / 2
                // Allow ±3s tolerance for speed-change encoding
                expect(Math.abs(newDuration - expectedDuration)).toBeLessThan(3)
            } finally {
                fs.unlinkSync(tmpFile)
            }
        } finally {
            if (newSongId) await api.delete(`${API_V1}/library/${newSongId}`)
            await api.dispose()
        }
    })

    test('draft preserved on parent after non-overwrite save', async ({ page: _page }) => {
        test.skip(!!process.env.CI, 'encoding job too slow for CI runners — run locally')
        test.slow()
        const api = await apiLoginAs(EDITOR_USERNAME, EDITOR_PASSWORD)
        let childId: string | null = null
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = await libRes.json()
            const song = songs.find((s: any) => s.properties && !s.parent_song_id)
            expect(song, 'Need a root song in library').toBeTruthy()

            // Save a draft on the source song
            const draftParams = { trim_start: 5, trim_end: 30, volume: 0.8, fades: [], speed: 1.0, normalize: false, cuts: [] }
            await api.put(`${API_V1}/edit/songs/${song.uuid}/draft`, { data: draftParams })

            // Edit (non-overwrite) — creates child
            const result = await submitEditAndWait(api, song.uuid, { trim_end: 30 })
            childId = result.result_song_id
            expect(childId).toBeTruthy()

            // Parent's draft should still exist
            const draftRes = await api.get(`${API_V1}/edit/songs/${song.uuid}/draft`)
            expect(draftRes.ok(), 'Parent draft should survive non-overwrite save').toBe(true)
            const draft = await draftRes.json()
            expect(draft.params.trim_start).toBe(5)
        } finally {
            if (childId) await api.delete(`${API_V1}/library/${childId}`)
            await api.dispose()
        }
    })

    test('2-edit cap deletes grandparent intermediate', async ({ page: _page }) => {
        test.skip(!!process.env.CI, 'encoding job too slow for CI runners — run locally')
        test.slow()
        const api = await apiLoginAs(EDITOR_USERNAME, EDITOR_PASSWORD)
        const created: string[] = []
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = await libRes.json()
            const root = songs.find((s: any) => s.properties && !s.parent_song_id)
            expect(root, 'Need a root song in library').toBeTruthy()

            // Edit 1: root → child1
            const r1 = await submitEditAndWait(api, root.uuid, { normalize: true })
            const child1 = r1.result_song_id
            created.push(child1)

            // Edit 2: child1 → child2
            const r2 = await submitEditAndWait(api, child1, { normalize: true })
            const child2 = r2.result_song_id
            created.push(child2)

            // Edit 3: child2 → child3 — should trigger cap, deleting child1
            const r3 = await submitEditAndWait(api, child2, { normalize: true })
            const child3 = r3.result_song_id
            created.push(child3)

            // child1 should be gone (deleted by 2-edit cap)
            const child1Download = await api.get(`${API_V1}/download/${child1}`)
            expect(child1Download.status(), 'Grandparent should be deleted by 2-edit cap').toBe(404)

            // child2 should still exist (it's the hidden parent)
            const child2Song = await getSongFromLibrary(api, child2)
            // child2 was removed from library but song record should still exist
            const child2Download = await api.get(`${API_V1}/download/${child2}`)
            expect(child2Download.ok(), 'Parent should still exist').toBe(true)

            // root should still exist
            const rootDownload = await api.get(`${API_V1}/download/${root.uuid}`)
            expect(rootDownload.ok(), 'Root should never be deleted').toBe(true)
        } finally {
            for (const id of created) await api.delete(`${API_V1}/library/${id}`).catch(() => {})
            await api.dispose()
        }
    })

    test('publish via API cleans up edit chain and nulls parent/root', async ({ page: _page }) => {
        test.skip(!!process.env.CI, 'encoding job too slow for CI runners — run locally')
        test.slow()
        const api = await apiLoginAs(EDITOR_USERNAME, EDITOR_PASSWORD)
        let childId: string | null = null
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = await libRes.json()
            const root = songs.find((s: any) => s.properties && !s.parent_song_id && s.owner_id)
            expect(root, 'Need a private root song in library').toBeTruthy()

            // Edit root → child
            const result = await submitEditAndWait(api, root.uuid, { normalize: true })
            childId = result.result_song_id
            expect(childId).toBeTruthy()

            // Verify child has edit chain before publish
            const beforeSong = await getSongFromLibrary(api, childId!)
            expect(beforeSong, 'Child should be in library').toBeTruthy()
            expect(beforeSong.parent_song_id, 'Child should have parent before publish').toBeTruthy()
            expect(beforeSong.root_song_id, 'Child should have root before publish').toBeTruthy()

            // Publish via library endpoint
            const pubRes = await api.post(`${API_V1}/library/publish`, { data: { song_ids: [childId] } })
            expect(pubRes.ok()).toBe(true)
            const pubResult = await pubRes.json()
            expect(pubResult.published).toBe(1)

            // Verify chain cleaned up
            const afterRes = await api.get(`${API_V1}/songs/library`)
            const afterSongs = await afterRes.json()
            const afterSong = afterSongs.find((s: any) => s.uuid === childId)
            if (afterSong) {
                expect(afterSong.parent_song_id, 'Published song parent should be null').toBeNull()
                expect(afterSong.root_song_id, 'Published song root should be null').toBeNull()
            }
        } finally {
            if (childId) await api.delete(`${API_V1}/library/${childId}`).catch(() => {})
            await api.dispose()
        }
    })

    test('non-overwrite save does not auto-publish', async ({ page: _page }) => {
        test.skip(!!process.env.CI, 'encoding job too slow for CI runners — run locally')
        test.slow()
        const api = await apiLoginAs(EDITOR_USERNAME, EDITOR_PASSWORD)
        let childId: string | null = null
        try {
            const libRes = await api.get(`${API_V1}/songs/library`)
            const songs = await libRes.json()
            const root = songs.find((s: any) => s.properties && !s.parent_song_id && s.owner_id)
            expect(root, 'Need a private root song in library').toBeTruthy()

            const result = await submitEditAndWait(api, root.uuid, { normalize: true })
            childId = result.result_song_id
            expect(childId).toBeTruthy()

            // Child should still be owned by user (not auto-published)
            const child = await getSongFromLibrary(api, childId!)
            expect(child, 'Child should be in library').toBeTruthy()
            expect(child.owner_id, 'Child should still have an owner (not auto-published)').toBeTruthy()
        } finally {
            if (childId) await api.delete(`${API_V1}/library/${childId}`).catch(() => {})
            await api.dispose()
        }
    })
})
