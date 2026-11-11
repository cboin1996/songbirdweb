'use client'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
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
    // The saved list as of this instant, for code that acts on it between renders.
    savedNow: () => Set<string>
    // A song whose file turned out to be missing is no longer saved. Built on the
    // list as it is when this runs, so a save that finished a moment ago is not undone.
    dropSaved: (songId: string) => void
    cacheSongsById: (songList: LibrarySong[]) => Promise<Set<string>>
    refreshCachedIds: () => Promise<Set<string>>
    // The saved list once the launch scan has settled, for a page that wants it
    // without opening every file again: it includes the saves and drops since launch.
    // If the launch scan failed, this runs a scan of its own.
    readSavedAfterLaunch: () => Promise<Set<string>>
}

const OfflineSaveContext = createContext<OfflineSaveCtx>({
    savingAll: false,
    progress: { done: 0, total: 0 },
    failedIds: new Set(),
    clearFailedIds: () => {},
    cachedIds: new Set(),
    cachedIdsStatus: 'unavailable',
    setCachedIds: () => {},
    savedNow: () => new Set(),
    dropSaved: () => {},
    cacheSongsById: async () => new Set(),
    refreshCachedIds: async () => new Set(),
    readSavedAfterLaunch: async () => new Set(),
})

export function OfflineSaveProvider({ children }: { children: React.ReactNode }) {
    const [savingAll, setSavingAll] = useState(false)
    const [progress, setProgress] = useState<OfflineSaveProgress>({ done: 0, total: 0 })
    const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
    const [cachedIds, setCachedIdsState] = useState<Set<string>>(new Set())
    const [cachedIdsStatus, setCachedIdsStatus] = useState<CachedIdsStatus>('unscanned')
    const { showToast } = useToast()

    // The saved list lives in a ref as well as in state. State is a render behind, and
    // the player acts on the list the moment it drops a song, and a page that waits for
    // the launch scan reads it the moment the scan settles. Every change goes through
    // here, so the ref is always the latest and updates compose.
    const cachedRef = useRef<Set<string>>(new Set())
    const setCachedIds = useCallback((action: React.SetStateAction<Set<string>>) => {
        const next = typeof action === 'function' ? action(cachedRef.current) : action
        cachedRef.current = next
        setCachedIdsState(next)
    }, [])

    const savedNow = useCallback(() => cachedRef.current, [])
    const dropSaved = useCallback((songId: string) => {
        if (!cachedRef.current.has(songId)) return
        console.debug('saved song has no playable file; no longer listed as saved', songId)
        setCachedIds(prev => {
            const next = new Set(prev)
            next.delete(songId)
            return next
        })
    }, [setCachedIds])

    // Settles once, when the launch scan has finished or failed.
    const scanSettledRef = useRef<{ promise: Promise<boolean>; settle: (ok: boolean) => void } | null>(null)
    if (!scanSettledRef.current) {
        let settle!: (ok: boolean) => void
        const promise = new Promise<boolean>(resolve => { settle = resolve })
        scanSettledRef.current = { promise, settle }
    }

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
            scanSettledRef.current!.settle(true)
        }).catch(err => {
            // A scan that threw tells us nothing, so the status stays `unscanned`
            // and consumers keep their no-pre-filter behaviour. Logged so a
            // storage failure that disables the pre-filter is not silent.
            console.warn('offline scan failed; offline advance will not pre-filter', err)
            scanSettledRef.current!.settle(false)
        })
        return () => { cancelled = true }
    }, [setCachedIds])

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
    }, [showToast, setCachedIds])

    const clearFailedIds = useCallback(() => setFailedIds(new Set()), [])

    const refreshCachedIds = useCallback(async () => {
        try {
            const ids = await getCachedSongIds()
            setCachedIds(ids)
            setCachedIdsStatus('scanned')
            return ids
        } catch (err) {
            // A scan that could not finish is not an empty list: keep what is known.
            console.warn('offline scan failed; keeping the saved list as it was', err)
            return cachedRef.current
        }
    }, [setCachedIds])

    const readSavedAfterLaunch = useCallback(async () => {
        const scanned = await scanSettledRef.current!.promise
        return scanned ? cachedRef.current : refreshCachedIds()
    }, [refreshCachedIds])

    return (
        <OfflineSaveContext.Provider value={{ savingAll, progress, failedIds, clearFailedIds, cachedIds, cachedIdsStatus, setCachedIds, savedNow, dropSaved, cacheSongsById, refreshCachedIds, readSavedAfterLaunch }}>
            {children}
        </OfflineSaveContext.Provider>
    )
}

export function useOfflineSave(): OfflineSaveCtx {
    return useContext(OfflineSaveContext)
}
