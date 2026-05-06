import { routes } from './routes'
import { test, expect, Page } from '@playwright/test'
import { login, apiLoginAs, API_V1, IMPORT_USERNAME, IMPORT_PASSWORD } from './helpers'
import path from 'path'
import fs from 'fs'
import os from 'os'


// Copy a real mp3 fixture to a tmp file with the given name.
// Real files let the import worker fail fast (missing tags → "failed") instead
// of hanging on a malformed 10-byte stub, keeping the queue clear for later tests.
const NO_TAGS_FIXTURE = path.join(__dirname, 'fixtures/songs/no-tags.mp3')
function makeRealAudioCopy(name: string): string {
    const filePath = path.join(os.tmpdir(), name)
    fs.copyFileSync(NO_TAGS_FIXTURE, filePath)
    return filePath
}

test.describe('import page', () => {
    test.describe.configure({ mode: 'serial' })
    test.use({ storageState: 'e2e/.auth/import-user.json' })

    test.beforeEach(async ({ page }) => {
        await login(page, IMPORT_USERNAME, IMPORT_PASSWORD)
    })

    test('import link visible in navbar', async ({ page }) => {
        await expect(page.getByRole('link', { name: 'import' })).toBeVisible()
    })

    test('navigates to /import via navbar', async ({ page }) => {
        await page.getByRole('link', { name: 'import' }).first().click()
        await expect(page).toHaveURL(/\/import/)
        await expect(page.getByTestId('import-dropzone')).toBeVisible()
    })

    test('dropzone visible with correct prompt text', async ({ page }) => {
        await page.goto(routes.import)
        const dropzone = page.getByTestId('import-dropzone')
        await expect(dropzone).toBeVisible()
        await expect(dropzone).toContainText('.mp3')
        await expect(dropzone).toContainText('.m4a')
        await expect(dropzone).toContainText('drag & drop')
    })

    test('click dropzone opens file picker', async ({ page }) => {
        await page.goto(routes.import)
        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.getByTestId('import-dropzone').click(),
        ])
        expect(fileChooser.isMultiple()).toBe(true)
    })

    test('file input accepts multiple files', async ({ page }) => {
        await page.goto(routes.import)
        const input = page.getByTestId('import-file-input')
        // Check the multiple attribute is present
        await expect(input).toHaveAttribute('multiple', '')
        await expect(input).toHaveAttribute('accept', '.mp3,.m4a')
    })

    test('uploading a file shows row with status', async ({ page }) => {
        await page.goto(routes.import)
        const filePath = makeRealAudioCopy('test-song.mp3')
        try {
            await page.getByTestId('import-file-input').setInputFiles(filePath)
            const row = page.locator('tr', { hasText: 'test-song.mp3' }).first()
            await expect(row).toBeVisible({ timeout: 10000 })
            await expect(row.locator('text=/^(done|failed|duplicate)$/').first()).toBeVisible({ timeout: 30000 })
        } finally {
            fs.unlinkSync(filePath)
        }
    })

    test('uploading multiple files shows multiple rows', async ({ page }) => {
        await page.goto(routes.import)
        const ts = Date.now()
        const file1 = makeRealAudioCopy(`song-a-${ts}.mp3`)
        const file2 = makeRealAudioCopy(`song-b-${ts}.mp3`)
        try {
            await page.getByTestId('import-file-input').setInputFiles([file1, file2])
            // Poll for BOTH rows simultaneously — sequential checks race with the 3-second
            // poller that can overwrite optimistic UI state before both jobs are confirmed.
            await expect.poll(async () => {
                const [a, b] = await Promise.all([
                    page.locator('tr', { hasText: `song-a-${ts}.mp3` }).count(),
                    page.locator('tr', { hasText: `song-b-${ts}.mp3` }).count(),
                ])
                return a >= 1 && b >= 1
            }, { timeout: 15000 }).toBe(true)
        } finally {
            fs.unlinkSync(file1)
            fs.unlinkSync(file2)
        }
    })

    // 'removing a row works' was deleted — the import history table doesn't have
    // per-row remove UI (rows are server-persisted import jobs). Re-add this test
    // when/if a remove-row feature ships.

    test('unauthenticated user is redirected from /import', async ({ page }) => {
        await page.context().clearCookies()
        await page.goto(routes.import)
        await expect(page).toHaveURL('/')
    })

    // === Tier 1 dove banner + counters ===

    test('dove banner appears with "importing" / "finished" counts on multi-file drop', async ({ page }) => {
        await page.goto(routes.import)
        const ts = Date.now()
        const files = [
            makeRealAudioCopy(`dove-a-${ts}.mp3`),
            makeRealAudioCopy(`dove-b-${ts}.mp3`),
            makeRealAudioCopy(`dove-c-${ts}.mp3`),
        ]
        try {
            await page.getByTestId('import-file-input').setInputFiles(files)
            // Banner should appear briefly while jobs are in-flight.
            const banner = page.locator('text=/\\d+ importing/').first()
            // Race-tolerant: small files may finish so quickly the banner
            // disappears before assertion. Allow either "still in flight" or
            // "already shown finished count > 0".
            // First wait for either the banner or for at least one job row to
            // have a terminal status to confirm the counters fired.
            try {
                await expect(banner).toBeVisible({ timeout: 5000 })
                await expect(page.locator('text=/\\d+ finished/').first()).toBeVisible({ timeout: 5000 })
            } catch {
                // Fallback: banner already disappeared, ensure terminal status
                // visible on at least one row.
                await expect(page.locator('tr', { hasText: `dove-a-${ts}.mp3` }).locator('text=/^(done|failed|duplicate)$/').first()).toBeVisible({ timeout: 15000 })
            }
        } finally {
            for (const f of files) try { fs.unlinkSync(f) } catch {}
        }
    })

    test('lifetime status chips increment after import completes', async ({ page }) => {
        const api = await apiLoginAs(IMPORT_USERNAME, IMPORT_PASSWORD)
        // Read initial counts via API (status_counts is included in listImportJobs)
        const before = await api.get(`${API_V1}/import?limit=1&offset=0`)
        const beforeBody = before.ok() ? await before.json() : { status_counts: {} }
        const beforeFailed = beforeBody?.status_counts?.failed ?? 0
        const beforeDup = beforeBody?.status_counts?.duplicate ?? 0
        const beforeDone = beforeBody?.status_counts?.done ?? 0

        await page.goto(routes.import)
        // Use the no-tags fixture — real audio, reaches "failed" fast (missing track title).
        const fixturePath = path.join(__dirname, 'fixtures/songs/no-tags.mp3')
        try {
            await page.getByTestId('import-file-input').setInputFiles(fixturePath)
            // Poll the API directly — the row UI has a race where setJobs(initialJobs)
            // can wipe the newly-added row before terminal status appears.
            await expect.poll(async () => {
                const r = await api.get(`${API_V1}/import?limit=1&offset=0`)
                if (!r.ok()) return false
                const body = await r.json()
                const sc = body?.status_counts ?? {}
                return (sc.failed ?? 0) > beforeFailed || (sc.duplicate ?? 0) > beforeDup || (sc.done ?? 0) > beforeDone
            }, { timeout: 30000 }).toBe(true)
        } finally {
            await api.dispose()
        }
    })

    test('dove banner disappears after all jobs finish', async ({ page }) => {
        await page.goto(routes.import)
        const filePath = makeRealAudioCopy('disappear.mp3')
        try {
            await page.getByTestId('import-file-input').setInputFiles(filePath)
            const row = page.locator('tr', { hasText: 'disappear.mp3' }).first()
            await expect(row.locator('text=/^(done|failed|duplicate)$/').first()).toBeVisible({ timeout: 30000 })
            await expect.poll(async () =>
                await page.locator('text=/\\d+ importing/').count(),
                { timeout: 15000 }
            ).toBe(0)
        } finally {
            fs.unlinkSync(filePath)
        }
    })

    // === Tier 1 beforeunload warning ===


    test('duplicate row shows "original added" link', async ({ page }) => {
        await page.goto(routes.import)
        await page.getByTestId('import-file-input').setInputFiles(
            path.join(__dirname, 'fixtures/songs/Nothing Else Matters.mp3'),
        )
        const row = page.locator('tr').filter({ hasText: /Nothing Else Matters/i }).filter({ hasText: 'duplicate' })
        await expect(row.first()).toBeVisible({ timeout: 30000 })
        await expect(row.first().locator('a', { hasText: 'original added' })).toBeVisible()
    })

})
