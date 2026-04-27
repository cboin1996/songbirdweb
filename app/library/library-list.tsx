'use client'
import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import { LibrarySong, Playlist, artworkUrl, fetchLibrarySongs, fetchPlaylists, publishEligibleSongs } from "../lib/data"
import { cacheSong, getCachedSongIds } from "../lib/offline"
import Song from "../components/song"
import { usePlayer } from "../components/player"
import { routes } from "../lib/routes"
import { FaPlay, FaCloudDownloadAlt } from "react-icons/fa"
import PlaylistsView from "./playlists-view"
import EditsBanner from "./edits-banner"

type ViewMode = 'songs' | 'artists' | 'albums' | 'genres' | 'playlists'

const ALPHABET = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

interface LibraryAlbum {
    collectionId: string
    collectionName: string
    artistName: string
    artworkUrl100: string
    songs: LibrarySong[]
}

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

function letterKey(str: string): string {
    const first = str?.trim()[0]?.toUpperCase() ?? '#'
    return /[A-Z]/.test(first) ? first : '#'
}

function AlbumCard({ album, isCompact, onClick }: { album: LibraryAlbum; isCompact: boolean; onClick: () => void }) {
    if (isCompact) {
        return (
            <button
                onClick={onClick}
                className="flex items-center gap-3 w-full text-left rounded-md p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-900"
            >
                <Image src={artworkUrl(album.artworkUrl100, 200)} alt="" width={40} height={40} className="rounded shrink-0" />
                <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm font-medium truncate">{album.collectionName}</span>
                    <span className="text-xs text-sky-500 truncate">{album.artistName} · {album.songs.length} songs</span>
                </div>
                <FaPlay size={10} className="text-gray-300 dark:text-gray-600 shrink-0 mr-1" />
            </button>
        )
    }
    return (
        <button
            onClick={onClick}
            className="group flex flex-col gap-2 rounded-lg p-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-900"
        >
            <div className="relative w-full aspect-square">
                <Image
                    src={artworkUrl(album.artworkUrl100, 600)}
                    alt=""
                    fill
                    sizes="(max-width: 1024px) 50vw, (max-width: 1536px) 33vw, 25vw"
                    className="rounded-lg object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="bg-black/40 rounded-full p-3">
                        <FaPlay size={16} className="text-white ml-0.5" />
                    </div>
                </div>
            </div>
            <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">{album.collectionName}</span>
                <span className="text-xs text-sky-500 truncate">{album.artistName}</span>
                <span className="text-xs text-gray-400">{album.songs.length} songs</span>
            </div>
        </button>
    )
}

