'use client'
import { useEffect, useMemo, useRef, useState } from "react";

function useIsDesktop() {
    const [isDesktop, setIsDesktop] = useState(false)
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 768px)')
        setIsDesktop(mq.matches)
        const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
        mq.addEventListener('change', handler)
        return () => mq.removeEventListener('change', handler)
    }, [])
    return isDesktop
}
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadedSong, LibraryEntry, downloadSongViaUrl, downloadSongToFile, addToLibrary, fetchLibrary, tagSong, toPlayableSong } from "../lib/data";
import { queryKeys } from "../lib/query-keys";
import { usePlayer } from "./player";
import { useSettings } from "../lib/use-settings";
import { routes } from "../lib/routes";
import Song from "./song";
import Spinner from "./spinner";
import { FaX } from "react-icons/fa6";

export default function Songs({ songs: initialSongs }: { songs: DownloadedSong[] }) {
    const isDesktop = useIsDesktop()
    const noActiveIndex = -1
    const [songs, setSongs] = useState<DownloadedSong[]>(initialSongs)
    const [activeIndex, setActiveIndex] = useState(noActiveIndex)
    const [text, setText] = useState('')
    const [status, setStatus] = useState<'idle' | 'downloading' | 'tagging' | 'ready' | 'saving' | 'error'>('idle')
    const [errorMsg, setErrorMsg] = useState('')
    const [readySong, setReadySong] = useState<DownloadedSong | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const { play, playNow, current, onLibraryAdd } = usePlayer()
    const { settings } = useSettings()
    const queryClient = useQueryClient()
    const { data: libraryEntries = [] } = useQuery({
        queryKey: queryKeys.library,
        queryFn: fetchLibrary,
    })
    const libraryIds = useMemo(() => new Set(libraryEntries.map(e => e.song_id)), [libraryEntries])

    useEffect(() => {
        if (activeIndex !== noActiveIndex && status === 'idle') {
            setTimeout(() => inputRef.current?.focus(), 50)
        }
    }, [activeIndex, status])

    const downloaded = songs.filter(s => s.songId !== undefined)
    const fromItunes = songs.filter(s => s.songId === undefined)
    const activeSong = activeIndex !== noActiveIndex ? songs[activeIndex] : undefined
    const isDownloading = status === 'downloading' || status === 'tagging' || status === 'saving'

    function dismiss() {
        setActiveIndex(noActiveIndex)
        setText('')
        setStatus('idle')
        setErrorMsg('')
        setReadySong(null)
    }

    async function handleAddToLibrary() {
        if (!readySong?.songId) return
        setStatus('saving')
        try {
            await addToLibrary(readySong.songId)
            queryClient.setQueryData<LibraryEntry[]>(queryKeys.library, prev =>
                [...(prev ?? []), { song_id: readySong.songId!, added_at: new Date().toISOString(), last_position: 0, last_played_at: null }]
            )
            onLibraryAdd({ uuid: readySong.songId!, properties: readySong.properties })
            dismiss()
        } catch {
            setStatus('error')
            setErrorMsg('could not add to library')
        }
    }

    async function handleDeviceDownload() {
        if (!readySong?.songId) return
        setStatus('saving')
        try {
            await downloadSongToFile(readySong.songId, readySong.properties.trackName, readySong.properties.artistName)
            dismiss()
        } catch {
            setStatus('error'); setErrorMsg('file download failed')
        }
    }

    async function handleSongDownload(e: React.FormEvent) {
        e.preventDefault()
        const song = songs[activeIndex]
        if (!song || !text.trim()) return
        setStatus('downloading')
        setErrorMsg('')
        try {
            const result = await downloadSongViaUrl(text, false, settings.audio_format)
            if (!result || result.song_ids.length === 0) {
                setStatus('error'); setErrorMsg('download failed'); return
            }
            const songId = result.song_ids[0]
            if (result.cached) {
                const existing = songs.find(s => s.songId === songId) ?? { ...song, songId }
                setReadySong(existing)
                setStatus('ready')
                return
            }
            setStatus('tagging')
            const tagged = await tagSong(songId, song.properties)
            if (!tagged) { setStatus('error'); setErrorMsg('tagging failed'); return }
            const updated = { ...song, songId }
            setSongs(prev => prev.map((s, i) => i === activeIndex ? updated : s))
            setReadySong(updated)
            setStatus('ready')
        } catch {
            setStatus('error'); setErrorMsg('download failed')
        }
    }

    function renderSection(sectionSongs: DownloadedSong[], label: string) {
        if (sectionSongs.length === 0) return null
        return (
            <div className="py-2">
                <p className="text-gray-400 text-sm pb-2">{label}</p>
                <div className={isDesktop
                    ? "grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2 md:gap-6"
                    : "flex flex-col"
                }>
                    {sectionSongs.map((song, i) => {
                        const globalIndex = songs.indexOf(song)
                        return (
                            <Song
                                key={globalIndex}
                                song={song}
                                selected={song.songId ? current?.uuid === song.songId : activeIndex === globalIndex}
                                onClick={() => {
                                    if (song.songId) {
                                        // Source href captures the current URL so navigating back restores the user's
                                        // search results / page state (e.g. /download/song?query=foo).
                                        const here = typeof window !== 'undefined'
                                            ? window.location.pathname + window.location.search
                                            : routes.download
                                        const ctx = { label: 'Downloads', href: here, id: 'downloads' }
                                        const q = downloaded.filter(s => s.songId).map(s => toPlayableSong(s, ctx))
                                        playNow(toPlayableSong(song, ctx))
                                    } else {
                                        setActiveIndex(globalIndex)
                                        setStatus('idle')
                                        setErrorMsg('')
                                        setReadySong(null)
                                    }
                                }}
                                inLibrary={song.songId ? libraryIds.has(song.songId) : false}
                                isPrivate={!!song.owner_id}
                                showSource={true}
                                compact={!isDesktop}
                            />
                        )
                    })}
                </div>
            </div>
        )
    }

    return (
        <div className={activeSong ? 'pb-24' : ''}>
            {songs.length === 0
                ? <p>no songs found.</p>
                : <>
                    {renderSection(downloaded, "downloaded")}
                    {renderSection(fromItunes, "matches")}
                </>
            }

            {activeSong && (
                <div className="fixed left-0 right-0 z-[55] bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 shadow-2xl" style={{ bottom: 'var(--player-bar-h, 0px)' }}>
                    {status === 'ready' ? (
                        <div className="flex items-center gap-3 px-4 py-3">
                            <button type="button" onClick={dismiss} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0 transition-colors">
                                <FaX size={11} />
                            </button>
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate">{activeSong.properties.trackName}</p>
                                <p className="text-xs text-gray-400">ready — what would you like to do?</p>
                            </div>
                            <button
                                onClick={handleAddToLibrary}
                                className="text-sm px-3 py-1.5 bg-sky-500 text-white rounded-lg hover:bg-sky-600 transition-colors shrink-0"
                            >
                                add to library
                            </button>
                            <button
                                onClick={handleDeviceDownload}
                                className="text-sm px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors shrink-0"
                            >
                                download file
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSongDownload} className="flex items-center gap-3 px-4 py-3">
                            <button type="button" onClick={dismiss} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0 transition-colors">
                                <FaX size={11} />
                            </button>
                            <div className="min-w-0 hidden sm:block shrink-0 w-40">
                                <p className="text-sm font-medium truncate">{activeSong.properties.trackName}</p>
                                <p className="text-xs text-gray-400 truncate">{activeSong.properties.artistName}</p>
                            </div>
                            <input
                                ref={inputRef}
                                type="url"
                                placeholder="paste audio url…"
                                value={text}
                                disabled={isDownloading}
                                onChange={e => { setText(e.target.value); if (status === 'error') { setStatus('idle'); setErrorMsg('') } }}
                                className="flex-1 text-base md:text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-transparent focus:outline-none focus:ring-1 focus:ring-sky-500 min-w-0 disabled:opacity-50"
                            />
                            {isDownloading ? (
                                <div className="flex items-center gap-2 shrink-0">
                                    <Spinner />
                                    <span className="text-xs text-gray-400">
                                        {status === 'tagging' ? 'tagging…' : status === 'saving' ? 'saving…' : 'downloading…'}
                                    </span>
                                </div>
                            ) : status === 'error' ? (
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-xs text-red-500">{errorMsg}</span>
                                    <button type="submit" className="text-xs px-3 py-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">
                                        retry
                                    </button>
                                </div>
                            ) : (
                                <button
                                    type="submit"
                                    disabled={!text}
                                    className="text-sm px-3 py-1.5 bg-sky-500 text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-sky-600 transition-colors shrink-0"
                                >
                                    download
                                </button>
                            )}
                        </form>
                    )}
                </div>
            )}
        </div>
    )
}
