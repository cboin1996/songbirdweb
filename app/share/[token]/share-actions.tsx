'use client'
import { useState } from 'react'
import { FaPlay, FaPause, FaBookmark, FaRegBookmark } from 'react-icons/fa'
import { addToLibrary, Properties } from '../../lib/data'
import { usePlayer } from '../../components/player'

export default function ShareActions({
    songId,
    properties,
    downloadUrl,
}: {
    songId: string
    properties: Properties
    downloadUrl: string
}) {
    const { play, pause, current, isPlaying } = usePlayer()
    const [inLibrary, setInLibrary] = useState(false)
    const [libraryPending, setLibraryPending] = useState(false)
    const isCurrentSong = current?.uuid === songId
    const playing = isCurrentSong && isPlaying

    async function handleLibrary() {
        if (libraryPending || inLibrary) return
        setLibraryPending(true)
        const ok = await addToLibrary(songId)
        if (ok) setInLibrary(true)
        setLibraryPending(false)
    }

    function handlePlay() {
        if (playing) {
            pause()
        } else if (isCurrentSong) {
            play({ uuid: songId, properties })
        } else {
            play({ uuid: songId, properties })
        }
    }

    return (
        <div className="flex flex-col items-center gap-3 w-full">
            <div className="flex items-center gap-3">
                <button
                    onClick={handlePlay}
                    className="flex items-center gap-2 px-6 py-3 bg-sky-500 hover:bg-sky-400 text-white rounded-full font-medium transition-colors text-sm"
                >
                    {playing ? <FaPause size={12} /> : <FaPlay size={12} />}
                    {playing ? 'Pause' : 'Play'}
                </button>
                <button
                    onClick={handleLibrary}
                    disabled={libraryPending || inLibrary}
                    className="flex items-center gap-2 px-5 py-3 rounded-full font-medium transition-colors text-sm border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-sky-500 hover:text-sky-500 disabled:opacity-50"
                >
                    {inLibrary ? <FaBookmark size={12} /> : <FaRegBookmark size={12} />}
                    {inLibrary ? 'Saved' : 'Save'}
                </button>
            </div>
            <a
                href={downloadUrl}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
                Download file
            </a>
        </div>
    )
}