export default function LibraryList({ initialSongs }: { initialSongs: LibrarySong[] }) {
    const [songs, setSongs] = useState(initialSongs)
    const router = useRouter()
    const searchParams = useSearchParams()
    const initialView = (searchParams.get('view') as ViewMode | null) ?? 'songs'
    const [viewMode, setViewMode] = useState<ViewMode>(initialView)
    const { play, current } = usePlayer()
    const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
    const isDesktop = useIsDesktop()
    const [cachedIds, setCachedIds] = useState<Set<string>>(new Set())
    const [savingAll, setSavingAll] = useState(false)
    const [saveAllProgress, setSaveAllProgress] = useState({ done: 0, total: 0 })
    const [playlists, setPlaylists] = useState<Playlist[]>([])
    const [publishing, setPublishing] = useState(false)
    const [publishResult, setPublishResult] = useState<number | null>(null)

    const privateSongCount = useMemo(() => songs.filter(s => s.owner_id !== null).length, [songs])
    const playlistStubs = useMemo(() => playlists.map(p => ({ id: p.id, name: p.name })), [playlists])

    useEffect(() => {
        getCachedSongIds().then(setCachedIds)
        fetchPlaylists().then(setPlaylists)
    }, [])

    function changeViewMode(v: ViewMode) {
        setViewMode(v)
        router.replace(`${routes.library}?view=${v}`, { scroll: false })
    }

    async function refreshSongs() {
        const fresh = await fetchLibrarySongs()
        setSongs(fresh)
    }

    async function refreshPlaylists() {
        fetchPlaylists().then(setPlaylists)
    }

    async function handlePublish() {
        setPublishing(true)
        const count = await publishEligibleSongs()
        setPublishResult(count)
        setPublishing(false)
        await refreshSongs()
        setTimeout(() => setPublishResult(null), 3000)
    }

    async function saveAllOffline() {
        const uncached = songs.filter(s => s.properties && !cachedIds.has(s.uuid))
        if (!uncached.length) return
        setSavingAll(true)
        setSaveAllProgress({ done: 0, total: uncached.length })
        for (const song of uncached) {
            try {
                await cacheSong(song.uuid)
                setCachedIds(prev => new Set([...prev, song.uuid]))
            } catch {}
            setSaveAllProgress(p => ({ ...p, done: p.done + 1 }))
        }
        setSavingAll(false)
    }

    // songs + artists: grouped by first letter
    const songGrouped = useMemo(() => {
        if (viewMode !== 'songs' && viewMode !== 'artists') return new Map<string, LibrarySong[]>()
        const valid = songs.filter(s => s.properties)
        const sorted = [...valid].sort((a, b) => {
            const pa = a.properties!, pb = b.properties!
            if (viewMode === 'songs') return pa.trackName.localeCompare(pb.trackName)
            return pa.artistName.localeCompare(pb.artistName) || pa.trackName.localeCompare(pb.trackName)
        })
        const map = new Map<string, LibrarySong[]>()
        for (const song of sorted) {
            const p = song.properties!
            const key = letterKey(viewMode === 'songs' ? p.trackName : p.artistName)
            if (!map.has(key)) map.set(key, [])
            map.get(key)!.push(song)
        }
        return map
    }, [songs, viewMode])

    // genres: grouped by full genre name, sorted genre-then-track
    const genreGrouped = useMemo(() => {
        if (viewMode !== 'genres') return new Map<string, LibrarySong[]>()
        const valid = songs.filter(s => s.properties)
        const sorted = [...valid].sort((a, b) => {
            const pa = a.properties!, pb = b.properties!
            return (pa.primaryGenreName ?? '').localeCompare(pb.primaryGenreName ?? '') || pa.trackName.localeCompare(pb.trackName)
        })
        const map = new Map<string, LibrarySong[]>()
        for (const song of sorted) {
            const genre = song.properties?.primaryGenreName?.trim() || 'Unknown'
            if (!map.has(genre)) map.set(genre, [])
            map.get(genre)!.push(song)
        }
        return map
    }, [songs, viewMode])

    const albumGrouped = useMemo(() => {
        if (viewMode !== 'albums') return new Map<string, LibraryAlbum[]>()
        const albumMap = new Map<string, LibraryAlbum>()
        for (const song of songs) {
            const p = song.properties
            if (!p) continue
            const id = p.collectionId
            if (!albumMap.has(id)) {
                albumMap.set(id, {
                    collectionId: id,
                    collectionName: p.collectionName,
                    artistName: p.collectionArtistName ?? p.artistName,
                    artworkUrl100: p.artworkUrl100,
                    songs: [],
                })
            }
            albumMap.get(id)!.songs.push(song)
        }
        // sort songs within each album by track number
        for (const album of albumMap.values()) {
            album.songs.sort((a, b) => (a.properties?.trackNumber ?? 0) - (b.properties?.trackNumber ?? 0))
        }
        // sort albums alphabetically then group A-Z
        const albums = [...albumMap.values()].sort((a, b) => a.collectionName.localeCompare(b.collectionName))
        const grouped = new Map<string, LibraryAlbum[]>()
        for (const album of albums) {
            const key = letterKey(album.collectionName)
            if (!grouped.has(key)) grouped.set(key, [])
            grouped.get(key)!.push(album)
        }
        return grouped
    }, [songs, viewMode])

    // A-Z index: for genres, letters map to first char of genre names
    const presentLetters = useMemo(() => {
        if (viewMode === 'genres') return new Set([...genreGrouped.keys()].map(g => letterKey(g)))
        if (viewMode === 'albums') return new Set(albumGrouped.keys())
        return new Set(songGrouped.keys())
    }, [viewMode, songGrouped, genreGrouped, albumGrouped])

    const allSortedSongs = useMemo(() => {
        if (viewMode === 'genres') return [...genreGrouped.values()].flat()
        return [...songGrouped.values()].flat()
    }, [viewMode, songGrouped, genreGrouped])

    function scrollTo(letter: string) {
        const params = new URLSearchParams(searchParams.toString())
        params.set('letter', letter)
        router.replace(`?${params.toString()}`, { scroll: false })
        if (viewMode === 'genres') {
            const genre = [...genreGrouped.keys()].find(g => letterKey(g) === letter)
            if (genre) sectionRefs.current[genre]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            return
        }
        sectionRefs.current[letter]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    // restore letter position on mount
    useEffect(() => {
        const letter = searchParams.get('letter')
        if (!letter) return
        const id = setTimeout(() => scrollTo(letter), 150)
        return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // scroll to and highlight a specific song on mount (?song=<uuid>)
    useEffect(() => {
        const songId = searchParams.get('song')
        if (!songId) return
        const id = setTimeout(() => {
            const el = document.querySelector<HTMLElement>(`[data-song-id="${songId}"]`)
            if (!el) return
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            el.style.animation = 'song-highlight 1.5s ease-out forwards'
            el.addEventListener('animationend', () => { el.style.animation = '' }, { once: true })
        }, 300)
        return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // update URL letter as user scrolls through sections
    useEffect(() => {
        if (viewMode === 'playlists') return
        const entries = Object.entries(sectionRefs.current).filter(([, el]) => el != null)
        if (entries.length === 0) return
        let rafId: number | null = null
        const obs = new IntersectionObserver(changes => {
            for (const c of changes) {
                if (c.isIntersecting) {
                    const key = (c.target as HTMLElement).dataset.letter
                    if (!key) continue
                    if (rafId) cancelAnimationFrame(rafId)
                    rafId = requestAnimationFrame(() => {
                        const p = new URLSearchParams(window.location.search)
                        if (p.get('letter') === key) return
                        p.set('letter', key)
                        window.history.replaceState(null, '', `?${p.toString()}`)
                    })
                }
            }
        }, { rootMargin: '-20% 0px -70% 0px' })
        entries.forEach(([, el]) => el && obs.observe(el))
        return () => { obs.disconnect(); if (rafId) cancelAnimationFrame(rafId) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewMode, songGrouped, albumGrouped, genreGrouped])

    function playAll() {
        if (viewMode === 'albums') {
            const allAlbumSongs = [...albumGrouped.values()].flat().flatMap(a => a.songs)
            const first = allAlbumSongs[0]
            if (!first?.properties) return
            const queue = allAlbumSongs.filter(s => s.properties).map(s => ({ uuid: s.uuid, properties: s.properties!, last_position: s.last_position, last_played_at: s.last_played_at }))
            play({ uuid: first.uuid, properties: first.properties, last_position: first.last_position, last_played_at: first.last_played_at }, queue, { label: 'Library', href: routes.library })
        } else {
            const first = allSortedSongs[0]
            if (!first?.properties) return
            const queue = allSortedSongs.filter(s => s.properties).map(s => ({ uuid: s.uuid, properties: s.properties!, last_position: s.last_position, last_played_at: s.last_played_at }))
            play({ uuid: first.uuid, properties: first.properties, last_position: first.last_position, last_played_at: first.last_played_at }, queue, { label: 'Library', href: routes.library })
        }
    }

    function playAlbum(album: LibraryAlbum) {
        const first = album.songs[0]
        if (!first?.properties) return
        const queue = album.songs.filter(s => s.properties).map(s => ({ uuid: s.uuid, properties: s.properties!, last_position: s.last_position, last_played_at: s.last_played_at }))
        play({ uuid: first.uuid, properties: first.properties, last_position: first.last_position, last_played_at: first.last_played_at }, queue, { label: album.collectionName, href: routes.library })
    }

    if (songs.length === 0) {
        return <p className="text-gray-400 text-sm py-4">library is empty</p>
    }

    return (
        <div className="relative pr-7">
            {/* Sticky toolbar */}
            <div className="sticky top-11 z-40 bg-white/90 dark:bg-gray-950/90 backdrop-blur-md py-3 flex flex-wrap gap-3 items-center border-b border-gray-100 dark:border-gray-800 mb-2">
                {viewMode !== 'playlists' && (
                    <button
                        onClick={playAll}
                        className="flex items-center gap-1.5 px-3 py-1 bg-sky-500 hover:bg-sky-400 text-white rounded-full text-sm font-medium transition-colors"
                    >
                        <FaPlay size={9} />
                        play all
                    </button>
                )}
                <EditsBanner />
                {viewMode !== 'playlists' && (
                    <button
                        onClick={saveAllOffline}
                        disabled={savingAll}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors disabled:opacity-50 text-gray-400 hover:text-sky-500 border border-gray-200 dark:border-gray-800 hover:border-sky-500 transition-colors"
                    >
                        <FaCloudDownloadAlt size={12} />
                        {savingAll ? `${saveAllProgress.done}/${saveAllProgress.total}` : 'save all offline'}
                    </button>
                )}
                {privateSongCount > 0 && viewMode !== 'playlists' && (
                    <button
                        onClick={handlePublish}
                        disabled={publishing}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors disabled:opacity-50 text-gray-400 hover:text-sky-500 border border-gray-200 dark:border-gray-800 hover:border-sky-500 transition-colors"
                    >
                        {publishing ? 'publishing…' : publishResult !== null ? `published ${publishResult}` : `publish eligible (${privateSongCount})`}
                    </button>
                )}
                <div className="flex gap-1">
                    {(['songs', 'artists', 'albums', 'genres', 'playlists'] as ViewMode[]).map(v => (
                        <button
                            key={v}
                            onClick={() => changeViewMode(v)}
                            className={`px-3 py-1 rounded-full text-sm transition-colors ${viewMode === v ? 'bg-sky-500 text-white' : 'text-gray-400 hover:text-sky-500'}`}
                        >
                            {v}
                        </button>
                    ))}
                </div>
            </div>

            {/* Playlists view */}
            {viewMode === 'playlists' && (
                <PlaylistsView playlists={playlists} onRefresh={refreshPlaylists} />
            )}

            {/* Sections */}
            {viewMode === 'albums'
                ? [...albumGrouped.entries()].map(([letter, albums]) => (
                    <div key={letter} ref={el => { sectionRefs.current[letter] = el }} data-letter={letter} className="scroll-mt-24">
                        <div className="sticky top-24 z-30 bg-background px-1 py-0.5 mb-1">
                            <span className="text-xs font-bold text-sky-500 tracking-widest">{letter}</span>
                        </div>
                        <div className={isDesktop
                            ? "grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2 md:gap-4 mb-4"
                            : "flex flex-col mb-4"
                        }>
                            {albums.map(album => (
                                <AlbumCard
                                    key={album.collectionId}
                                    album={album}
                                    isCompact={!isDesktop}
                                    onClick={() => playAlbum(album)}
                                />
                            ))}
                        </div>
                    </div>
                ))
                : viewMode === 'genres'
                ? [...genreGrouped.entries()].map(([genre, group]) => (
                    <div key={genre} ref={el => { sectionRefs.current[genre] = el }} data-letter={letterKey(genre)} className="scroll-mt-24">
                        <div className="sticky top-24 z-30 bg-background px-1 py-0.5 mb-1">
                            <span className="text-sm font-bold text-sky-500">{genre}</span>
                            <span className="ml-2 text-xs text-gray-400">{group.length}</span>
                        </div>
                        <div className={isDesktop
                            ? "grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2 md:gap-6 mb-6"
                            : "flex flex-col mb-6"
                        }>
                            {group.map(song => song.properties && (
                                <div key={song.uuid} data-song-id={song.uuid}>
                                <Song
                                    song={{ songId: song.uuid, properties: song.properties, artworkCached: song.artwork_cached, parentSongId: song.parent_song_id, rootSongId: song.root_song_id }}
                                    selected={current?.uuid === song.uuid}
                                    onClick={() => {
                                        if (!song.properties) return
                                        const queue = group
                                            .filter(s => s.properties)
                                            .map(s => ({ uuid: s.uuid, properties: s.properties!, last_position: s.last_position, last_played_at: s.last_played_at }))
                                        play(
                                            { uuid: song.uuid, properties: song.properties, last_position: song.last_position, last_played_at: song.last_played_at },
                                            queue,
                                            { label: genre, href: routes.library }
                                        )
                                    }}
                                    inLibrary={true}
                                    onRemove={() => setSongs(prev => prev.filter(s => s.uuid !== song.uuid))}
                                    cachedOffline={cachedIds.has(song.uuid)}
                                    onCacheChange={(id, cached) => setCachedIds(prev => {
                                        const next = new Set(prev)
                                        cached ? next.add(id) : next.delete(id)
                                        return next
                                    })}
                                    compact={!isDesktop}
                                    editContext={{ label: 'Library', href: `${routes.library}?song=${song.uuid}` }}
                                    onEditComplete={refreshSongs}
                                    isPrivate={!!song.owner_id}
                                    playlists={playlistStubs}
                                    onPlaylistAdd={refreshPlaylists}
                                />
                                </div>
                            ))}
                        </div>
                    </div>
                ))
                : [...songGrouped.entries()].map(([letter, group]) => (
                    <div key={letter} ref={el => { sectionRefs.current[letter] = el }} data-letter={letter} className="scroll-mt-24">
                        <div className="sticky top-24 z-30 bg-background px-1 py-0.5 mb-1">
                            <span className="text-xs font-bold text-sky-500 tracking-widest">{letter}</span>
                        </div>
                        <div className={isDesktop
                            ? "grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2 md:gap-6 mb-4"
                            : "flex flex-col mb-4"
                        }>
                            {group.map(song => song.properties && (
                                <div key={song.uuid} data-song-id={song.uuid}>
                                <Song
                                    song={{ songId: song.uuid, properties: song.properties, artworkCached: song.artwork_cached, parentSongId: song.parent_song_id, rootSongId: song.root_song_id }}
                                    selected={current?.uuid === song.uuid}
                                    onClick={() => {
                                        if (!song.properties) return
                                        const queue = allSortedSongs
                                            .filter(s => s.properties)
                                            .map(s => ({ uuid: s.uuid, properties: s.properties!, last_position: s.last_position, last_played_at: s.last_played_at }))
                                        play(
                                            { uuid: song.uuid, properties: song.properties, last_position: song.last_position, last_played_at: song.last_played_at },
                                            queue,
                                            { label: 'Library', href: routes.library }
                                        )
                                    }}
                                    inLibrary={true}
                                    onRemove={() => setSongs(prev => prev.filter(s => s.uuid !== song.uuid))}
                                    cachedOffline={cachedIds.has(song.uuid)}
                                    onCacheChange={(id, cached) => setCachedIds(prev => {
                                        const next = new Set(prev)
                                        cached ? next.add(id) : next.delete(id)
                                        return next
                                    })}
                                    compact={!isDesktop}
                                    editContext={{ label: 'Library', href: `${routes.library}?song=${song.uuid}` }}
                                    onEditComplete={refreshSongs}
                                    isPrivate={!!song.owner_id}
                                    playlists={playlistStubs}
                                    onPlaylistAdd={refreshPlaylists}
                                />
                                </div>
                            ))}
                        </div>
                    </div>
                ))
            }

            {/* A-Z index */}
            {viewMode !== 'playlists' && <div className="fixed right-0 top-1/2 -translate-y-1/2 z-50 flex flex-col items-center py-2">
                {ALPHABET.map(letter => (
                    <button
                        key={letter}
                        onClick={() => scrollTo(letter)}
                        disabled={!presentLetters.has(letter)}
                        className={`text-[10px] font-semibold w-5 h-4 leading-none transition-colors ${
                            presentLetters.has(letter)
                                ? 'text-sky-500 hover:text-sky-300'
                                : 'text-gray-200 dark:text-gray-700 cursor-default'
                        }`}
                    >
                        {letter}
                    </button>
                ))}
            </div>}
        </div>
    )
}
