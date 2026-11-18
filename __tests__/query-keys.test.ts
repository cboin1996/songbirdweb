import { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '../app/lib/query-keys'

describe('queryKeys', () => {
    it('refreshing the library list also refreshes the publish-eligible list', async () => {
        const qc = new QueryClient()
        qc.setQueryData(queryKeys.librarySongs, [])
        qc.setQueryData(queryKeys.eligibleSongs, [])
        await qc.invalidateQueries({ queryKey: queryKeys.librarySongs })
        expect(qc.getQueryState(queryKeys.eligibleSongs)?.isInvalidated).toBe(true)
    })

    it('patching the library list exactly leaves the eligible list alone', () => {
        const qc = new QueryClient()
        qc.setQueryData(queryKeys.librarySongs, [{ uuid: 'a' }])
        qc.setQueryData(queryKeys.eligibleSongs, [{ uuid: 'b' }])
        qc.setQueryData<{ uuid: string }[]>(queryKeys.librarySongs, prev => prev?.filter(s => s.uuid !== 'a'))
        expect(qc.getQueryData(queryKeys.eligibleSongs)).toEqual([{ uuid: 'b' }])
    })
})
