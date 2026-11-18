// Library changes made in this app are written straight into the query cache,
// not followed by a refetch of the whole 1000-song list.
import { QueryClient } from '@tanstack/react-query'
import type { LibraryEntry, LibrarySong, Properties } from './data'
import { queryKeys } from './query-keys'
import { cacheLibraryData } from './offline-db'
import { writeIfChanged } from './write-if-changed'

/** The app's query client: lists stay fresh for five minutes, the rest for thirty seconds. */
export function createAppQueryClient(): QueryClient {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } })
    for (const key of [queryKeys.library, queryKeys.librarySongs, queryKeys.playlists, queryKeys.drafts]) {
        qc.setQueryDefaults(key, { staleTime: LIST_STALE_MS })
    }
    return qc
}

/** Library, playlists and drafts stay fresh this long; focus refetch only fires after it. */
export const LIST_STALE_MS = 5 * 60_000

// A patch (setQueryData) clears a query's "stale" mark. A list nobody is watching may have been
// marked stale by a write made elsewhere (a finished import); patching it must not hide that, or
// the next library mount would trust the list and miss the change.
function patch<T>(qc: QueryClient, key: readonly unknown[], updater: (prev: T | undefined) => T | undefined): void {
    const wasStale = qc.getQueryState(key)?.isInvalidated === true
    qc.setQueryData<T>(key, updater)
    if (wasStale) void qc.invalidateQueries({ queryKey: key, exact: true, refetchType: 'none' })
}

export function addSongToLibraryCache(
    qc: QueryClient,
    song: { uuid: string; properties: Properties | null; artwork_cached?: boolean; artwork_updated_at?: number | null },
): void {
    const now = new Date().toISOString()
    patch<LibrarySong[]>(qc, queryKeys.librarySongs, prev => {
        if (!prev || prev.some(s => s.uuid === song.uuid)) return prev
        return [...prev, {
            uuid: song.uuid, url: '', properties: song.properties, artwork_cached: song.artwork_cached ?? false, artwork_updated_at: song.artwork_updated_at ?? null,
            parent_song_id: null, root_song_id: null, owner_id: null, added_at: now, last_position: 0, last_played_at: null,
        }]
    })
    patch<LibraryEntry[]>(qc, queryKeys.library, prev => {
        if (!prev || prev.some(e => e.song_id === song.uuid)) return prev
        return [...prev, { song_id: song.uuid, added_at: now, last_position: 0, last_played_at: null }]
    })
    // The server lists a song's draft only while the song is in the library, so adding may
    // bring a draft back.
    void qc.invalidateQueries({ queryKey: queryKeys.drafts })
    storePatchedList(qc)
}

// The offline copy of the list follows the patch, so the list shown offline and the
// player's launch lookup have the song without waiting for the next refetch.
function storePatchedList(qc: QueryClient): void {
    const list = qc.getQueryData<LibrarySong[]>(queryKeys.librarySongs)
    if (list && typeof window !== 'undefined') void writeIfChanged('library-songs', list, cacheLibraryData)
}

export function removeSongFromLibraryCache(qc: QueryClient, songId: string): void {
    removeSongsFromLibraryCache(qc, [songId])
}

// Several songs at once (bulk remove): one pass over each list and one write of the stored copy,
// not one per song.
export function removeSongsFromLibraryCache(qc: QueryClient, songIds: string[]): void {
    if (songIds.length === 0) return
    const gone = new Set(songIds)
    // The list is not loaded yet (stored rows are showing as a placeholder): there is nothing
    // to patch, and the request in flight may still carry the songs. Ask again.
    if (qc.getQueryData(queryKeys.librarySongs) === undefined) {
        void qc.invalidateQueries({ queryKey: queryKeys.librarySongs })
    }
    patch<LibrarySong[]>(qc, queryKeys.librarySongs, prev => prev?.filter(s => !gone.has(s.uuid)))
    patch<LibraryEntry[]>(qc, queryKeys.library, prev => prev?.filter(e => !gone.has(e.song_id)))
    // A removed song can no longer be published, and the server lists drafts only for songs in
    // the library; drop both with no request.
    patch<{ uuid: string }[]>(qc, queryKeys.eligibleSongs, prev => prev?.filter(s => !gone.has(s.uuid)))
    patch<{ song_id: string }[]>(qc, queryKeys.drafts, prev => prev?.filter(d => !gone.has(d.song_id)))
    storePatchedList(qc)
}
