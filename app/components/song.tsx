'use client'
import { useState } from "react";
import { addToLibrary, removeFromLibrary, downloadSongToFile, DownloadedSong } from "../lib/data";
import { FaDownload, FaBookmark, FaRegBookmark, FaPlay, FaPause, FaPlus } from "react-icons/fa";
import Image from "next/image";
import { usePlayer } from "./player";

export default function Song({ song, selected, onClick, inLibrary: initialInLibrary, onRemove, compact, rank }: {
    song: DownloadedSong,
    selected: boolean,
    onClick: () => void,
    inLibrary: boolean,
    onRemove?: () => void,
    compact?: boolean,
    rank?: number,
}) {
    const [inLibrary, setInLibrary] = useState(initialInLibrary)
    const [libraryPending, setLibraryPending] = useState(false)
    const [libraryError, setLibraryError] = useState(false)
    const [downloadError, setDownloadError] = useState(false)
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
                </>
            )}
        </>
    )

    if (compact) {
        return (
            <button
                onClick={handleCardClick}
                className={`flex items-center gap-3 w-full text-left rounded-md p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-900 ${selected ? 'bg-gray-100 dark:bg-gray-800' : ''}`}
            >
                {rank !== undefined && (
                    <span className="text-gray-400 tabular-nums w-5 text-right shrink-0 text-sm">{rank}</span>
                )}
                {song.properties.artworkUrl100 && (
                    <Image src={song.properties.artworkUrl100} alt="" width={36} height={36} className="rounded shrink-0" />
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
        )
    }

    return (
        <button onClick={handleCardClick} className={`dark:hover:bg-gray-900 hover:bg-gray-200 rounded-md p-2 ${selected ? 'bg-gray-300 dark:bg-gray-800' : ''}`}>
            <div className="flex flex-row justify-between">
                <div className="flew-row flex rounded-lg">
                    <div>
                        <Image className="rounded-md object-contain w-16 h-16 md:w-24 md:h-24" alt="" src={song.properties.artworkUrl100} width={96} height={96} />
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
    )
}
