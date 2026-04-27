'use client'
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { addToLibrary, removeFromLibrary, downloadSongToFile, createShareToken, DownloadedSong, songArtworkUrl, addSongToPlaylist } from "../lib/data";
import { cacheSong, uncacheSong } from "../lib/offline";
import { FaBookmark, FaRegBookmark, FaPlay, FaPause, FaEllipsisV, FaLock } from "react-icons/fa";
import Image from "next/image";
import { usePlayer } from "./player";
import EditorModal from "./editor-modal";
import { useUser } from "../lib/user-context";
import { useOnline } from "../lib/use-online";

export default function Song({ song, selected, onClick, inLibrary: initialInLibrary, cachedOffline: initialCachedOffline, onRemove, onCacheChange, compact, rank, editContext, onEditComplete, isPrivate, playlists, onPlaylistAdd, selectMode, isSelected, onSelect, onLongPress }: {
    song: DownloadedSong,
    selected: boolean,
    onClick: (e?: React.MouseEvent) => void,
    inLibrary: boolean,
    cachedOffline?: boolean,
    onRemove?: () => void,
    onCacheChange?: (songId: string, cached: boolean) => void,
    compact?: boolean,
    rank?: number,
    editContext?: { label: string; href: string },
    onEditComplete?: () => void,
    isPrivate?: boolean,
    playlists?: { id: string; name: string }[],
    onPlaylistAdd?: () => void,
    selectMode?: boolean,
    isSelected?: boolean,
    onSelect?: (songId: string) => void,
    onLongPress?: (songId: string) => void,
}) {
    const { isAdmin } = useUser()
    const online = useOnline()
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const [inLibrary, setInLibrary] = useState(initialInLibrary)
    const [libraryPending, setLibraryPending] = useState(false)
    const [libraryError, setLibraryError] = useState(false)
    const [downloadError, setDownloadError] = useState(false)
    const [copied, setCopied] = useState(false)
    const [offlineCached, setOfflineCached] = useState(initialCachedOffline ?? false)
    const [offlinePending, setOfflinePending] = useState(false)
    const [offlineProgress, setOfflineProgress] = useState(0)
    const [editorOpen, setEditorOpen] = useState(() => searchParams.get('edit') === song.songId)

    useEffect(() => {
        if (searchParams.get('edit') === song.songId) setEditorOpen(true)
    }, [searchParams, song.songId])
    const [kebabOpen, setKebabOpen] = useState(false)
    const [kebabPos, setKebabPos] = useState({ top: 0, right: 0 })
    const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false)
    const [addedToPlaylist, setAddedToPlaylist] = useState<string | null>(null)
    const kebabRef = useRef<HTMLButtonElement>(null)
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const { play, pause, resume, current, isPlaying, insertNext } = usePlayer()
    const isCurrentSong = current?.uuid === song.songId

    async function handleLibraryToggle(e: React.MouseEvent) {
        e.stopPropagation()
        if (!song.songId || libraryPending) return
        setLibraryPending(true)
        setLibraryError(false)
        const ok = inLibrary
            ? await removeFromLibrary(song.songId)
            : await addToLibrary(song.songId)
        if (ok) {
            setInLibrary(prev => !prev)
            if (inLibrary) onRemove?.()
        } else {
            setLibraryError(true)
        }
        setLibraryPending(false)
    }

    function handleCardClick(e?: React.MouseEvent) {
        if (selectMode) {
            if (song.songId && onSelect) onSelect(song.songId)
            return
        }
        if (song.songId && isCurrentSong) {
            if (isPlaying) pause()
            else resume()
        } else {
            onClick(e)
        }
    }

    function handleTouchStart() {
        if (!song.songId || !onLongPress) return
        longPressTimer.current = setTimeout(() => {
            longPressTimer.current = null
            onLongPress(song.songId!)
        }, 500)
    }

    function cancelLongPress() {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current)
            longPressTimer.current = null
        }
    }

    function handlePlay(e: React.MouseEvent) {
        e.stopPropagation()
        if (!song.songId) return
        if (isCurrentSong && isPlaying) pause()
        else if (isCurrentSong) resume()
        else onClick()
    }

    async function handleOfflineToggle() {
        if (!song.songId || offlinePending) return
        setOfflinePending(true)
        setOfflineProgress(0)
        try {
            if (offlineCached) {
                await uncacheSong(song.songId)
                setOfflineCached(false)
                onCacheChange?.(song.songId, false)
            } else {
                await cacheSong(song.songId, (pct) => setOfflineProgress(pct))
                setOfflineCached(true)
                onCacheChange?.(song.songId, true)
            }
        } catch {
            // silently fail
        }
        setOfflinePending(false)
    }

    async function handleShare() {
        if (!song.songId) return
        const result = await createShareToken(song.songId)
        if (!result) return
        await navigator.clipboard.writeText(`${window.location.origin}/share/${result.token}`)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    async function handleDownload() {
        if (!song.songId) return
        setDownloadError(false)
        const ok = await downloadSongToFile(song.songId, song.properties.trackName, song.properties.artistName)
        if (!ok) setDownloadError(true)
    }

    function openEditor() {
        setEditorOpen(true)
        const p = new URLSearchParams(searchParams.toString())
        p.set('edit', song.songId!)
        router.replace(`${pathname}?${p.toString()}`, { scroll: false })
    }

    function closeEditor() {
        setEditorOpen(false)
        const p = new URLSearchParams(searchParams.toString())
        p.delete('edit')
        const qs = p.toString()
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }

    function openKebab(e: React.MouseEvent | React.TouchEvent) {
        e.stopPropagation()
        const rect = kebabRef.current?.getBoundingClientRect()
        if (rect) {
            const menuWidth = 155
            const rightEdge = window.innerWidth - rect.right
            setKebabPos({
                top: rect.bottom + 4,
                right: Math.max(0, Math.min(rightEdge, window.innerWidth - menuWidth - 4)),
            })
        }
        setKebabOpen(o => !o)
    }

    const kebabDropdown = kebabOpen && typeof document !== 'undefined' ? createPortal(
        <>
            <div className="fixed inset-0 z-40" onClick={() => setKebabOpen(false)} />
            <div
                data-testid="song-kebab-menu"
                className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[155px]"
                style={{ top: kebabPos.top, right: kebabPos.right }}
                onClick={e => e.stopPropagation()}
            >
                <button onClick={() => { setKebabOpen(false); handleDownload() }}
                    disabled={!online}
                    className="w-full text-left px-3 py-3 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation">
                    Download
                </button>
                <button onClick={() => { setKebabOpen(false); insertNext({ uuid: song.songId!, properties: song.properties }) }}
                    className="w-full text-left px-3 py-3 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-700 touch-manipulation">
                    Play next
                </button>
                <button onClick={() => { setKebabOpen(false); handleShare() }}
                    disabled={!online}
                    className="w-full text-left px-3 py-3 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation">
                    {copied ? 'Link copied!' : 'Copy share link'}
                </button>
                <button onClick={() => { setKebabOpen(false); handleOfflineToggle() }}
                    disabled={offlinePending || (!online && !offlineCached)}
                    className="w-full text-left px-3 py-3 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation">
                    {offlinePending
                        ? `Saving… ${offlineProgress > 0 ? Math.round(offlineProgress * 100) + '%' : ''}`
                        : offlineCached ? 'Remove offline copy' : 'Save offline'}
                </button>
                {playlists && playlists.length > 0 && (
                    <>
                        <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
                        <button
                            onClick={() => setPlaylistPickerOpen(o => !o)}
                            className="w-full text-left px-3 py-3 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-700 touch-manipulation flex items-center justify-between"
                        >
                            Add to playlist
                            <span className="text-gray-400 text-xs">{playlistPickerOpen ? '▲' : '▼'}</span>
                        </button>
                        {playlistPickerOpen && (
                            <div className="border-t border-gray-100 dark:border-gray-700">
                                {playlists.map(pl => (
                                    <button
                                        key={pl.id}
                                        onClick={async () => {
                                            if (!song.songId) return
                                            const ok = await addSongToPlaylist(pl.id, song.songId)
                                            if (ok) { setAddedToPlaylist(pl.name); setTimeout(() => setAddedToPlaylist(null), 2000); onPlaylistAdd?.() }
                                            setPlaylistPickerOpen(false)
                                            setKebabOpen(false)
                                        }}
                                        className="w-full text-left pl-5 pr-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 truncate text-gray-500 dark:text-gray-400"
                                    >
                                        {pl.name}
                                    </button>
                                ))}
                            </div>
                        )}
                    </>
                )}
                <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
                <button onClick={() => { setKebabOpen(false); openEditor() }}
                    disabled={!online}
                    className="w-full text-left px-3 py-3 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 active:bg-gray-100 dark:active:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation">
                    Edit
                </button>
            </div>
        </>,
        document.body
    ) : null

    const kebabMenu = song.songId ? (
        <div onClick={e => e.stopPropagation()}>
            <button ref={kebabRef} data-testid="song-kebab" onClick={openKebab} title="more" className="cursor-pointer text-gray-400 hover:text-sky-500 active:text-sky-500 p-2 -m-1 touch-manipulation">
                <FaEllipsisV size={12} />
            </button>
            {kebabDropdown}
        </div>
    ) : null

    const actions = (
        <div className="flex gap-3 items-center">
            {song.songId && (
                <button data-testid="song-play" onClick={handlePlay} className="hover:text-sky-500 cursor-pointer text-gray-400">
                    {isCurrentSong && isPlaying ? <FaPause size={13} /> : <FaPlay size={13} />}
                </button>
            )}
            {song.songId && (
                <button
                    data-testid="song-library-toggle"
                    onClick={handleLibraryToggle}
                    aria-disabled={libraryPending}
                    className="aria-disabled:opacity-40 hover:text-sky-500 cursor-pointer"
                >
                    {inLibrary
                        ? <FaBookmark className="text-sky-500" />
                        : <FaRegBookmark className="text-gray-400" />
                    }
                </button>
            )}
            {!song.songId && (
                <span className="text-red-700 text-xs">not downloaded</span>
            )}
            {kebabMenu}
        </div>
    )

    const checkboxOverlay = selectMode ? (
        <div className="absolute top-2 left-2 z-10 pointer-events-none">
            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${isSelected ? 'bg-sky-500 border-sky-500' : 'border-gray-400 bg-white/80 dark:bg-gray-900/80'}`}>
                {isSelected && (
                    <svg viewBox="0 0 12 10" className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="1,5 4.5,9 11,1" />
                    </svg>
                )}
            </div>
        </div>
    ) : null

    const modal = editorOpen && song.songId ? (
        <EditorModal
            songId={song.songId}
            properties={song.properties}
            artworkCached={song.artworkCached}
            parentSongId={song.parentSongId}
            rootSongId={song.rootSongId}
            isAdmin={isAdmin ?? false}
            editContext={editContext}
            onClose={closeEditor}
            onEditComplete={onEditComplete}
        />
    ) : null

    if (compact) {
        return (
            <>
                {modal}
                <div
                    data-testid="song-card"
                    onClick={e => handleCardClick(e)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleCardClick()}
                    onTouchStart={handleTouchStart}
                    onTouchEnd={cancelLongPress}
                    onTouchMove={cancelLongPress}
                    className={`relative flex items-center gap-3 w-full text-left rounded-md p-2 transition-colors cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-900 touch-manipulation ${isSelected ? 'bg-sky-50 dark:bg-sky-950/30' : selected ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
                >
                    {checkboxOverlay}
                    {rank !== undefined && (
                        <span className="text-gray-400 tabular-nums w-5 text-right shrink-0 text-sm">{rank}</span>
                    )}
                    <div className={`shrink-0 transition-all ${selectMode ? 'ml-7' : ''}`}>
                        {songArtworkUrl(song.songId, song.artworkCached, song.properties.artworkUrl100, 200) ? (
                            <Image src={songArtworkUrl(song.songId, song.artworkCached, song.properties.artworkUrl100, 200)!} alt="" width={36} height={36} className="rounded" />
                        ) : (
                            <div className="w-9 h-9 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-base">🎵</div>
                        )}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                        <span className={`text-sm font-medium truncate flex items-center gap-1 ${isCurrentSong ? 'text-sky-500' : ''}`}>
                            {isPrivate && <FaLock size={9} className="text-gray-400 shrink-0" />}
                            {song.properties.trackName || 'Unknown title'}
                        </span>
                        <span className="text-xs text-sky-500 truncate">{song.properties.artistName || 'Unknown artist'} · {song.properties.collectionName || 'Unknown album'}</span>
                    </div>
                    {!selectMode && (
                        <div onClick={e => e.stopPropagation()}>
                            {actions}
                        </div>
                    )}
                </div>
            </>
        )
    }

    return (
        <>
            {modal}
            <div
                data-testid="song-card"
                onClick={e => handleCardClick(e)}
                role="button"
                tabIndex={0}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleCardClick()}
                onTouchStart={handleTouchStart}
                onTouchEnd={cancelLongPress}
                onTouchMove={cancelLongPress}
                className={`relative dark:hover:bg-gray-900 hover:bg-gray-200 rounded-md p-2 w-full cursor-pointer touch-manipulation ${isSelected ? 'bg-sky-50 dark:bg-sky-950/30' : selected ? 'bg-gray-300 dark:bg-gray-800' : ''}`}
            >
                {checkboxOverlay}
                <div className="flex flex-row justify-between">
                    <div className={`flex flex-row rounded-lg min-w-0 transition-all ${selectMode ? 'ml-8' : ''}`}>
                        <div className="shrink-0">
                            {songArtworkUrl(song.songId, song.artworkCached, song.properties.artworkUrl100, 400) ? (
                                <Image className="rounded-md object-contain w-16 h-16 md:w-24 md:h-24" alt="" src={songArtworkUrl(song.songId, song.artworkCached, song.properties.artworkUrl100, 400)!} width={96} height={96} />
                            ) : (
                                <div className="rounded-md w-16 h-16 md:w-24 md:h-24 bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-2xl">🎵</div>
                            )}
                        </div>
                        <div className="flex flex-col px-3 min-w-0">
                            <span className="text-lg md:text-2xl font-medium text-left truncate flex items-center gap-1.5">
                                {isPrivate && <FaLock size={12} className="text-gray-400 shrink-0" />}
                                {song.properties.trackName || 'Unknown title'}
                            </span>
                            <span className="font-medium text-sky-500 text-left truncate">{`${song.properties.artistName || 'Unknown artist'} · ${song.properties.collectionName || 'Unknown album'}`}</span>
                            <span className="flex gap-2 font-medium text-gray-500">
                                <span>{song.properties.trackNumber && song.properties.trackCount ? `${song.properties.trackNumber} of ${song.properties.trackCount}` : '—'}</span>
                                <span>·</span>
                                <span>{song.properties.releaseDate || '—'}</span>
                            </span>
                            {libraryError && <span className="text-red-500 text-sm">library error, try again</span>}
                            {downloadError && <span className="text-red-500 text-sm">download failed, try again</span>}
                        </div>
                    </div>
                    {!selectMode && (
                        <div className="flex flex-col gap-2 items-center justify-center shrink-0 ml-2" onClick={e => e.stopPropagation()}>
                            {actions}
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}
