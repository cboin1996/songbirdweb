'use client'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { LibrarySong, artworkUrl, songArtworkUrl, addServerOfflineSong } from './data'
import { cacheSong, uncacheSong, getCachedSongIds, cacheArtworkUrls } from './offline'

interface OfflineSaveProgress {
    done: number
    total: number
}

interface OfflineSaveCtx {
    savingAll: boolean
    progress: OfflineSaveProgress
    failedIds: Set<string>
    clearFailedIds: () => void
    cachedIds: Set<string>
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
    setCachedIds: () => {},
    cacheSongsById: async () => new Set(),
    refreshCachedIds: async () => new Set(),
})

export function OfflineSaveProvider({ children }: { children: React.ReactNode }) {
    const [savingAll, setSavingAll] = useState(false)
    const [progress, setProgress] = useState<OfflineSaveProgress>({ done: 0, total: 0 })
    const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
    const [cachedIds, setCachedIds] = useState<Set<string>>(new Set())

    useEffect(() => {
        if (!savingAll) return
        const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
        window.addEventListener('beforeunload', handler)
        return () => window.removeEventListener('beforeunload', handler)
    }, [savingAll])

    const cacheSongsById = useCallback(async (songList: LibrarySong[]) => {
        const failed = new Set<string>()
        setSavingAll(true)
        setProgress({ done: 0, total: songList.length })
        for (const song of songList) {
            try {
                await cacheSong(song.uuid)
                try {
                    await addServerOfflineSong(song.uuid)
                } catch {
                    await uncacheSong(song.uuid).catch(() => {})
                    failed.add(song.uuid)
                    setProgress(p => ({ ...p, done: p.done + 1 }))
                    continue
                }
                setCachedIds(prev => new Set([...prev, song.uuid]))
                if (song.properties) {
                    const artUrls = [
                        artworkUrl(song.properties.artworkUrl100, 400),
                        ...(song.artwork_cached ? [
                            songArtworkUrl(song.uuid, true, undefined, 200)!,
                            songArtworkUrl(song.uuid, true, undefined, 400)!,
                        ] : []),
                    ].filter(Boolean)
                    cacheArtworkUrls(artUrls)
                }
            } catch {
                failed.add(song.uuid)
            }
            setProgress(p => ({ ...p, done: p.done + 1 }))
        }
        setSavingAll(false)
        setFailedIds(failed)
        return failed
    }, [])

    const clearFailedIds = useCallback(() => setFailedIds(new Set()), [])

    const refreshCachedIds = useCallback(async () => {
        const ids = await getCachedSongIds()
        setCachedIds(ids)
        return ids
    }, [])

    return (
        <OfflineSaveContext.Provider value={{ savingAll, progress, failedIds, clearFailedIds, cachedIds, setCachedIds, cacheSongsById, refreshCachedIds }}>
            {children}
        </OfflineSaveContext.Provider>
    )
}

export function useOfflineSave(): OfflineSaveCtx {
    return useContext(OfflineSaveContext)
}
