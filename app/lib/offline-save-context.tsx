'use client'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { LibrarySong, artworkUrl, songArtworkUrl } from './data'
import { saveSongsOffline, reportSaveResult, getCachedSongIds, cacheArtworkUrls } from './offline'
import { useToast } from '../components/toast'

interface OfflineSaveProgress {
    done: number
    total: number
}

// An empty `cachedIds` means three different things and they need different
// behaviour, so the set alone is not enough to read. `unavailable`: there is no
// provider above this consumer, as on the public share page. `unscanned`: the
// provider is there but the launch scan has not finished. `scanned`: the set is
// the truth. Only "scanned and empty" means the user really has nothing saved.
export type CachedIdsStatus = 'unavailable' | 'unscanned' | 'scanned'

interface OfflineSaveCtx {
    savingAll: boolean
    progress: OfflineSaveProgress
    failedIds: Set<string>
    clearFailedIds: () => void
    cachedIds: Set<string>
    cachedIdsStatus: CachedIdsStatus
    setCachedIds: React.Dispatch<React.SetStateAction<Set<string>>>
    cacheSongsById: (songList: LibrarySong[]) => Promise<Set<string>>
    refreshCachedIds: () => Promise<Set<string>>
}

const OfflineSaveContext = createContext<OfflineSaveCtx>({
    savingAll: false,
    progress: { done: 0, total: 0 },
    failedIds: new Set(),
    clearFailedIds: () => {},
    cachedIds: new Set(),
    cachedIdsStatus: 'unavailable',
    setCachedIds: () => {},
    cacheSongsById: async () => new Set(),
    refreshCachedIds: async () => new Set(),
})

export function OfflineSaveProvider({ children }: { children: React.ReactNode }) {
    const [savingAll, setSavingAll] = useState(false)
    const [progress, setProgress] = useState<OfflineSaveProgress>({ done: 0, total: 0 })
    const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
    const [cachedIds, setCachedIds] = useState<Set<string>>(new Set())
    const [cachedIdsStatus, setCachedIdsStatus] = useState<CachedIdsStatus>('unscanned')
    const { showToast } = useToast()

    // Scan at mount whichever page the session started on. Previously only the
    // library list and the settings page populated the set, so a session that
    // started anywhere else believed nothing was saved offline. Union rather
    // than replace: a save that completed while the scan was in flight has
    // already added its id.
    useEffect(() => {
        let cancelled = false
        getCachedSongIds(false).then(ids => {
            if (cancelled) return
            setCachedIds(prev => new Set([...prev, ...ids]))
            setCachedIdsStatus('scanned')
        }).catch(err => {
            // A scan that threw tells us nothing, so the status stays `unscanned`
            // and consumers keep their no-pre-filter behaviour. Logged so a
            // storage failure that disables the pre-filter is not silent.
            console.warn('offline scan failed; offline advance will not pre-filter', err)
        })
        return () => { cancelled = true }
    }, [])

    useEffect(() => {
        if (!savingAll) return
        const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
        window.addEventListener('beforeunload', handler)
        return () => window.removeEventListener('beforeunload', handler)
    }, [savingAll])

    const cacheSongsById = useCallback(async (songList: LibrarySong[]) => {
        const byId = new Map(songList.map(s => [s.uuid, s]))
        setSavingAll(true)
        setProgress({ done: 0, total: songList.length })
        const result = await saveSongsOffline(songList.map(s => s.uuid), {
            onSaved: id => {
                setCachedIds(prev => new Set([...prev, id]))
                const song = byId.get(id)
                if (song?.properties) {
                    const artUrls = [
                        artworkUrl(song.properties.artworkUrl100, 400),
                        ...(song.artwork_cached ? [
                            songArtworkUrl(song.uuid, true, undefined, 200)!,
                            songArtworkUrl(song.uuid, true, undefined, 400)!,
                        ] : []),
                    ].filter(Boolean)
                    cacheArtworkUrls(artUrls)
                }
            },
            onSettled: () => setProgress(p => ({ ...p, done: p.done + 1 })),
        })
        setSavingAll(false)
        setFailedIds(result.failed)
        reportSaveResult(result, showToast)
        return result.failed
    }, [showToast])

    const clearFailedIds = useCallback(() => setFailedIds(new Set()), [])

    const refreshCachedIds = useCallback(async () => {
        const ids = await getCachedSongIds()
        setCachedIds(ids)
        setCachedIdsStatus('scanned')
        return ids
    }, [])

    return (
        <OfflineSaveContext.Provider value={{ savingAll, progress, failedIds, clearFailedIds, cachedIds, cachedIdsStatus, setCachedIds, cacheSongsById, refreshCachedIds }}>
            {children}
        </OfflineSaveContext.Provider>
    )
}

export function useOfflineSave(): OfflineSaveCtx {
    return useContext(OfflineSaveContext)
}
