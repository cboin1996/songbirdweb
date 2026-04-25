'use client'
import { useState } from "react";
import { addToLibrary, removeFromLibrary, DownloadedSong } from "../lib/data";
import { FaDownload, FaBookmark, FaRegBookmark } from "react-icons/fa";

export default function Song({ song, selected, onClick, inLibrary: initialInLibrary }: {
    song: DownloadedSong,
    selected: boolean,
    onClick: any,
    inLibrary: boolean,
}) {
    const [inLibrary, setInLibrary] = useState(initialInLibrary)
    const [libraryPending, setLibraryPending] = useState(false)
    const [libraryError, setLibraryError] = useState(false)
    const downloadColor = song.songId !== undefined ? "text-green-700" : "text-red-700"

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
        } else {
            setLibraryError(true)
        }
        setLibraryPending(false)
    }

    return (
        <button onClick={onClick} disabled={selected} className="dark:disabled:bg-gray-800 dark:hover:bg-gray-900 hover:bg-gray-200 disabled:bg-gray-300 rounded-md p-2">
            <div className="flex flex-row justify-between">
                <div className="flew-row flex rounded-lg">
                    <div>
                        <img className="min-w-24 rounded-md object-contain" alt="" src={song.properties.artworkUrl100} />
                    </div>
                    <div className="flex flex-col px-3">
                        <span className="text-2xl font-medium text-left">{song.properties.trackName}</span>
                        <span className="font-medium text-sky-500 text-left">{`${song.properties.artistName} · ${song.properties.collectionName}`}</span>
                        <span className="flex gap-2 font-medium text-gray-500">
                            <span>{`${song.properties.trackNumber} of ${song.properties.trackCount}`}</span>
                            <span>·</span>
                            <span>{song.properties.releaseDate}</span>
                        </span>
                        {libraryError && <span className="text-red-500 text-sm">library error, try again</span>}
                    </div>
                </div>
                <div className="flex flex-col gap-2 items-center justify-center min-w-6">
                    <FaDownload className={downloadColor} />
                    {song.songId && (
                        <button
                            onClick={handleLibraryToggle}
                            disabled={libraryPending}
                            className="disabled:opacity-40 hover:text-sky-500"
                        >
                            {inLibrary
                                ? <FaBookmark className="text-sky-500" />
                                : <FaRegBookmark className="text-gray-400" />
                            }
                        </button>
                    )}
                </div>
            </div>
        </button>
    )
}
