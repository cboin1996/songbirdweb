import { Page, Locator, expect } from '@playwright/test'
import { routes, downloadSongQuery, downloadAlbumQuery, downloadUrlQuery } from '../routes'

export class DownloadPage {
    readonly page: Page
    readonly songBtn: Locator
    readonly albumBtn: Locator
    readonly urlBtn: Locator
    readonly songCards: Locator

    constructor(page: Page) {
        this.page = page
        this.songBtn = page.getByRole('button', { name: 'song', exact: true })
        this.albumBtn = page.getByRole('button', { name: 'album', exact: true })
        this.urlBtn = page.getByRole('button', { name: 'url', exact: true })
        this.songCards = page.getByTestId('song-card')
    }

    async goto() {
        await this.page.goto(routes.download)
    }

    async gotoSongSearch(query: string) {
        await this.page.goto(downloadSongQuery(query))
    }

    async gotoAlbumSearch(query: string) {
        await this.page.goto(downloadAlbumQuery(query))
    }

    async gotoUrlDownload(url: string) {
        await this.page.goto(downloadUrlQuery(url))
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

    urlInput() {
        return this.page.locator('input[type="url"]')
    }
}
