import { Page, Locator, expect } from '@playwright/test'

export class PlayerBar {
    readonly page: Page
    readonly bar: Locator
    readonly trackName: Locator
    readonly playPause: Locator
    readonly shuffle: Locator
    readonly repeat: Locator
    readonly next: Locator
    readonly progress: Locator
    readonly queueToggle: Locator
    readonly queuePanel: Locator

    constructor(page: Page) {
        this.page = page
        this.bar = page.getByTestId('player-bar')
        this.trackName = page.getByTestId('player-track-name').first()
        this.playPause = page.getByTestId('player-play-pause')
        this.shuffle = page.getByTestId('player-shuffle').filter({ visible: true }).first()
        this.repeat = page.getByTestId('player-repeat').filter({ visible: true }).first()
        this.next = page.getByTestId('player-next').first()
        this.progress = page.getByTestId('player-progress')
        this.queueToggle = page.getByTestId('player-queue-toggle')
        this.queuePanel = page.getByTestId('player-queue-panel')
    }

    async waitForBar(timeout = 5000) {
        await expect(this.bar).toBeVisible({ timeout })
    }

    async waitForTrackName(timeout = 5000) {
        await expect(this.trackName).not.toBeEmpty({ timeout })
    }

    async getTrackName() {
        return (await this.trackName.textContent())?.trim() ?? ''
    }

    async openQueue() {
        await this.queueToggle.click()
        await expect(this.queuePanel).toBeVisible({ timeout: 3000 })
    }

    async closeQueue() {
        await this.queueToggle.click()
    }

    queueRows() {
        return this.page.locator('[data-qi]')
    }

    queueDragHandle(row: Locator) {
        return row.getByTestId('queue-drag-handle')
    }

    queueRemoveBtn(row: Locator) {
        return row.getByTestId('queue-remove')
    }

    contextLink(pattern: RegExp | string) {
        return typeof pattern === 'string'
            ? this.page.getByText(pattern)
            : this.page.getByText(pattern)
    }

    async getProgressSeconds(): Promise<number> {
        const text = await this.progress.textContent()
        const match = text?.match(/(\d+):(\d{2})/)
        if (!match) return 0
        return parseInt(match[1]) * 60 + parseInt(match[2])
    }
}
