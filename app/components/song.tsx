'use client'
import { useState } from "react";
import { addToLibrary, removeFromLibrary, downloadSongToFile, createShareToken, DownloadedSong, songArtworkUrl } from "../lib/data";
import { cacheSong, uncacheSong } from "../lib/offline";
import { FaBookmark, FaRegBookmark, FaPlay, FaPause, FaEllipsisV } from "react-icons/fa";
import Image from "next/image";
import { usePlayer } from "./player";
import EditorModal from "./editor-modal";
import { useUser } from "../lib/user-context";

export default function Song({ song, selected, onClick, inLibrary: initialInLibrary, cachedOffline: initialCachedOffline, onRemove, onCacheChange, compact, rank }: {
    song: DownloadedSong,
    selected: boolean,
    onClick: () => void,
    inLibrary: boolean,
    cachedOffline?: boolean,
    onRemove?: () => void,
    onCacheChange?: (songId: string, cached: boolean) => void,
    compact?: boolean,
    rank?: number,
}) {
    const { isAdmin } = useUser()
    const [inLibrary, setInLibrary] = useState(initialInLibrary)
    const [libraryPending, setLibraryPending] = useState(false)
    const [libraryError, setLibraryError] = useState(false)
    const [downloadError, setDownloadError] = useState(false)
    const [copied, setCopied] = useState(false)
    const [offlineCached, setOfflineCached] = useState(initialCachedOffline ?? false)
    const [offlinePending, setOfflinePending] = useState(false)
    const [offlineProgress, setOfflineProgress] = useState(0)
    const [editorOpen, setEditorOpen] = useState(false)
    const [kebabOpen, setKebabOpen] = useState(false)
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

    function handleCardClick() {
        if (song.songId && isCurrentSong) {
            if (isPlaying) pause()
            else resume()
        } else {
            onClick()
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

    const kebabMenu = song.songId ? (
        <div className="relative" onClick={e => e.stopPropagation()}>
            <button
                onClick={() => setKebabOpen(o => !o)}
                title="more"
                className="cursor-pointer text-gray-400 hover:text-sky-500 p-0.5"
            >
                <FaEllipsisV size={12} />
            </button>
            {kebabOpen && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setKebabOpen(false)} />
                    <div className="absolute right-0 top-6 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[150px]">
                        <button
                            onClick={() => { setKebabOpen(false); handleDownload() }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                            Download
                        </button>
                        <button
                            onClick={() => { setKebabOpen(false); insertNext({ uuid: song.songId!, properties: song.properties }) }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                            Play next
                        </button>
                        <button
                            onClick={() => { setKebabOpen(false); handleShare() }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                            {copied ? 'Link copied!' : 'Copy share link'}
                        </button>
                        <button
                            onClick={() => { setKebabOpen(false); handleOfflineToggle() }}
                            disabled={offlinePending}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
                        >
                            {offlinePending
                                ? `Saving… ${offlineProgress > 0 ? Math.round(offlineProgress * 100) + '%' : ''}`
                                : offlineCached ? 'Remove offline copy' : 'Save offline'}
                        </button>
                        <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
                        <button
                            onClick={() => { setKebabOpen(false); setEditorOpen(true) }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                            Edit
                        </button>
                    </div>
                </>
            )}
        </div>
    ) : null

    const actions = (
        <div className="flex gap-3 items-center">
            {song.songId && (
                <button onClick={handlePlay} className="hover:text-sky-500 cursor-pointer text-gray-400">
                    {isCurrentSong && isPlaying ? <FaPause size={13} /> : <FaPlay size={13} />}
                </button>
            )}
            {song.songId && (
                <button
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

    const modal = editorOpen && song.songId ? (
        <EditorModal
            songId={song.songId}
            properties={song.properties}
            artworkCached={song.artworkCached}
            isAdmin={isAdmin ?? false}
            onClose={() => setEditorOpen(false)}
        />
    ) : null

    if (compact) {
        return (
            <>
                {modal}
                <button
                    onClick={handleCardClick}
                    className={`flex items-center gap-3 w-full text-left rounded-md p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-900 ${selected ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
                >
                    {rank !== undefined && (
                        <span className="text-gray-400 tabular-nums w-5 text-right shrink-0 text-sm">{rank}</span>
                    )}
                    {song.properties.artworkUrl100 && (
                        <Image src={songArtworkUrl(song.songId, song.artworkCached, song.properties.artworkUrl100, 200) ?? ''} alt="" width={36} height={36} className="rounded shrink-0" />
                    )}
                    <div className="flex flex-col min-w-0 flex-1">
                        <span className={`text-sm font-medium truncate ${isCurrentSong ? 'text-sky-500' : ''}`}>
                            {song.properties.trackName}
                        </span>
                        <span className="text-xs text-sky-500 truncate">{song.properties.artistName} · {song.properties.collectionName}</span>
                    </div>
                    <div onClick={e => e.stopPropagation()}>
                        {actions}
                    </div>
                </button>
            </>
        )
    }

    return (
        <>
            {modal}
            <button onClick={handleCardClick} className={`dark:hover:bg-gray-900 hover:bg-gray-200 rounded-md p-2 w-full ${selected ? 'bg-gray-300 dark:bg-gray-800' : ''}`}>
                <div className="flex flex-row justify-between">
                    <div className="flex flex-row rounded-lg min-w-0">
                        <div className="shrink-0">
                            <Image className="rounded-md object-contain w-16 h-16 md:w-24 md:h-24" alt="" src={songArtworkUrl(song.songId, song.artworkCached, song.properties.artworkUrl100, 400) ?? ''} width={96} height={96} />
                        </div>
                        <div className="flex flex-col px-3 min-w-0">
                            <span className="text-lg md:text-2xl font-medium text-left truncate">{song.properties.trackName}</span>
                            <span className="font-medium text-sky-500 text-left truncate">{`${song.properties.artistName} · ${song.properties.collectionName}`}</span>
                            <span className="flex gap-2 font-medium text-gray-500">
                                <span>{`${song.properties.trackNumber} of ${song.properties.trackCount}`}</span>
                                <span>·</span>
                                <span>{song.properties.releaseDate}</span>
                            </span>
                            {libraryError && <span className="text-red-500 text-sm">library error, try again</span>}
                            {downloadError && <span className="text-red-500 text-sm">download failed, try again</span>}
                        </div>
                    </div>
                    <div className="flex flex-col gap-2 items-center justify-center shrink-0 ml-2" onClick={e => e.stopPropagation()}>
                        {actions}
                    </div>
                </div>
            </button>
        </>
    )
}
