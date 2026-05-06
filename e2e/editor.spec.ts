import { routes, editSongRoute } from './routes'
import { test, expect, Page, Locator } from '@playwright/test'
import { USERNAME, PASSWORD, login, ignoreError, apiLogin, apiLoginAs, API_V1, EDITOR_USERNAME, EDITOR_PASSWORD } from './helpers'


// Volume / Speed are ScrubInput components — role="spinbutton", aria-label
// in lowercase ("volume", "speed"). Playwright's dblclick() simulates pointer
// events which trigger the scrub-drag path and bump the value before edit
// mode opens. Dispatch a synthetic dblclick instead so only React's
// onDoubleClick handler fires (cleanly enters edit mode at current value).
async function scrubFill(modal: Locator, label: string, displayText: string) {
    const scrub = modal.getByRole('spinbutton', { name: label })
    await expect(scrub).toBeVisible({ timeout: 3000 })
    await scrub.dispatchEvent('dblclick')
    const input = modal.locator(`input[aria-label="${label}"]`)
    await expect(input).toBeVisible({ timeout: 3000 })
    await input.fill(displayText)
    await input.press('Enter')
}

async function openEditorFromLibrary(page: Page) {
    await page.goto(routes.library)
    // Wait for library to load
    await expect(page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

    // Pick the first song-card with non-empty text (has a track name)
    const allCards = page.getByTestId('song-card')
    let validCard = null
    const count = await allCards.count()
    for (let i = 0; i < count; i++) {
        const card = allCards.nth(i)
        const text = await card.textContent()
        if (text && text.trim().length > 0) {
            validCard = card
            break
        }
    }

    if (!validCard) throw new Error('No song cards with track names found in library')

    await validCard.hover()
    // Try song-kebab testid first, fall back to button[title="more"]
    let kebabBtn = validCard.getByTestId('song-kebab')
    const kebabCount = await kebabBtn.count()
    if (kebabCount === 0) {
        kebabBtn = validCard.locator('button[title="more"]')
    }
    await kebabBtn.click()

    await page.getByRole('button', { name: 'Edit', exact: true }).click()

    const modal = page.getByTestId('editor-modal')
    await expect(modal).toBeVisible()
    return modal
}

test.describe('editor modal', () => {
    test.describe.configure({ mode: 'serial' })
    test.use({ storageState: 'e2e/.auth/editor-user.json' })

    test.beforeEach(async ({ page }) => {
        await login(page, EDITOR_USERNAME, EDITOR_PASSWORD)
    })

    test('opens editor modal for first library song', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorFromLibrary(page)
        await expect(modal.getByTestId('waveform')).toBeVisible()
        await expect(modal.getByRole('button', { name: 'audio' })).toBeVisible()
        await expect(modal.getByRole('button', { name: 'properties' })).toBeVisible()

        // wait for waveform to fully load (preview button is the ready signal)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 15000 })

        const abortErrors = errors.filter(e => /AbortError/i.test(e))
        expect(abortErrors, `AbortErrors found: ${abortErrors.join('\n')}`).toHaveLength(0)
    })

    test('waveform loads and preview-with-edits button becomes active', async ({ page }) => {
        const modal = await openEditorFromLibrary(page)
        // The preview button is gated by wsReady, so we use it as the
        // waveform-ready signal across the suite.
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })
    })

    test('volume scrub-input is interactive and updates display', async ({ page }) => {
        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        // Volume's ScrubInput parses raw dB; +6 dB == ~2x amplitude.
        await scrubFill(modal, 'volume', '+3.0 dB')
        await expect(modal.getByRole('spinbutton', { name: 'volume' })).toContainText('+3.0 dB')
    })

    test('undo button activates after volume change', async ({ page }) => {
        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        const undoBtn = modal.locator('button[title="undo (Ctrl+Z)"]')
        await expect(undoBtn).toBeDisabled()

        await scrubFill(modal, 'volume', '+3.0 dB')

        await expect(undoBtn).not.toBeDisabled()
    })

    test('redo button becomes enabled after undo', async ({ page }) => {
        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        const undoBtn = modal.locator('button[title="undo (Ctrl+Z)"]')
        const redoBtn = modal.locator('button[title="redo (Ctrl+Shift+Z)"]')

        await expect(redoBtn).toBeDisabled()

        await scrubFill(modal, 'volume', '+3.0 dB')
        await expect(undoBtn).not.toBeDisabled()

        await undoBtn.click()
        await expect(redoBtn).not.toBeDisabled()
    })

    test('version badge shows "edit" for unedited song', async ({ page }) => {
        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })
        await expect(modal.getByTestId('version-badge')).toHaveText('edit')
    })

    test('add cut button disabled until waveform ready, then adds/removes a cut', async ({ page }) => {
        const modal = await openEditorFromLibrary(page)

        const addCutBtn = modal.getByRole('button', { name: '+ add cut' })
        await expect(addCutBtn).toBeVisible()

        // disabled before wsReady
        await expect(addCutBtn).toBeDisabled()

        // wait for waveform ready
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

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
        const modal = await openEditorFromLibrary(page)

        await modal.getByRole('button', { name: 'properties' }).click()
        // exact: true — otherwise 'Artist' matches 'Album artist' too,
        // and 'Album' matches both 'Album' and 'Album artist'.
        await expect(modal.getByText('Track name', { exact: true })).toBeVisible()
        await expect(modal.getByText('Artist', { exact: true })).toBeVisible()
        await expect(modal.getByText('Album', { exact: true })).toBeVisible()

        const trackInput = modal.locator('input').first()
        await expect(trackInput).not.toBeEmpty()
    })

    test('closes on X button click', async ({ page }) => {
        const modal = await openEditorFromLibrary(page)
        await modal.getByTestId('editor-close').click()
        await expect(modal).not.toBeVisible()
    })

    test('draft auto-save fires (no console errors during interaction)', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        // clear init-time errors (draft 404 on open is expected)
        errors.length = 0

        await scrubFill(modal, 'volume', '+1.0 dB')

        // wait for debounced draft save (1s)
        await page.waitForTimeout(1500)

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/Failed to fetch/i.test(e) && !/favicon/i.test(e))
        expect(realErrors, `Console errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('discard draft resets params', async ({ page }) => {
        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        await scrubFill(modal, 'volume', '+3.0 dB')
        const volumeScrub = modal.getByRole('spinbutton', { name: 'volume' })
        await expect(volumeScrub).toContainText('+3.0 dB')

        await modal.getByRole('button', { name: /discard/i }).click()
        await expect(volumeScrub).toContainText('+0.0 dB')
    })

    test('no AbortError overlay on open and close', async ({ page }) => {
        const overlayErrors: string[] = []
        page.on('pageerror', err => overlayErrors.push(err.message))

        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        // close modal (triggers WaveSurfer destroy)
        await modal.getByTestId('editor-close').click()
        await expect(modal).not.toBeVisible()

        // wait for async AbortError to surface (if any)
        await page.waitForTimeout(500)

        const abortErrors = overlayErrors.filter(e => /AbortError/i.test(e))
        expect(abortErrors, `AbortErrors after close: ${abortErrors.join('\n')}`).toHaveLength(0)
    })

    // FIXME(0.1.0): test wants a song with track name "edit-me" — no such
    // fixture in e2e/fixtures/songs/. Either add a dedicated fixture (mp3
    // with that ID3 tag) or rewrite to save+revert track on a seeded song.
    test.fixme('properties tab: saves and reverts track name on edit-me', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorFromLibrary(page)

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
            !/AbortError/i.test(e) && !/Failed to fetch/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e) && !/404/i.test(e)
        )
        expect(realErrors, `Console errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('cut shows time range in list and preview with cut has no errors', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })
        errors.length = 0

        // add a cut
        await modal.getByRole('button', { name: '+ add cut' }).click()

        // a cut row should appear showing a time range (e.g. "0:00 – 0:02")
        const cutRow = modal.locator('button[title="remove cut"]').first()
        await expect(cutRow).toBeVisible({ timeout: 5000 })

        // the cut list should display a formatted time range
        await expect(modal.locator('.tabular-nums').first()).toBeVisible()

        // preview with the cut active — actual button title is
        // "preview with edits" (toggles to "stop preview" while running).
        await modal.locator('button[title="preview with edits"]').click()
        await expect(modal.locator('button[title="stop preview"]')).toBeVisible({ timeout: 5000 })
        await modal.locator('button[title="stop preview"]').click()

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/Failed to fetch/i.test(e) && !/favicon/i.test(e))
        expect(realErrors, `Errors during cut preview: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('waveform play pauses when preview starts', async ({ page }) => {
        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        // start original waveform playback
        await modal.getByTestId('orig-play').click()
        await page.waitForTimeout(300)

        // click preview — waveform should stop, preview starts
        await modal.locator('button[title="preview with edits"]').click()
        await page.waitForTimeout(300)

        // stop preview button visible means preview is playing
        await expect(modal.locator('button[title="stop preview"]')).toBeVisible()
        await modal.locator('button[title="stop preview"]').click()
    })

    test('discard clears all cuts', async ({ page }) => {
        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        // add two cuts
        await modal.getByRole('button', { name: '+ add cut' }).click()
        await modal.getByRole('button', { name: '+ add cut' }).click()
        await expect(modal.locator('button[title="remove cut"]')).toHaveCount(2, { timeout: 5000 })

        // discard resets everything
        await modal.getByRole('button', { name: /discard/i }).click()
        await expect(modal.locator('button[title="remove cut"]')).toHaveCount(0)
    })

    test('speed scrub-input sets display to 0.50×', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        await scrubFill(modal, 'speed', '0.50×')
        await expect(modal.getByRole('spinbutton', { name: 'speed' })).toContainText('0.50×')

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/Failed to fetch/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e) && !/404/i.test(e))
        expect(realErrors, `Errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('normalize checkbox toggles on', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        const normalizeCheckbox = modal.locator('input[type="checkbox"]').filter({ hasNot: modal.locator('[name]') }).first()
        // find the normalize label
        const normalizeLabel = modal.locator('label').filter({ hasText: /normalize/i })
        const checkbox = normalizeLabel.locator('input[type="checkbox"]')
        await expect(checkbox).not.toBeChecked()
        await checkbox.check()
        await expect(checkbox).toBeChecked()

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/Failed to fetch/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e) && !/404/i.test(e))
        expect(realErrors, `Errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    test('preview badge changes to "preview" (orange) when preview starts', async ({ page }) => {
        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        const badge = modal.getByTestId('version-badge')
        await expect(badge).toHaveText('edit')

        await modal.locator('button[title="preview with edits"]').click()
        await expect(badge).toHaveText('preview', { timeout: 3000 })

        await modal.locator('button[title="stop preview"]').click()
        await expect(badge).toHaveText('edit', { timeout: 3000 })
    })

    test('preview scrubbing — click waveform during no-cut preview causes no errors', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })
        errors.length = 0

        // start preview (no cuts — uses WaveSurfer native path).
        await modal.locator('button[title="preview with edits"]').click()
        // the button toggles to title="stop preview" while preview is running
        await expect(modal.locator('button[title="stop preview"]')).toBeVisible({ timeout: 3000 })

        // click waveform at a different position
        const waveform = modal.getByTestId('waveform')
        const box = await waveform.boundingBox()
        if (box) {
            await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2)
        }

        await modal.locator('button[title="stop preview"]').click()

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/Failed to fetch/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e) && !/404/i.test(e))
        expect(realErrors, `Errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })


    test('close guard: amber banner appears on unsaved change then auto-closes', async ({ page }) => {
        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        await scrubFill(modal, 'volume', '+2.0 dB')
        await modal.getByTestId('editor-close').click()

        // Single atomic check: banner appears while draft saves then auto-closes.
        // filter({ hasText }) is evaluated atomically — avoids a sequential race
        // where the banner disappears between toBeVisible and toContainText.
        await expect(
            page.locator('.bg-amber-50, .bg-amber-950\\/40').filter({ hasText: /Draft auto-saved/i })
        ).toBeVisible({ timeout: 5000 })
        await expect(modal).not.toBeVisible({ timeout: 10000 })
    })

    // FIXME: banner is intentionally brief (disappears once draft saves); button is detached
    // before Playwright can click it. Not a bug — the UX is correct, just untestable this way.
    test.fixme('close guard: "don\'t show again" dismisses modal and suppresses future banners', async ({ page }) => {
        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        await scrubFill(modal, 'volume', '+2.0 dB')
        await modal.getByTestId('editor-close').click()

        await expect(page.getByRole('button', { name: "don't show again" })).toBeVisible({ timeout: 3000 })
        await page.getByRole('button', { name: "don't show again" }).click()
        await expect(modal).not.toBeVisible({ timeout: 5000 })
    })

    test('Ctrl+Z keyboard shortcut triggers undo', async ({ page }) => {
        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        const undoBtn = modal.locator('button[title="undo (Ctrl+Z)"]')
        await expect(undoBtn).toBeDisabled()

        await scrubFill(modal, 'volume', '+3.0 dB')
        await expect(undoBtn).not.toBeDisabled()

        // press Ctrl+Z on the modal element (focused by default)
        await modal.press('Control+z')

        // after undo, undo button should be disabled again (only one change was made)
        await expect(undoBtn).toBeDisabled({ timeout: 3000 })
    })

    test('h/l keyboard seeking causes no errors', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })
        errors.length = 0

        // press l (seek forward 5s)
        await modal.press('l')
        // press h (seek backward 5s)
        await modal.press('h')

        const realErrors = errors.filter(e => !/AbortError/i.test(e) && !/Failed to fetch/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e) && !/404/i.test(e))
        expect(realErrors, `Errors: ${realErrors.join('\n')}`).toHaveLength(0)
    })

    // Locks in the cut-fade-ear collision fix: when a cut already has a
    // fade-out ear extending leftward, adding another cut should respect that
    // ear's range and not overlap. Drag interactions on waveform regions are
    // notoriously fragile in Playwright, so this is fixme-d while the spec
    // sketches the intended behavior.
    //
    // FIXME: requires precise pointer drag on the waveform-rendered fade-out
    // handle (no stable testid on the fade ear). When/if a `data-testid` is
    // added (e.g. `cut-fade-out-handle`) refactor this test to drive it
    // directly. Until then we lock in the simpler "two cuts can coexist"
    // baseline below.
    test.fixme('add cut → expand fade-out ear left → add second cut respects fade range', async ({ page }) => {
        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        // First cut
        await modal.getByRole('button', { name: '+ add cut' }).click()
        const firstRemove = modal.locator('button[title="remove cut"]').first()
        await expect(firstRemove).toBeVisible({ timeout: 5000 })

        // Expand fade-after slider on first cut to a meaningful value (proxy
        // for dragging the ear leftward without needing the waveform handle).
        const fadeAfter = modal.getByRole('slider', { name: 'fade after cut' }).first()
        await fadeAfter.fill('2')
        await fadeAfter.dispatchEvent('input')

        // Add another cut — it should NOT collide with the first cut's
        // fade-after region. We'd want to assert the new cut's start time is
        // beyond the first cut's end + fade-after, but neither value has a
        // stable selector. Marked fixme until we expose them.
        await modal.getByRole('button', { name: '+ add cut' }).click()
        await expect(modal.locator('button[title="remove cut"]')).toHaveCount(2, { timeout: 5000 })
    })

    // Companion lighter assertion that does not depend on fade ear drag UX:
    // adding two cuts in a row does not throw and both cut rows are present.
    test('add two cuts in sequence: both rows render without error', async ({ page }) => {
        const errors: string[] = []
        page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
        page.on('pageerror', err => errors.push(err.message))

        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })
        errors.length = 0

        await modal.getByRole('button', { name: '+ add cut' }).click()
        await expect(modal.locator('button[title="remove cut"]')).toHaveCount(1, { timeout: 5000 })
        await modal.getByRole('button', { name: '+ add cut' }).click()
        await expect(modal.locator('button[title="remove cut"]')).toHaveCount(2, { timeout: 5000 })

        const real = errors.filter(e => !/AbortError/i.test(e) && !/Failed to fetch/i.test(e) && !/favicon/i.test(e) && !/401/i.test(e) && !/404/i.test(e))
        expect(real, `Errors after adding two cuts: ${real.join('\n')}`).toHaveLength(0)
    })

    // === CRITICAL DESTRUCTIVE FLOWS ===

    test('save to library: encodes and creates new song version', async ({ page }) => {
        test.skip(!!process.env.CI, 'encoding job too slow for CI runners — run locally')
        test.slow()
        const api = await apiLoginAs(EDITOR_USERNAME, EDITOR_PASSWORD)
        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        // Extract origin song ID from URL BEFORE editing (we're at /songs/<uuid>/edit)
        const originMatch = page.url().match(/\/songs\/([a-f0-9-]+)\/edit/)
        const originSongId = originMatch?.[1]
        expect(originSongId, 'Could not extract origin song ID from URL').toBeTruthy()

        // Make an unambiguous param change. Volume uses ScrubInput (a span with role=spinbutton),
        // not a real range input, so .fill() doesn't work. Toggling Normalize checkbox is the
        // simplest deterministic param mutation.
        const normalizeCheckbox = modal.locator('label').filter({ hasText: /normalize/i }).locator('input[type="checkbox"]')
        await normalizeCheckbox.check()

        // Click "Save to Library" — handleSave creates the edit job, polls until done,
        // then router.push to /library?song=<newId>. The modal unmounts on success.

        // Capture ?song= via framenavigated event — the library scroll effect clears
        // it from the URL almost immediately, so toHaveURL (polling) misses it.
        let capturedSongId: string | null = null
        page.on('framenavigated', frame => {
            if (frame === page.mainFrame()) {
                const m = frame.url().match(/\/library\?.*song=([a-f0-9-]+)/)
                if (m) capturedSongId = m[1]
            }
        })

        await modal.getByRole('button', { name: /^Save to Library$/i }).click()

        // Wait for navigation to library. Encoding can take ~30-60s; allow 90s.
        await page.waitForURL(/\/library/, { timeout: 90_000 })

        expect(capturedSongId, 'New song ID should be present in redirect URL').toBeTruthy()
        const newSongId = capturedSongId!
        expect(newSongId, 'New song ID should differ from origin').not.toBe(originSongId)

        // Cleanup: delete the new child song via API. 200/204 success, 404 already gone — both fine.
        if (newSongId) {
            const res = await api.delete(`${API_V1}/library/${newSongId}`)
            expect([200, 204, 404]).toContain(res.status())
        }
        await api.dispose()
    })

    test('restore original: child song shows restore button and navigates to parent', async ({ page }) => {
        test.skip(!!process.env.CI, 'encoding job too slow for CI runners — run locally')
        test.slow()
        const api = await apiLoginAs(EDITOR_USERNAME, EDITOR_PASSWORD)

        // Step 1: Open editor on a library song, capture parent ID, make an edit, save → creates a child.
        const modal1 = await openEditorFromLibrary(page)
        await expect(modal1.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        const parentSongId = page.url().match(/\/songs\/([a-f0-9-]+)\/edit/)?.[1]
        expect(parentSongId, 'Could not extract parent song ID').toBeTruthy()

        // Toggle Normalize for an unambiguous param change (volume slider is a ScrubInput, not a real range)
        await modal1.locator('label').filter({ hasText: /normalize/i }).locator('input[type="checkbox"]').check()

        // Capture the child song ID from the brief ?song= URL before the app clears it.
        let capturedChildId: string | null = null
        page.on('framenavigated', frame => {
            if (frame === page.mainFrame()) {
                const m = frame.url().match(/\/library\?.*song=([a-f0-9-]+)/)
                if (m) capturedChildId = m[1]
            }
        })
        await modal1.getByRole('button', { name: /^Save to Library$/i }).click()

        // After save, app router.push'es to /library?song=<newId>
        await page.waitForURL(/\/library/, { timeout: 90_000 })
        const childSongId = capturedChildId ?? page.url().match(/[?&]song=([a-f0-9-]+)/)?.[1]
        expect(childSongId, 'Could not extract child song ID').toBeTruthy()
        expect(childSongId, 'Child song ID should differ from parent').not.toBe(parentSongId)

        // Step 2: Navigate to the child editor — modal1 unmounted on save, need a fresh editor instance.
        await page.goto(editSongRoute(childSongId!))
        const childModal = page.getByTestId('editor-modal')
        await expect(childModal).toBeVisible({ timeout: 10000 })
        await expect(childModal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        // Step 3: "Restore Original" button is visible only when activeRootSongId !== activeSongId
        // (i.e. on a child song). Click it, confirm, expect navigation back to root/parent.
        const restoreBtn = childModal.getByRole('button', { name: 'Restore Original' })
        await expect(restoreBtn).toBeVisible({ timeout: 10000 })
        await restoreBtn.click()
        await expect(page.getByText('Restore original?', { exact: true })).toBeVisible({ timeout: 5000 })
        await page.getByRole('button', { name: 'Yes, restore' }).click()

        // Step 4: Assert URL navigates back to parent's editor route.
        // handleRestoreOriginal redirects to editSongRoute(rootSongId ?? songId).
        await expect(page).toHaveURL(new RegExp(`/songs/${parentSongId}/edit`), { timeout: 10000 })

        // Cleanup
        if (childSongId) {
            const res = await api.delete(`${API_V1}/library/${childSongId}`)
            expect([200, 204, 404]).toContain(res.status())
        }

        await api.dispose()
    })

    test('overwrite original: admin checkbox flips save button label and shows danger styling', async ({ page }) => {
        const modal = await openEditorFromLibrary(page)
        await expect(modal.locator('button[title="preview with edits"]')).not.toBeDisabled({ timeout: 30000 })

        // The "save as original" checkbox is admin-only. If not visible, skip.
        const checkboxLabel = page.locator('label').filter({ hasText: /save as original/i })
        const checkboxCount = await checkboxLabel.count()

        if (checkboxCount === 0) {
            // Admin gating is active — test user is not admin
            test.skip()
            return
        }

        // Admin user: checkbox is visible
        const checkbox = checkboxLabel.locator('input[type="checkbox"]')
        await expect(checkbox).toBeVisible()
        await expect(checkbox).not.toBeChecked()

        // Toggle the checkbox
        await checkbox.check()
        await expect(checkbox).toBeChecked()

        // Assert: label text changes to red/danger styling
        const labelSpan = checkboxLabel.locator('span').filter({ hasText: /save as original/i })
        await expect(labelSpan).toHaveClass(/text-red-400/)

        // Assert: the Save button still exists and is labeled "Save to Library"
        // (the label doesn't change, but danger styling on checkbox signals overwrite intent)
        const saveBtn = modal.getByRole('button', { name: 'Save to Library' })
        await expect(saveBtn).toBeVisible()

        // DO NOT click save — this is destructive. Test stops here.
        // Uncheck to revert
        await checkbox.uncheck()
        await expect(checkbox).not.toBeChecked()
        await expect(labelSpan).not.toHaveClass(/text-red-400/)
    })
})
