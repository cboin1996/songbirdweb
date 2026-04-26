'use client'
import { useState } from "react";
import { addToLibrary, removeFromLibrary, downloadSongToFile, createShareToken, DownloadedSong, songArtworkUrl } from "../lib/data";
import { cacheSong, uncacheSong } from "../lib/offline";
import { FaDownload, FaBookmark, FaRegBookmark, FaPlay, FaPause, FaPlus, FaLink, FaCloudDownloadAlt, FaCheckCircle, FaEllipsisV } from "react-icons/fa";
import Image from "next/image";
import { usePlayer } from "./player";
import EditorModal from "./editor-modal";

export default function Song({ song, selected, onClick, inLibrary: initialInLibrary, cachedOffline: initialCachedOffline, onRemove, onCacheChange, compact, rank, isAdmin }: {
    song: DownloadedSong,
    selected: boolean,
    onClick: () => void,
    inLibrary: boolean,
    cachedOffline?: boolean,
    onRemove?: () => void,
    onCacheChange?: (songId: string, cached: boolean) => void,
    compact?: boolean,
    rank?: number,
    isAdmin?: boolean,
}) {
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

    async function handleOfflineToggle(e: React.MouseEvent) {
        e.stopPropagation()
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
            // silently fail — user sees no change
        }
        setOfflinePending(false)
    }

    async function handleShare(e: React.MouseEvent) {
        e.stopPropagation()
        if (!song.songId) return
        const result = await createShareToken(song.songId)
        if (!result) return
        await navigator.clipboard.writeText(`${window.location.origin}/share/${result.token}`)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    async function handleDownload(e: React.MouseEvent) {
        e.stopPropagation()
        if (!song.songId) return
        setDownloadError(false)
        const ok = await downloadSongToFile(song.songId, song.properties.trackName, song.properties.artistName)
        if (!ok) setDownloadError(true)
    }

    const actions = (
        <>
            <FaDownload
                className={song.songId ? 'text-green-700 cursor-pointer hover:text-green-500' : 'text-red-700'}
                onClick={song.songId ? handleDownload : undefined}
            />
            {song.songId && (
                <>
                    <div onClick={handlePlay} className="hover:text-sky-500 cursor-pointer text-gray-400">
                        {isCurrentSong && isPlaying ? <FaPause size={13} /> : <FaPlay size={13} />}
                    </div>
                    <div
                        onClick={handleLibraryToggle}
                        aria-disabled={libraryPending}
                        className="aria-disabled:opacity-40 hover:text-sky-500 cursor-pointer"
                    >
                        {inLibrary
                            ? <FaBookmark className="text-sky-500" />
                            : <FaRegBookmark className="text-gray-400" />
                        }
                    </div>
                    <div
                        onClick={e => { e.stopPropagation(); insertNext({ uuid: song.songId!, properties: song.properties }) }}
                        title="play next"
                        className="hover:text-sky-500 cursor-pointer text-gray-400"
                    >
                        <FaPlus size={11} />
                    </div>
                    <div
                        onClick={handleShare}
                        title="copy download link"
                        className={`cursor-pointer transition-colors ${copied ? 'text-green-500' : 'text-gray-400 hover:text-sky-500'}`}
                    >
                        <FaLink size={11} />
                    </div>
                    <div
                        onClick={handleOfflineToggle}
                        title={offlineCached ? 'remove offline copy' : 'save offline'}
                        className={`cursor-pointer transition-colors relative ${offlinePending ? 'opacity-50' : ''} ${offlineCached ? 'text-sky-500' : 'text-gray-400 hover:text-sky-500'}`}
                    >
                        {offlineCached ? <FaCheckCircle size={11} /> : <FaCloudDownloadAlt size={13} />}
                        {offlinePending && !offlineCached && offlineProgress > 0 && (
                            <span className="absolute -bottom-2 left-0 text-[8px] text-sky-500 leading-none">
                                {Math.round(offlineProgress * 100)}%
                            </span>
                        )}
                    </div>
                    <div className="relative">
                        <div
                            onClick={e => { e.stopPropagation(); setKebabOpen(o => !o) }}
                            title="more"
                            className="cursor-pointer text-gray-400 hover:text-sky-500"
                        >
                            <FaEllipsisV size={11} />
                        </div>
                        {kebabOpen && (
                            <div
                                className="absolute right-0 top-5 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[110px]"
                                onClick={e => e.stopPropagation()}
                            >
                                <button
                                    onClick={() => { setKebabOpen(false); setEditorOpen(true) }}
                                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                    Edit
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}
        </>
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
                    <div className="flex gap-3 items-center shrink-0">
                        {actions}
                    </div>
                </button>
            </>
        )
    }

    return (
        <>
            {modal}
            <button onClick={handleCardClick} className={`dark:hover:bg-gray-900 hover:bg-gray-200 rounded-md p-2 ${selected ? 'bg-gray-300 dark:bg-gray-800' : ''}`}>
                <div className="flex flex-row justify-between">
                    <div className="flew-row flex rounded-lg">
                        <div>
                            <Image className="rounded-md object-contain w-16 h-16 md:w-24 md:h-24" alt="" src={songArtworkUrl(song.songId, song.artworkCached, song.properties.artworkUrl100, 400) ?? ''} width={96} height={96} />
                        </div>
                        <div className="flex flex-col px-3">
                            <span className="text-lg md:text-2xl font-medium text-left">{song.properties.trackName}</span>
                            <span className="font-medium text-sky-500 text-left">{`${song.properties.artistName} · ${song.properties.collectionName}`}</span>
                            <span className="flex gap-2 font-medium text-gray-500">
                                <span>{`${song.properties.trackNumber} of ${song.properties.trackCount}`}</span>
                                <span>·</span>
                                <span>{song.properties.releaseDate}</span>
                            </span>
                            {libraryError && <span className="text-red-500 text-sm">library error, try again</span>}
                            {downloadError && <span className="text-red-500 text-sm">download failed, try again</span>}
                        </div>
                    </div>
                    <div className="flex flex-col gap-2 items-center justify-center min-w-6">
                        {actions}
                    </div>
                </div>
            </button>
        </>
    )
}
