import { render, screen, waitFor, act } from '@testing-library/react'
import { OfflineSaveProvider, useOfflineSave } from '../app/lib/offline-save-context'
import { ToastProvider } from '../app/components/toast'
import { EVENTS } from '../app/lib/events'

jest.mock('../app/lib/offline', () => ({
    saveSongsOffline: jest.fn(),
    reportSaveResult: jest.fn(),
    cacheArtworkUrls: jest.fn(),
    getCachedSongIds: jest.fn().mockResolvedValue(new Set(['a', 'b'])),
}))

function Count() {
    const { cachedIds } = useOfflineSave()
    return <span data-testid="count">{cachedIds.size}</span>
}

// "Clear offline" runs on the settings page, where no library is mounted to hear it. The set of
// saved songs lives in this provider, so it has to empty itself.
describe('OfflineSaveProvider', () => {
    it('forgets the saved songs when offline copies are cleared', async () => {
        render(<ToastProvider><OfflineSaveProvider><Count /></OfflineSaveProvider></ToastProvider>)
        await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'))
        act(() => { window.dispatchEvent(new CustomEvent(EVENTS.offlineCleared)) })
        expect(screen.getByTestId('count').textContent).toBe('0')
    })
})
