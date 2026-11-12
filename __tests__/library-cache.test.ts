// A song added to or removed from the library is patched into the cached lists;
// nothing is refetched.
import { QueryClient } from '@tanstack/react-query'
import { addSongToLibraryCache, createAppQueryClient, removeSongFromLibraryCache } from '../app/lib/library-cache'
import { queryKeys } from '../app/lib/query-keys'
import { cacheLibraryData } from '../app/lib/offline-db'
import { forgetLastWritten } from '../app/lib/write-if-changed'

jest.mock('../app/lib/offline-db', () => ({ cacheLibraryData: jest.fn().mockResolvedValue(undefined) }))
beforeEach(() => { forgetLastWritten(); (cacheLibraryData as jest.Mock).mockClear() })

function seeded() {
    const qc = new QueryClient()
    qc.setQueryData(queryKeys.librarySongs, [{ uuid: 'a', properties: null }, { uuid: 'b', properties: null }])
    qc.setQueryData(queryKeys.library, [{ song_id: 'a' }, { song_id: 'b' }])
    return qc
}
const ids = (qc: QueryClient) => ({
    songs: (qc.getQueryData(queryKeys.librarySongs) as { uuid: string }[]).map(s => s.uuid),
    entries: (qc.getQueryData(queryKeys.library) as { song_id: string }[]).map(e => e.song_id),
})

describe('library cache patches', () => {
    it('adds a song to both lists', () => {
        const qc = seeded()
        addSongToLibraryCache(qc, { uuid: 'c', properties: null })
        expect(ids(qc)).toEqual({ songs: ['a', 'b', 'c'], entries: ['a', 'b', 'c'] })
    })

    it('does not add a song twice', () => {
        const qc = seeded()
        addSongToLibraryCache(qc, { uuid: 'a', properties: null })
        expect(ids(qc)).toEqual({ songs: ['a', 'b'], entries: ['a', 'b'] })
    })

    it('removes a song from both lists', () => {
        const qc = seeded()
        removeSongFromLibraryCache(qc, 'a')
        expect(ids(qc)).toEqual({ songs: ['b'], entries: ['b'] })
    })

    it('writes the patched list to the offline copy', async () => {
        const qc = seeded()
        addSongToLibraryCache(qc, { uuid: 'c', properties: null })
        await Promise.resolve()
        const [key, list] = (cacheLibraryData as jest.Mock).mock.calls[0]
        expect(key).toBe('library-songs')
        expect((list as { uuid: string }[]).map(s => s.uuid)).toEqual(['a', 'b', 'c'])
        removeSongFromLibraryCache(qc, 'a')
        await Promise.resolve()
        const [, after] = (cacheLibraryData as jest.Mock).mock.calls[1]
        expect((after as { uuid: string }[]).map(s => s.uuid)).toEqual(['b', 'c'])
    })

    it('does not write an offline copy of a list that was never loaded', () => {
        addSongToLibraryCache(new QueryClient(), { uuid: 'c', properties: null })
        expect(cacheLibraryData).not.toHaveBeenCalled()
    })

    it('removing while the list is not loaded asks for it again instead of inventing an empty one', () => {
        const qc = new QueryClient()
        const spy = jest.spyOn(qc, 'invalidateQueries')
        removeSongFromLibraryCache(qc, 'a')
        expect(qc.getQueryData(queryKeys.librarySongs)).toBeUndefined()
        expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.librarySongs })
    })

    it('leaves a list alone that was never loaded, so nothing is invented', () => {
        const qc = new QueryClient()
        addSongToLibraryCache(qc, { uuid: 'c', properties: null })
        expect(qc.getQueryData(queryKeys.librarySongs)).toBeUndefined()
    })
})

describe('app query client', () => {
    it('keeps the library, playlists and drafts fresh for 5 minutes', async () => {
        const qc = createAppQueryClient()
        for (const key of [queryKeys.library, queryKeys.librarySongs, queryKeys.playlists, queryKeys.drafts]) {
            expect(qc.getQueryDefaults(key).staleTime).toBe(300000)
        }
    })

    it('does not refetch a fresh library when asked again', async () => {
        const qc = createAppQueryClient()
        const fn = jest.fn().mockResolvedValue([])
        await qc.fetchQuery({ queryKey: queryKeys.librarySongs, queryFn: fn })
        await qc.fetchQuery({ queryKey: queryKeys.librarySongs, queryFn: fn })
        expect(fn).toHaveBeenCalledTimes(1)
    })
})
