import { Page, Locator, expect } from '@playwright/test'
import { routes } from '../routes'

export class CommonPage {
    readonly page: Page
    readonly offlineBanner: Locator
    readonly logoutBtn: Locator
    readonly importDropzone: Locator
    readonly importFileInput: Locator
    readonly loginSubmit: Locator
    readonly versionCards: Locator
    readonly toast: Locator
    readonly toastError: Locator

    constructor(page: Page) {
        this.page = page
        this.offlineBanner = page.getByTestId('offline-banner')
        this.logoutBtn = page.getByRole('button', { name: 'Log out' })
        this.importDropzone = page.getByTestId('import-dropzone')
        this.importFileInput = page.getByTestId('import-file-input')
        this.loginSubmit = page.getByTestId('login-submit')
        this.versionCards = page.getByTestId('version-card')
        this.toast = page.getByTestId('toast')
        this.toastError = page.getByTestId('toast-error')
    }

    navLink(name: string) {
        return this.page.getByRole('link', { name }).first()
    }

    queryError(context: string) {
        return this.page.getByTestId(`query-error-${context.replace(/\s+/g, '-')}`)
    }

    async goOffline() {
        await this.page.context().setOffline(true)
        await this.page.evaluate(() => window.dispatchEvent(new Event('offline')))
    }

    async goOnline() {
        await this.page.context().setOffline(false)
    }
}
