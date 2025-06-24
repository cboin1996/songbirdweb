'use client'
import { useEffect, useState } from "react";
import { DownloadedSong, downloadSongViaUrl, fetchSong, tagSong } from "../lib/data";
import Song from "./song";
import { useSearchParams } from "next/navigation";
import Input from "../components/input"
import Button from "../components/button"
import { FaX } from "react-icons/fa6";

export default function Songs({ songs }: { songs: DownloadedSong[] }) {
    let statuses = {
        paste: "enter a url",
        downloading: "downloading",
        tagging: "tagging",
        taggingError: "tagging error, try again",
        urlDownloadError: "download error, try again",
        downloadFileError: "download error, try again",
        noSongSelected: "you must select a song",
    }
    const searchParams = useSearchParams()

    const [selected, setSelected] = useState(false);
    const noActiveIndex = -1
    const [activeIndex, setActiveIndex] = useState(noActiveIndex);
    const [status, setStatus] = useState("")
    const [text, setText] = useState('')

    const api_key = searchParams.get("apiKey")!.toString()

    const displayDownloadInput = activeIndex !==  -1 && songs.length > 0
    const isDownloading = status === statuses.downloading || status === statuses.tagging

    // trigger handleSongSelection() on index selection change
    useEffect(() => {
        handleSongSelection()
    }, [activeIndex])

    async function createDownloadFile(song: DownloadedSong) {
        if (song.songId === undefined) {
            setStatus(statuses.downloadFileError)
            return
        }
        // simply return the song if already downloaded
        const result = await fetchSong(song.songId, api_key)
        const url: string = window.URL.createObjectURL(result)
        const link: HTMLAnchorElement = document.createElement('a');
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
        setSelected(true);
        if (activeIndex === noActiveIndex) {
            setStatus(statuses.noSongSelected)
            return
        }
        const song = songs[activeIndex]
        // update status for user as paste
        if (song.songId === undefined) {
            setStatus(statuses.paste)
            return
        }
        // simply return the song if already downloaded
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
        const result = await downloadSongViaUrl(text, api_key)
        if (result.song_ids === undefined || result.song_ids.length === 0) {
            setStatus(statuses.urlDownloadError)
            return
        }
        setStatus(statuses.tagging)
        const songId = result.song_ids[0]
        const taggingResult = await tagSong(
            result.song_ids[0],
            song.properties,
            api_key
        )
        if (taggingResult === undefined) {
            setStatus(statuses.taggingError)
        }
        createDownloadFile(
            {
                songId: songId,
                properties: song.properties
            }
        )
    }

    function resetText(e: any) {
        e.preventDefault()
        setText("")
    }

    return (
        <div>
            {
                displayDownloadInput ? (
                    <div>
                    <form className="flex flex-row gap-2" onSubmit={handleSongDownload}>
                        <Input
                            placeholder={`${songs[activeIndex].properties.trackName} - ${songs[activeIndex].properties.artistName}`}
                            disabled={isDownloading}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
                            value={text}
                            type="url"
                            classAttrs="md:w-96 w-80"
                        />
                        <button onClick={resetText} type="button">
                            <FaX className="-mx-8 text-gray-700 hover:bg-gray-500 rounded-lg"></FaX>
                        </button>
                        <Button
                            disabled={isDownloading || text === ""}
                            text="download"
                        >
                        </Button>
                    </form>
                    <p>{status}</p>
                    </div>
                ) : (<div />)
            }
            <div className="grid 2xl:grid-cols-4 xl:grid-cols-3 lg:grid-cols-2 md:gap-8 rounded-2xl justify-items-stretch py-2">
                {
                    songs.length > 0 ? (
                    songs.map((
                        song: DownloadedSong, i) => <Song key={i} song={song} selected={activeIndex === i} onClick={() => setActiveIndex(i)}></Song>
                    )
                    ) :
                    (
                        <p>no songs found.</p>
                    )
                }
            </div>
        </div>
    );
} 
