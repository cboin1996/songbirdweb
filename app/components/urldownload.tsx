'use client'
import { useState, useEffect } from "react";
import { downloadSongViaUrl, downloadSongToFile, addToLibrary, Properties } from "../lib/data";
import Spinner from "./spinner";
import Image from "next/image";
import Link from "next/link";
import { routes } from "../lib/routes";
import { FaCheckCircle } from "react-icons/fa";
import { usePlayer } from "./player";
import { useSettings } from "../lib/use-settings";
import QueryError from "./query-error";

export default function DownloadViaUrl({ query }: { query: string }) {
    type Status = 'idle' | 'downloading' | 'ready' | 'saving' | 'done' | 'error'
    const [status, setStatus] = useState<Status>('idle')
    const [errorMsg, setErrorMsg] = useState('')
    const [lastError, setLastError] = useState<Error | null>(null)
    const [songId, setSongId] = useState<string | null>(null)
    const [properties, setProperties] = useState<Properties | null>(null)
    const [artworkCached, setArtworkCached] = useState(false)
    const [doneAction, setDoneAction] = useState<'library' | 'file' | null>(null)
    const { onLibraryAdd } = usePlayer()
    const { settings } = useSettings()

    useEffect(() => {
        if (!query) return
        startDownload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query])

    async function startDownload() {
        setStatus('downloading')
        setErrorMsg('')
        try {
            const result = await downloadSongViaUrl(query, true, settings.audio_format)
            if (!result || result.song_ids.length === 0) {
                setStatus('error'); setErrorMsg('download failed'); setLastError(new Error('empty response')); return
            }
            setSongId(result.song_ids[0])
            setProperties(result.properties ?? null)
            setArtworkCached(result.artwork_cached ?? false)
            setStatus('ready')
        } catch (e) {
            setStatus('error'); setErrorMsg('download failed'); setLastError(e instanceof Error ? e : new Error(String(e)))
        }
    }

    async function handleAddToLibrary() {
        if (!songId) return
        setStatus('saving')
        try {
            await addToLibrary(songId)
            if (properties) onLibraryAdd({ uuid: songId, properties, artwork_cached: artworkCached })
            setDoneAction('library'); setStatus('done')
        } catch (e) {
            setStatus('error'); setErrorMsg('could not add to library'); setLastError(e instanceof Error ? e : new Error(String(e)))
        }
    }

    async function handleDownloadToFile() {
        if (!songId) return
        setStatus('saving')
        try {
            await downloadSongToFile(songId, properties?.trackName ?? songId, properties?.artistName ?? '')
            setDoneAction('file'); setStatus('done')
        } catch (e) {
            setStatus('error'); setErrorMsg('file download failed'); setLastError(e instanceof Error ? e : new Error(String(e)))
        }
    }

    if (!query) return <p className="text-sm text-gray-400">no url provided</p>

    if (status === 'idle' || status === 'downloading') {
        return (
            <div className="flex items-center gap-2">
                <Spinner />
                <p className="text-sm text-gray-500">downloading…</p>
            </div>
        )
    }

    if (status === 'saving') {
        return (
            <div className="flex items-center gap-2">
                <Spinner />
                <p className="text-sm text-gray-500">saving…</p>
            </div>
        )
    }

    if (status === 'done') {
        return (
            <div className="flex items-center gap-3 py-3">
                {artworkCached && songId
                    ? <Image src={`/v1/songs/${songId}/artwork/thumb`} alt="" width={48} height={48} className="rounded shrink-0" unoptimized />
                    : <div className="w-12 h-12 rounded bg-gray-100 dark:bg-gray-800 shrink-0" />
                }
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{properties?.trackName ?? 'unknown track'}</p>
                    <p className="text-xs text-gray-400 truncate">{properties?.artistName ?? 'unknown artist'}</p>
                    <p className="text-xs text-green-500 mt-1 flex items-center gap-1">
                        <FaCheckCircle size={11} />
                        {doneAction === 'library' ? 'added to library' : 'file downloaded'}
                    </p>
                </div>
                {doneAction === 'library' && songId && (
                    <Link
                        href={`${routes.library}?song=${songId}`}
                        className="text-sm px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-sky-500 hover:text-sky-500 transition-colors shrink-0"
                    >
                        view in library
                    </Link>
                )}
            </div>
        )
    }

    if (status === 'error') {
        return <QueryError error={lastError ?? new Error(errorMsg)} retry={startDownload} message={errorMsg} />
    }

    return (
        <div className="flex items-center gap-3 py-3">
            {artworkCached && songId && (
                <Image src={`/v1/songs/${songId}/artwork/thumb`} alt="" width={48} height={48} className="rounded shrink-0" unoptimized />
            )}
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{properties?.trackName ?? 'unknown track'}</p>
                <p className="text-xs text-gray-400 truncate">{properties?.artistName ?? 'unknown artist'}</p>
                <p className="text-xs text-gray-400 mt-1">ready — what would you like to do?</p>
            </div>
            <button
                onClick={handleAddToLibrary}
                className="text-sm px-3 py-1.5 bg-sky-500 text-white rounded-lg hover:bg-sky-600 transition-colors shrink-0"
            >
                add to library
            </button>
            <button
                onClick={handleDownloadToFile}
                className="text-sm px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shrink-0"
            >
                download file
            </button>
        </div>
    )
}
