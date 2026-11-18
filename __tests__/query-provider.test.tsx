import { render } from '@testing-library/react'
import { useQueryClient, QueryClient } from '@tanstack/react-query'
import QueryProvider from '../app/components/query-provider'
import { EVENTS } from '../app/lib/events'
import { queryKeys } from '../app/lib/query-keys'

// The editor is its own page, so a draft saved there changes drafts while the library (and the
// edits icon that listens) is not mounted. The cached list must still be marked stale.
describe('QueryProvider', () => {
    it('marks the cached drafts stale when a draft is saved, with no library on screen', () => {
        let qc!: QueryClient
        function Grab() { qc = useQueryClient(); return null }
        render(<QueryProvider><Grab /></QueryProvider>)
        qc.setQueryData(queryKeys.drafts, [])
        expect(qc.getQueryState(queryKeys.drafts)?.isInvalidated).toBe(false)
        window.dispatchEvent(new CustomEvent(EVENTS.draftChanged))
        expect(qc.getQueryState(queryKeys.drafts)?.isInvalidated).toBe(true)
    })

    it('a discard announces itself twice; only the first asks again', () => {
        let qc!: QueryClient
        function Grab() { qc = useQueryClient(); return null }
        render(<QueryProvider><Grab /></QueryProvider>)
        const spy = jest.spyOn(qc, 'invalidateQueries')
        window.dispatchEvent(new CustomEvent(EVENTS.draftChanged))
        window.dispatchEvent(new CustomEvent(EVENTS.draftChanged, { detail: { deleted: 'x' } }))
        expect(spy).toHaveBeenCalledTimes(1)
    })

    it('marks the library list stale when offline copies are cleared elsewhere', () => {
        let qc!: QueryClient
        function Grab() { qc = useQueryClient(); return null }
        render(<QueryProvider><Grab /></QueryProvider>)
        qc.setQueryData(queryKeys.librarySongs, [])
        window.dispatchEvent(new CustomEvent(EVENTS.offlineCleared))
        expect(qc.getQueryState(queryKeys.librarySongs)?.isInvalidated).toBe(true)
    })
})
