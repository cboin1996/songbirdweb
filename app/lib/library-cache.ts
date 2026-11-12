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

export function addSongToLibraryCache(
    qc: QueryClient,
    song: { uuid: string; properties: Properties | null; artwork_cached?: boolean },
): void {
    const now = new Date().toISOString()
    qc.setQueryData<LibrarySong[]>(queryKeys.librarySongs, prev => {
        if (!prev || prev.some(s => s.uuid === song.uuid)) return prev
        return [...prev, {
            uuid: song.uuid, url: '', properties: song.properties, artwork_cached: song.artwork_cached ?? false,
            parent_song_id: null, root_song_id: null, owner_id: null, added_at: now, last_position: 0, last_played_at: null,
        }]
    })
    qc.setQueryData<LibraryEntry[]>(queryKeys.library, prev => {
        if (!prev || prev.some(e => e.song_id === song.uuid)) return prev
        return [...prev, { song_id: song.uuid, added_at: now, last_position: 0, last_played_at: null }]
    })
    storePatchedList(qc)
}

// The offline copy of the list follows the patch, so the list shown offline and the
// player's launch lookup have the song without waiting for the next refetch.
function storePatchedList(qc: QueryClient): void {
    const list = qc.getQueryData<LibrarySong[]>(queryKeys.librarySongs)
    if (list && typeof window !== 'undefined') void writeIfChanged('library-songs', list, cacheLibraryData)
}

export function removeSongFromLibraryCache(qc: QueryClient, songId: string): void {
    // The list is not loaded yet (stored rows are showing as a placeholder): there is nothing
    // to patch, and the request in flight may still carry the song. Ask again.
    if (qc.getQueryData(queryKeys.librarySongs) === undefined) {
        void qc.invalidateQueries({ queryKey: queryKeys.librarySongs })
    }
    qc.setQueryData<LibrarySong[]>(queryKeys.librarySongs, prev => prev?.filter(s => s.uuid !== songId))
    qc.setQueryData<LibraryEntry[]>(queryKeys.library, prev => prev?.filter(e => e.song_id !== songId))
    storePatchedList(qc)
}
