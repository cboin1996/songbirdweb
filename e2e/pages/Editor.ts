import { Page, Locator, expect } from '@playwright/test'
import { routes } from '../routes'

export class EditorPage {
    readonly page: Page
    readonly modal: Locator
    readonly waveform: Locator
    readonly previewBtn: Locator
    readonly undoBtn: Locator
    readonly redoBtn: Locator
    readonly closeBtn: Locator
    readonly normalizeCheckbox: Locator
    readonly overwriteCheckbox: Locator
    readonly removeCutBtns: Locator
    readonly versionBadge: Locator
    readonly closeGuard: Locator
    readonly origPlay: Locator
    readonly audioTab: Locator
    readonly propertiesTab: Locator
    readonly addCutBtn: Locator
    readonly saveToLibraryBtn: Locator
    readonly restoreOriginalBtn: Locator
    readonly discardBtn: Locator
    readonly draftSaveFailedBanner: Locator
    readonly saveDraftBtn: Locator

    constructor(page: Page) {
        this.page = page
        this.modal = page.getByTestId('editor-modal')
        this.waveform = this.modal.getByTestId('waveform')
        this.previewBtn = this.modal.getByTestId('editor-preview-btn')
        this.undoBtn = this.modal.getByTestId('editor-undo-btn')
        this.redoBtn = this.modal.getByTestId('editor-redo-btn')
        this.closeBtn = this.modal.getByTestId('editor-close')
        this.normalizeCheckbox = this.modal.getByTestId('editor-normalize-checkbox')
        this.overwriteCheckbox = this.modal.getByTestId('editor-overwrite-checkbox')
        this.removeCutBtns = this.modal.getByTestId('editor-remove-cut-btn')
        this.versionBadge = this.modal.getByTestId('version-badge')
        this.closeGuard = page.getByTestId('editor-close-guard')
        this.origPlay = this.modal.getByTestId('orig-play')
        this.audioTab = this.modal.getByRole('button', { name: 'audio' })
        this.propertiesTab = this.modal.getByRole('button', { name: 'properties' })
        this.addCutBtn = this.modal.getByRole('button', { name: '+ add cut' })
        this.saveToLibraryBtn = this.modal.getByRole('button', { name: /^Save to Library$/i })
        this.restoreOriginalBtn = this.modal.getByRole('button', { name: 'Restore Original' })
        this.discardBtn = this.modal.getByRole('button', { name: /discard/i })
        this.draftSaveFailedBanner = page.getByTestId('draft-save-failed')
        this.saveDraftBtn = this.modal.getByRole('button', { name: /save draft/i })
    }

    async waitForWaveform(timeout = 30000) {
        await expect(this.previewBtn).not.toBeDisabled({ timeout })
    }

    scrubInput(label: string) {
        return this.modal.getByRole('spinbutton', { name: label })
    }

    async scrubFill(label: string, displayText: string) {
        const scrub = this.scrubInput(label)
        await expect(scrub).toBeVisible({ timeout: 3000 })
        await scrub.dispatchEvent('dblclick')
        const input = this.modal.locator(`input[aria-label="${label}"]`)
        await expect(input).toBeVisible({ timeout: 3000 })
        await input.fill(displayText)
        await input.press('Enter')
    }

    trackNameInput() {
        return this.modal.getByLabel('Track name')
    }

    fadeAfterSlider() {
        return this.modal.getByRole('slider', { name: 'fade after cut' }).first()
    }

    async openFromLibrary() {
        await this.page.goto(routes.library)
        await expect(this.page.getByTestId('song-card').first()).toBeVisible({ timeout: 10000 })

        const allCards = this.page.getByTestId('song-card')
        let validCard: Locator | null = null
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
        let kebabBtn = validCard.getByTestId('song-kebab')
        const kebabCount = await kebabBtn.count()
        if (kebabCount === 0) {
            kebabBtn = validCard.locator('button[title="more"]')
        }
        await kebabBtn.click()

        await this.page.getByRole('button', { name: 'Edit', exact: true }).click()
        await expect(this.modal).toBeVisible()
        return this.modal
    }
}
