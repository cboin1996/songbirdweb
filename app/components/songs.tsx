'use client'
import { useEffect, useState } from "react";
import { DownloadedSong, downloadSongViaUrl, fetchLibrary, fetchSong, tagSong } from "../lib/data";
import Song from "./song";
import Input from "../components/input"
import Button from "../components/button"
import { FaX } from "react-icons/fa6";
import Spinner from "./spinner";

export default function Songs({ songs: initialSongs }: { songs: DownloadedSong[] }) {
    const statuses = {
        paste: "enter a url",
        downloading: "downloading",
        tagging: "tagging",
        taggingError: "tagging error, try again",
        urlDownloadError: "download error, try again",
        downloadFileError: "download error, try again",
        noSongSelected: "select a song first",
    }

    const noActiveIndex = -1
    const [songs, setSongs] = useState<DownloadedSong[]>(initialSongs)
    const [libraryIds, setLibraryIds] = useState<Set<string>>(new Set())
    const [activeIndex, setActiveIndex] = useState(noActiveIndex)
    const [status, setStatus] = useState("")
    const [text, setText] = useState('')

    useEffect(() => {
        fetchLibrary().then(entries => setLibraryIds(new Set(entries.map(e => e.song_id))))
    }, [])

    useEffect(() => {
        if (activeIndex === noActiveIndex) return
        handleSongSelection()
    }, [activeIndex])

    const downloaded = songs.filter(s => s.songId !== undefined)
    const fromItunes = songs.filter(s => s.songId === undefined)
    const activeSong = activeIndex !== noActiveIndex ? songs[activeIndex] : undefined
    const displayDownloadInput = activeSong !== undefined
    const isDownloading = status === statuses.downloading || status === statuses.tagging

    async function createDownloadFile(song: DownloadedSong) {
        if (song.songId === undefined) {
            setStatus(statuses.downloadFileError)
            return
        }
        const blob = await fetchSong(song.songId)
        if (blob === undefined) {
            setStatus(statuses.downloadFileError)
            return
        }
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${song.properties.trackName} - ${song.properties.artistName}.mp3`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)
        setText("")
        setActiveIndex(noActiveIndex)
    }

    async function handleSongSelection() {
        const song = songs[activeIndex]
        if (song.songId === undefined) {
            setStatus(statuses.paste)
            return
        }
        createDownloadFile(song)
    }

    async function handleSongDownload(e: React.ChangeEvent<HTMLFormElement>) {
        e.preventDefault()
        if (activeIndex === noActiveIndex) {
            setStatus(statuses.noSongSelected)
            return
        }
        const song = songs[activeIndex]
        setStatus(statuses.downloading)
        const result = await downloadSongViaUrl(text)
        if (result === undefined || result.song_ids.length === 0) {
            setStatus(statuses.urlDownloadError)
            return
        }
        setStatus(statuses.tagging)
        const songId = result.song_ids[0]
        const tagged = await tagSong(songId, song.properties)
        if (tagged === undefined) {
            setStatus(statuses.taggingError)
            return
        }
        const downloaded = { ...song, songId }
        setSongs(prev => prev.map((s, i) => i === activeIndex ? downloaded : s))
        createDownloadFile(downloaded)
    }

    function resetText(e: React.MouseEvent) {
        e.preventDefault()
        setText("")
    }

    function renderSection(sectionSongs: DownloadedSong[], label: string) {
        if (sectionSongs.length === 0) return null
        return (
            <div className="py-2">
                <p className="text-gray-400 text-sm pb-2">{label}</p>
                <div className="grid 2xl:grid-cols-4 xl:grid-cols-3 lg:grid-cols-2 md:gap-8 rounded-2xl justify-items-stretch">
                    {sectionSongs.map((song, i) => {
                        const globalIndex = songs.indexOf(song)
                        return (
                            <Song
                                key={globalIndex}
                                song={song}
                                selected={activeIndex === globalIndex}
                                onClick={() => setActiveIndex(globalIndex)}
                                inLibrary={song.songId ? libraryIds.has(song.songId) : false}
                            />
                        )
                    })}
                </div>
            </div>
        )
    }

    return (
        <div>
            {displayDownloadInput && (
                <div>
                    <form className="flex flex-row gap-2" onSubmit={handleSongDownload}>
                        <Input
                            placeholder={`${activeSong.properties.trackName} - ${activeSong.properties.artistName}`}
                            disabled={isDownloading}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
                            value={text}
                            type="url"
                            classAttrs="md:w-96 w-80"
                        />
                        <button onClick={resetText} type="button">
                            <FaX className="-mx-8 text-gray-700 hover:bg-gray-500 rounded-lg" />
                        </button>
                        <Button disabled={isDownloading || text === ""} text="download" />
                    </form>
                    <div className="flex flex-row gap-2 items-center">
                        <p>{status}</p>
                        {isDownloading && <Spinner />}
                        {status === statuses.downloadFileError && (
                            <Button text="retry" onClick={handleSongSelection} disabled={isDownloading} />
                        )}
                    </div>
                </div>
            )}
            {songs.length === 0
                ? <p>no songs found.</p>
                : <>
                    {renderSection(downloaded, "downloaded")}
                    {renderSection(fromItunes, "matches")}
                </>
            }
        </div>
    )
}
