'use client'
import { useEffect, useState } from "react";
import { downloadSongViaUrl, fetchSong } from "../lib/data";
import Button from "./button";

export default function DownloadViaUrl({ query, apiKey }: { query: string | undefined, apiKey: string }) {
    const statuses = {
        downloading: "downloading",
        urlDownloadError: "error occurred while downloading",
        unspecifiedQuery: "you must fill a value",
        creatingLink: "creating download link",
        done: "download complete"
    }
    const [status, setStatus] = useState(statuses.downloading)
    const [queryValue, setQueryValue] = useState(query)
    async function createDownloadFile(event?: any) {
        if (query === undefined) {
            setStatus(statuses.unspecifiedQuery)
            return
        }
        const result = await downloadSongViaUrl(query, apiKey, true)
        if (result === undefined) {
            setStatus(statuses.urlDownloadError)
            return
        }
        if (result.song_ids.length === 0) {
            setStatus(statuses.urlDownloadError)
        }
        const songId = result.song_ids[0]
        setStatus(statuses.creatingLink)
        const song = await fetchSong(songId, apiKey)
        const url: string = window.URL.createObjectURL(song)
        const link: HTMLAnchorElement = document.createElement('a');
        link.href = url
        link.download = `${songId}.mp3`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)
        setStatus(statuses.done)
    }

    useEffect(() => {
        createDownloadFile()
    }, [])

    return (
        <div>
            {
                status === statuses.urlDownloadError ? (
                    <div className="flex flex-row gap-2">
                    <p>{status}</p>
                    <Button text="retry" onClick={createDownloadFile} disabled={status === statuses.downloading}></Button>
                    </div>
                ) : (
                    <p>{status}</p>
                )
            }
        </div>
    )
}
