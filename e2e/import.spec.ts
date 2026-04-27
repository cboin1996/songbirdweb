import { test, expect, Page } from '@playwright/test'
import { USERNAME, PASSWORD, login, ignoreError } from './helpers'
import path from 'path'
import fs from 'fs'
import os from 'os'


// Create a minimal valid-ish mp3 file for upload testing (ID3 header + empty frames)
function makeFakeAudioFile(name: string): string {
    const filePath = path.join(os.tmpdir(), name)
    // ID3v2 header: "ID3" + version 2.3 + flags + size (0)
    const id3 = Buffer.alloc(10)
    id3.write('ID3')
    id3[3] = 3; id3[4] = 0; id3[5] = 0
    // size: 0 (syncsafe int)
    id3[6] = 0; id3[7] = 0; id3[8] = 0; id3[9] = 0
    fs.writeFileSync(filePath, id3)
    return filePath
}

test.describe('import page', () => {
    test.describe.configure({ mode: 'serial' })

    test.beforeEach(async ({ page }) => {
        await login(page)
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
        await page.goto('/import')
        const dropzone = page.getByTestId('import-dropzone')
        await expect(dropzone).toBeVisible()
        await expect(dropzone).toContainText('.mp3')
        await expect(dropzone).toContainText('.m4a')
        await expect(dropzone).toContainText('drag & drop')
    })

    test('click dropzone opens file picker', async ({ page }) => {
        await page.goto('/import')
        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page.getByTestId('import-dropzone').click(),
        ])
        expect(fileChooser.isMultiple()).toBe(true)
    })

    test('file input accepts multiple files', async ({ page }) => {
        await page.goto('/import')
        const input = page.getByTestId('import-file-input')
        // Check the multiple attribute is present
        await expect(input).toHaveAttribute('multiple', '')
        await expect(input).toHaveAttribute('accept', '.mp3,.m4a')
    })

    test('uploading a file shows row with spinner then result', async ({ page }) => {
        await page.goto('/import')
        const filePath = makeFakeAudioFile('test-song.mp3')
        try {
            await page.getByTestId('import-file-input').setInputFiles(filePath)
            // Row should appear immediately with the filename
            const row = page.getByTestId('import-file-row').first()
            await expect(row).toBeVisible({ timeout: 3000 })
            await expect(row).toContainText('test-song.mp3')
            // Wait for done or error — fake mp3 may fail processing but job still completes
            await expect(row.locator('p.text-emerald-500, p.text-red-500').first()).toBeVisible({ timeout: 15000 })
        } finally {
            fs.unlinkSync(filePath)
        }
    })

    test('uploading multiple files shows multiple rows', async ({ page }) => {
        await page.goto('/import')
        const file1 = makeFakeAudioFile('song-a.mp3')
        const file2 = makeFakeAudioFile('song-b.mp3')
        try {
            await page.getByTestId('import-file-input').setInputFiles([file1, file2])
            await expect(page.getByTestId('import-file-row')).toHaveCount(2, { timeout: 3000 })
        } finally {
            fs.unlinkSync(file1)
            fs.unlinkSync(file2)
        }
    })

    test('removing a row works', async ({ page }) => {
        await page.goto('/import')
        const filePath = makeFakeAudioFile('removable.mp3')
        try {
            await page.getByTestId('import-file-input').setInputFiles(filePath)
            const row = page.getByTestId('import-file-row').first()
            await expect(row).toBeVisible({ timeout: 3000 })
            await row.getByTitle('remove').click()
            await expect(page.getByTestId('import-file-row')).toHaveCount(0)
        } finally {
            fs.unlinkSync(filePath)
        }
    })

    test('unauthenticated user is redirected from /import', async ({ page }) => {
        await page.context().clearCookies()
        await page.goto('/import')
        await expect(page).toHaveURL('/')
    })
})
