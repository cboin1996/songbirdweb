import { Page, Locator, expect } from '@playwright/test'
import { routes } from '../routes'

export class LibraryPage {
    readonly page: Page
    readonly songCards: Locator
    readonly letterRail: Locator
    readonly letterRailActive: Locator
    readonly selectBtn: Locator
    readonly cancelBtn: Locator
    readonly selectAllBtn: Locator
    readonly deselectAllBtn: Locator
    readonly playAllBtn: Locator
    readonly saveAllOfflineBtn: Locator
    readonly bulkSaveOfflineBtn: Locator
    readonly bulkDownloadBtn: Locator
    readonly bulkRemoveBtn: Locator
    readonly bulkPlaylistBtn: Locator
    readonly searchInput: Locator
    readonly searchClear: Locator
    readonly searchEmpty: Locator

    constructor(page: Page) {
        this.page = page
        this.songCards = page.getByTestId('song-card')
        this.letterRail = page.getByTestId('letter-rail')
        this.letterRailActive = this.letterRail.getByTestId('letter-rail-active')
        this.selectBtn = page.getByRole('button', { name: 'Select', exact: true })
        this.cancelBtn = page.getByRole('button', { name: 'Cancel', exact: true })
        this.selectAllBtn = page.getByRole('button', { name: /select all/i })
        this.deselectAllBtn = page.getByRole('button', { name: /deselect all/i })
        this.playAllBtn = page.getByRole('button', { name: 'play all' })
        this.saveAllOfflineBtn = page.getByTestId('save-all-offline').first()
        this.bulkSaveOfflineBtn = page.getByRole('button', { name: 'Save offline', exact: true })
        this.bulkDownloadBtn = page.getByRole('button', { name: 'Download', exact: true })
        this.bulkRemoveBtn = page.getByRole('button', { name: 'Remove', exact: true })
        this.bulkPlaylistBtn = page.getByRole('button', { name: '+ Playlist' })
        this.searchInput = page.getByTestId('library-search')
        this.searchClear = page.getByTestId('library-search-clear')
        this.searchEmpty = page.getByTestId('library-search-empty')
    }

    async goto(view?: 'songs' | 'artists' | 'albums' | 'genres' | 'playlists') {
        const url = view ? `${routes.library}?view=${view}` : routes.library
        await this.page.goto(url)
    }

    async waitForSongs(timeout = 10000) {
        await expect(this.songCards.first()).toBeVisible({ timeout })
    }

    tab(name: 'songs' | 'artists' | 'albums' | 'genres' | 'playlists') {
        return this.page.getByRole('button', { name, exact: true })
    }

    sections() {
        return this.page.locator('[data-letter]')
    }

    songById(uuid: string) {
        return this.page.locator(`[data-song-id="${uuid}"]`)
    }

    albumById(id: string) {
        return this.page.locator(`[data-album-id="${id}"]`)
    }

    albums() {
        return this.page.locator('[data-album-id]')
    }

    kebab(card: Locator) {
        return card.getByTestId('song-kebab')
    }

    kebabMenu() {
        return this.page.getByTestId('song-kebab-menu')
    }

    libraryToggle(card: Locator) {
        return card.getByTestId('song-library-toggle')
    }

    albumPlay(album: Locator) {
        return album.getByTestId('album-play')
    }

    albumModal() {
        return this.page.getByTestId('album-modal')
    }

    async enterSelectMode() {
        await this.selectBtn.click()
    }

    async exitSelectMode() {
        await this.cancelBtn.click()
    }

    selectedCount() {
        return this.page.getByRole('button', { name: /\d+ selected/i })
    }
}
