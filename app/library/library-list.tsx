'use client'
import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import { LibrarySong, Playlist, EligibleSong, artworkUrl, songArtworkUrl, fetchLibrarySongs, fetchPlaylists, fetchPlaylistSongs, fetchEligibleSongs, publishSongs, removeFromLibrary, downloadSongToFile, addSongToPlaylist, bulkRemoveFromLibrary, bulkAddSongsToPlaylist, syncOfflineSongs, addServerOfflineSong, removeServerOfflineSong, clearServerOfflineSongs } from "../lib/data"
import SongPickerModal, { PickerSong } from "../components/song-picker-modal"
import { cacheSong, uncacheSong, getCachedSongIds, cacheArtworkUrls } from "../lib/offline"
import { useOnline } from "../lib/use-online"
import Song from "../components/song"
import { usePlayer } from "../components/player"
import { routes } from "../lib/routes"
import { EVENTS } from "../lib/events"
import { FaPlay, FaPause, FaCloudDownloadAlt, FaMusic } from "react-icons/fa"
import PlaylistsView from "./playlists-view"
import EditsBanner from "./edits-banner"

type ViewMode = 'songs' | 'artists' | 'albums' | 'genres' | 'playlists'

const ALPHABET = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

interface LibraryAlbum {
    collectionId: string
    collectionName: string
    artistName: string
    artworkUrl100: string | undefined
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

function AlbumCard({ album, isCompact, isActive, isPlaying, onClick }: { album: LibraryAlbum; isCompact: boolean; isActive: boolean; isPlaying: boolean; onClick: () => void }) {
    if (isCompact) {
        return (
            <button
                onClick={onClick}
                className="flex items-center gap-3 w-full text-left rounded-md p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-900"
            >
                {album.artworkUrl100
                    ? <Image src={artworkUrl(album.artworkUrl100, 200)} alt="" width={40} height={40} className="rounded shrink-0" />
                    : <div className="w-10 h-10 rounded shrink-0 bg-gray-100 dark:bg-gray-800 flex items-center justify-center"><FaMusic size={12} className="text-gray-400" /></div>
                }
                <div className="flex flex-col min-w-0 flex-1">
                    <span className={`text-sm font-medium truncate${isActive ? ' text-sky-500' : ''}`}>{album.collectionName}</span>
                    <span className="text-xs text-sky-500 truncate">{album.artistName} · {album.songs.length} songs</span>
                </div>
                {isActive && isPlaying
                    ? <FaPause size={10} className="text-sky-500 shrink-0 mr-1" />
                    : <FaPlay size={10} className="text-gray-300 dark:text-gray-600 shrink-0 mr-1" />
                }
            </button>
        )
    }
    return (
        <button
            onClick={onClick}
            className="group flex flex-col gap-2 rounded-lg p-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-900"
        >
            <div className="relative w-full aspect-square">
                {album.artworkUrl100
                    ? <Image src={artworkUrl(album.artworkUrl100, 600)} alt="" fill sizes="(max-width: 1024px) 16vw, (max-width: 1280px) 12vw, (max-width: 1536px) 10vw, 9vw" className="rounded-lg object-cover" />
                    : <div className="w-full h-full rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center"><FaMusic size={24} className="text-gray-400" /></div>
                }
                <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    <div className="bg-black/40 rounded-full p-3">
                        {isActive && isPlaying
                            ? <FaPause size={16} className="text-white" />
                            : <FaPlay size={16} className="text-white ml-0.5" />
                        }
                    </div>
                </div>
            </div>
            <div className="flex flex-col min-w-0">
                <span className={`text-sm font-medium truncate${isActive ? ' text-sky-500' : ''}`}>{album.collectionName}</span>
                <span className="text-xs text-sky-500 truncate">{album.artistName}</span>
                <span className="text-xs text-gray-400">{album.songs.length} songs</span>
            </div>
        </button>
    )
}

export default function LibraryList({ initialSongs }: { initialSongs: LibrarySong[] }) {
    const online = useOnline()
    const [songs, setSongs] = useState(initialSongs)
    const router = useRouter()
    const searchParams = useSearchParams()
    const viewMode = (searchParams.get('view') as ViewMode | null) ?? 'songs'
    const { play, current, isPlaying, playContext } = usePlayer()
    const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
    const isDesktop = useIsDesktop()
    const [cachedIds, setCachedIds] = useState<Set<string>>(new Set())
    const [offlineReady, setOfflineReady] = useState(false)
    const [savingAll, setSavingAll] = useState(false)
    const [saveAllProgress, setSaveAllProgress] = useState({ done: 0, total: 0 })
    const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
    const [syncPromptIds, setSyncPromptIds] = useState<string[]>([])
    const [playlists, setPlaylists] = useState<Playlist[]>([])
    const [eligibleSongs, setEligibleSongs] = useState<EligibleSong[]>([])
    const [publishModalOpen, setPublishModalOpen] = useState(false)
    const [publishing, setPublishing] = useState(false)
    const [offlineSyncModalOpen, setOfflineSyncModalOpen] = useState(false)
    const [selectMode, setSelectMode] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)
    const [bulkLoading, setBulkLoading] = useState(false)
    const [bulkPlaylistPicking, setBulkPlaylistPicking] = useState(false)
    const [activeLetter, setActiveLetter] = useState<string | null>(null)
    const [scrubLetter, setScrubLetter] = useState<string | null>(null)
    const scrubbing = useRef(false)
    const barRef = useRef<HTMLDivElement>(null)
    const listContainerRef = useRef<HTMLDivElement>(null)
    const dragState = useRef<{ startId: string; lastId: string; committed: boolean; startY: number; addMode: boolean } | null>(null)
    const selectedIdsRef = useRef(selectedIds)
    useEffect(() => { selectedIdsRef.current = selectedIds }, [selectedIds])

    useEffect(() => {
        const handler = () => {
            setCachedIds(new Set())
            setSyncPromptIds([])
            if (navigator.onLine) refreshSongs()
        }
        window.addEventListener(EVENTS.offlineCleared, handler)
        return () => window.removeEventListener(EVENTS.offlineCleared, handler)
    }, [])

    const supersededIds = useMemo(
        () => new Set(songs.map(s => s.parent_song_id).filter(Boolean) as string[]),
        [songs]
    )
    const displaySongs = useMemo(
        () => {
            const base = online ? songs : songs.filter(s => cachedIds.has(s.uuid))
            return base.filter(s => !supersededIds.has(s.uuid))
        },
        [songs, cachedIds, online, supersededIds]
    )
    const [eligibleCount, setEligibleCount] = useState(0)
    const playlistStubs = useMemo(() => playlists.map(p => ({ id: p.id, name: p.name })), [playlists])

    useEffect(() => {
        if (navigator.onLine) refreshSongs()
        if (navigator.onLine) fetchEligibleSongs().then(e => setEligibleCount(e.filter(s => s.eligible).length))
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        getCachedSongIds().then(async ids => {
            setCachedIds(ids)
            if (!online || songs.length === 0) {
                const cached = await fetchLibrarySongs()
                const playable = cached.filter(s => ids.has(s.uuid))
                if (playable.length > 0) setSongs(playable)
            }
            setOfflineReady(true)
            // Sync local cache state with server; surface songs on server not yet local
            if (navigator.onLine) {
                const serverOnly = await syncOfflineSongs([...ids])
                if (serverOnly.length > 0) setSyncPromptIds(serverOnly)
            }
        })
        fetchPlaylists().then(setPlaylists)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    function changeViewMode(v: ViewMode) {
        if (v !== 'songs' && selectMode) exitSelectMode()
        router.replace(`${routes.library}?view=${v}`, { scroll: false })
    }

    async function refreshSongs() {
        const fresh = await fetchLibrarySongs()
        setSongs(fresh)
    }

    async function refreshPlaylists() {
        fetchPlaylists().then(setPlaylists)
    }

    async function openPublishModal() {
        const all = await fetchEligibleSongs()
        setEligibleSongs(all)
        setEligibleCount(all.filter(s => s.eligible).length)
        setPublishModalOpen(true)
    }

    async function handlePublishConfirm(ids: string[]) {
        setPublishing(true)
        await publishSongs(ids)
        setPublishing(false)
        setPublishModalOpen(false)
        await refreshSongs()
        fetchEligibleSongs().then(e => setEligibleCount(e.filter(s => s.eligible).length))
    }

    async function cacheSongsById(songList: LibrarySong[]) {
        const failed = new Set<string>()
        setSavingAll(true)
        setSaveAllProgress({ done: 0, total: songList.length })
        for (const song of songList) {
            try {
                await cacheSong(song.uuid)
                setCachedIds(prev => new Set([...prev, song.uuid]))
                addServerOfflineSong(song.uuid)
                if (song.properties) {
                    const artUrls = [
                        artworkUrl(song.properties.artworkUrl100, 400),
                        ...(song.artwork_cached ? [
                            songArtworkUrl(song.uuid, true, undefined, 200)!,
                            songArtworkUrl(song.uuid, true, undefined, 400)!,
                        ] : []),
                    ].filter(Boolean)
                    cacheArtworkUrls(artUrls)
                }
            } catch {
                failed.add(song.uuid)
            }
            setSaveAllProgress(p => ({ ...p, done: p.done + 1 }))
        }
        setSavingAll(false)
        setFailedIds(failed)
    }

    async function saveAllOffline() {
        const freshCached = await getCachedSongIds()
        setCachedIds(freshCached)
        setFailedIds(new Set())
        const uncached = displaySongs.filter(s => s.properties && !freshCached.has(s.uuid))
        if (uncached.length) await cacheSongsById(uncached)
        // Cache playlist metadata + song lists in IDB so they're available offline
        const fresh = await fetchPlaylists()
        setPlaylists(fresh)
        await Promise.allSettled(fresh.map(p => fetchPlaylistSongs(p.id)))
    }

    async function retryFailed() {
        const toRetry = songs.filter(s => failedIds.has(s.uuid))
        setFailedIds(new Set())
        await cacheSongsById(toRetry)
    }

    async function downloadSyncSongs() {
        const toSync = songs.filter(s => syncPromptIds.includes(s.uuid))
        setSyncPromptIds([])
        await cacheSongsById(toSync)
    }

    // songs + artists: grouped by first letter
    const songGrouped = useMemo(() => {
        if (viewMode !== 'songs' && viewMode !== 'artists') return new Map<string, LibrarySong[]>()
        const valid = displaySongs.filter(s => s.properties)
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
    }, [displaySongs, viewMode])

    // genres: grouped by full genre name, sorted genre-then-track
    const genreGrouped = useMemo(() => {
        if (viewMode !== 'genres') return new Map<string, LibrarySong[]>()
        const valid = displaySongs.filter(s => s.properties)
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
    }, [displaySongs, viewMode])

    const albumGrouped = useMemo(() => {
        if (viewMode !== 'albums') return new Map<string, LibraryAlbum[]>()
        const albumMap = new Map<string, LibraryAlbum>()
        for (const song of displaySongs) {
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
    }, [displaySongs, viewMode])

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

    function scrubTo(letter: string) {
        if (viewMode === 'genres') {
            const genre = [...genreGrouped.keys()].find(g => letterKey(g) === letter)
            if (genre) sectionRefs.current[genre]?.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'start' })
            return
        }
        sectionRefs.current[letter]?.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'start' })
    }

    function letterFromPointer(e: React.PointerEvent): string | null {
        const bar = barRef.current
        if (!bar) return null
        const rect = bar.getBoundingClientRect()
        const ratio = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
        return ALPHABET[Math.floor(ratio * ALPHABET.length)] ?? null
    }

    function handleBarPointerDown(e: React.PointerEvent) {
        e.preventDefault()
        scrubbing.current = true
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        const letter = letterFromPointer(e)
        if (letter && presentLetters.has(letter)) { setScrubLetter(letter); scrubTo(letter) }
    }

    function handleBarPointerMove(e: React.PointerEvent) {
        if (!scrubbing.current) return
        const letter = letterFromPointer(e)
        if (letter && presentLetters.has(letter) && letter !== scrubLetter) { setScrubLetter(letter); scrubTo(letter) }
    }

    function handleBarPointerUp(e: React.PointerEvent) {
        scrubbing.current = false
        const letter = letterFromPointer(e)
        if (letter && presentLetters.has(letter)) scrollTo(letter)
        setScrubLetter(null)
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

    // update URL letter + active sidebar highlight as user scrolls through sections
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
                        setActiveLetter(key)
                        const p = new URLSearchParams(window.location.search)
                        if (p.get('letter') === key) return
                        p.set('letter', key)
                        window.history.replaceState(null, '', `?${p.toString()}`)
                    })
                }
            }
        }, { rootMargin: '-20% 0px -70% 0px' })
        entries.forEach(([, el]) => el && obs.observe(el))
        return () => { obs.disconnect(); if (rafId) cancelAnimationFrame(rafId); setActiveLetter(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewMode, songGrouped, albumGrouped, genreGrouped])

    const VIEW_CONTEXT: Record<ViewMode, { label: string; href: string }> = {
        songs: { label: 'Library', href: routes.library },
        artists: { label: 'Artists', href: `${routes.library}?view=artists` },
        albums: { label: 'Albums', href: `${routes.library}?view=albums` },
        genres: { label: 'Genres', href: `${routes.library}?view=genres` },
        playlists: { label: 'Playlists', href: `${routes.library}?view=playlists` },
    }

    function playAll() {
        const ctx = { ...VIEW_CONTEXT[viewMode], id: viewMode === 'songs' ? 'library' : viewMode }
        if (viewMode === 'albums') {
            const allAlbumSongs = [...albumGrouped.values()].flat().flatMap(a => a.songs)
            const first = allAlbumSongs[0]
            if (!first?.properties) return
            const queue = allAlbumSongs.filter(s => s.properties).map(s => ({ uuid: s.uuid, properties: s.properties!, last_position: s.last_position, last_played_at: s.last_played_at, artwork_cached: s.artwork_cached, source: ctx }))
            play({ uuid: first.uuid, properties: first.properties, last_position: first.last_position, last_played_at: first.last_played_at, artwork_cached: first.artwork_cached, source: ctx }, queue, ctx)
        } else {
            const first = allSortedSongs[0]
            if (!first?.properties) return
            const queue = allSortedSongs.filter(s => s.properties).map(s => ({ uuid: s.uuid, properties: s.properties!, last_position: s.last_position, last_played_at: s.last_played_at, artwork_cached: s.artwork_cached, source: ctx }))
            play({ uuid: first.uuid, properties: first.properties, last_position: first.last_position, last_played_at: first.last_played_at, artwork_cached: first.artwork_cached, source: ctx }, queue, ctx)
        }
    }

    function playAlbum(album: LibraryAlbum) {
        const first = album.songs[0]
        if (!first?.properties) return
        const ctx = { label: album.collectionName, href: `${routes.library}?view=albums`, id: `album:${album.collectionId}` }
        const queue = album.songs.filter(s => s.properties).map(s => ({ uuid: s.uuid, properties: s.properties!, last_position: s.last_position, last_played_at: s.last_played_at, artwork_cached: s.artwork_cached, source: ctx }))
        play({ uuid: first.uuid, properties: first.properties, last_position: first.last_position, last_played_at: first.last_played_at, artwork_cached: first.artwork_cached, source: ctx }, queue, ctx)
    }

    function enterSelectMode(songId?: string) {
        setSelectMode(true)
        if (songId) {
            setSelectedIds(new Set([songId]))
            setLastSelectedId(songId)
        }
    }

    function exitSelectMode() {
        setSelectMode(false)
        setSelectedIds(new Set())
        setLastSelectedId(null)
        setBulkPlaylistPicking(false)
    }

    useEffect(() => {
        if (!selectMode) return
        function onKeyDown(e: KeyboardEvent) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                e.preventDefault()
                const allIds = [...songGrouped.values()].flat().map(s => s.uuid)
                setSelectedIds(new Set(allIds))
            } else if (e.key === 'Escape') {
                exitSelectMode()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectMode, songGrouped])

    useEffect(() => {
        const container = listContainerRef.current
        if (!container || !selectMode) return

        const allIds = [...songGrouped.values()].flat().map(s => s.uuid)

        function songIdAt(x: number, y: number): string | null {
            const el = document.elementFromPoint(x, y)
            return el?.closest<HTMLElement>('[data-song-id]')?.dataset.songId ?? null
        }

        function applyRange(fromId: string, toId: string, addMode: boolean) {
            const from = allIds.indexOf(fromId)
            const to = allIds.indexOf(toId)
            if (from === -1 || to === -1) return
            const [lo, hi] = from < to ? [from, to] : [to, from]
            setSelectedIds(prev => {
                const next = new Set(prev)
                for (let i = lo; i <= hi; i++) addMode ? next.add(allIds[i]) : next.delete(allIds[i])
                return next
            })
        }

        function onTouchStart(e: TouchEvent) {
            const t = e.touches[0]
            const id = songIdAt(t.clientX, t.clientY)
            if (!id) return
            dragState.current = { startId: id, lastId: id, committed: false, startY: t.clientY, addMode: !selectedIdsRef.current.has(id) }
        }

        function onTouchMove(e: TouchEvent) {
            const state = dragState.current
            if (!state) return
            const t = e.touches[0]
            if (!state.committed) {
                if (Math.abs(t.clientY - state.startY) < 8) return
                state.committed = true
                applyRange(state.startId, state.startId, state.addMode)
                setLastSelectedId(state.startId)
            }
            e.preventDefault()
            const id = songIdAt(t.clientX, t.clientY)
            if (id && id !== state.lastId) {
                applyRange(state.startId, id, state.addMode)
                state.lastId = id
                setLastSelectedId(id)
            }
        }

        function onTouchEnd() {
            dragState.current = null
        }

        container.addEventListener('touchstart', onTouchStart, { passive: true })
        container.addEventListener('touchmove', onTouchMove, { passive: false })
        container.addEventListener('touchend', onTouchEnd, { passive: true })
        return () => {
            container.removeEventListener('touchstart', onTouchStart)
            container.removeEventListener('touchmove', onTouchMove)
            container.removeEventListener('touchend', onTouchEnd)
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectMode, songGrouped])

    function handleSelect(songId: string, shiftKey = false) {
        setSelectedIds(prev => {
            const next = new Set(prev)
            if (shiftKey && lastSelectedId) {
                const flat = [...songGrouped.values()].flat()
                const ids = flat.map(s => s.uuid)
                const fromIdx = ids.indexOf(lastSelectedId)
                const toIdx = ids.indexOf(songId)
                if (fromIdx !== -1 && toIdx !== -1) {
                    const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
                    const range = ids.slice(lo, hi + 1)
                    const allSelected = range.every(id => prev.has(id))
                    for (const id of range) allSelected ? next.delete(id) : next.add(id)
                }
            } else {
                if (next.has(songId)) next.delete(songId)
                else next.add(songId)
            }
            return next
        })
        setLastSelectedId(songId)
    }

    async function handleBulkRemoveFromLibrary() {
        setBulkLoading(true)
        const ids = [...selectedIds]
        await bulkRemoveFromLibrary(ids)
        setSongs(prev => prev.filter(s => !selectedIds.has(s.uuid)))
        exitSelectMode()
        setBulkLoading(false)
    }

    async function bulkSaveOffline() {
        setBulkLoading(true)
        for (const id of selectedIds) {
            if (!cachedIds.has(id)) {
                try {
                    await cacheSong(id)
                    setCachedIds(prev => new Set([...prev, id]))
                    addServerOfflineSong(id)
                } catch {}
            }
        }
        exitSelectMode()
        setBulkLoading(false)
    }

    async function bulkDownload() {
        setBulkLoading(true)
        for (const id of selectedIds) {
            const song = songs.find(s => s.uuid === id)
            if (song?.properties) {
                await downloadSongToFile(id, song.properties.trackName, song.properties.artistName)
            }
        }
        exitSelectMode()
        setBulkLoading(false)
    }

    async function bulkRemoveOffline() {
        setBulkLoading(true)
        for (const id of selectedIds) {
            if (cachedIds.has(id)) {
                try { await uncacheSong(id) } catch {}
                setCachedIds(prev => { const next = new Set(prev); next.delete(id); return next })
                removeServerOfflineSong(id)
            }
        }
        exitSelectMode()
        setBulkLoading(false)
    }

    async function bulkAddToPlaylist(playlistId: string) {
        setBulkLoading(true)
        setBulkPlaylistPicking(false)
        await bulkAddSongsToPlaylist(playlistId, [...selectedIds])
        await refreshPlaylists()
        exitSelectMode()
        setBulkLoading(false)
    }

    if (!offlineReady && displaySongs.length === 0) return null
    if (displaySongs.length === 0 && !online) {
        return <p className="text-gray-400 text-sm py-4">no songs saved offline — save songs while online to listen offline</p>
    }
    if (displaySongs.length === 0) {
        return <p className="text-gray-400 text-sm py-4">library is empty</p>
    }

    return (
        <div ref={listContainerRef} className={`relative pr-7${selectMode ? ' select-none' : ''}`}>
            {online && syncPromptIds.length > 0 && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-400 text-xs flex items-center justify-between gap-3">
                    <span>{syncPromptIds.length} song{syncPromptIds.length !== 1 ? 's' : ''} saved offline on another device</span>
                    <div className="flex gap-2 shrink-0">
                        <button onClick={() => setOfflineSyncModalOpen(true)} className="font-medium underline underline-offset-2 hover:no-underline">View</button>
                        <button onClick={() => setSyncPromptIds([])} className="opacity-60 hover:opacity-100">Dismiss</button>
                    </div>
                </div>
            )}
            {failedIds.size > 0 && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-xs flex items-center justify-between gap-3">
                    <span>{failedIds.size} song{failedIds.size !== 1 ? 's' : ''} failed to download offline</span>
                    <div className="flex gap-2 shrink-0">
                        <button onClick={retryFailed} className="font-medium underline underline-offset-2 hover:no-underline">Retry</button>
                        <button onClick={() => setFailedIds(new Set())} className="opacity-60 hover:opacity-100">Dismiss</button>
                    </div>
                </div>
            )}
            {/* Fixed Select button */}
            {viewMode === 'songs' && (
                <button
                    onClick={selectMode ? exitSelectMode : () => enterSelectMode()}
                    className={`fixed top-14 right-4 z-40 flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors border ${selectMode ? 'bg-sky-500 text-white border-sky-500' : 'bg-white/90 dark:bg-gray-950/90 backdrop-blur-md text-gray-400 hover:text-sky-500 border-gray-200 dark:border-gray-800 hover:border-sky-500'}`}
                >
                    {selectMode
                        ? selectedIds.size > 0
                            ? `${selectedIds.size} selected`
                            : 'Cancel'
                        : 'Select'}
                </button>
            )}
            {/* Toolbar */}
            <div className="flex flex-wrap gap-3 items-center mb-2 py-1">
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
                        disabled={savingAll || !online}
                        title={!online ? 'go online to save songs for offline listening' : 'save all songs for offline listening'}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-gray-400 hover:text-sky-500 border border-gray-200 dark:border-gray-800 hover:border-sky-500"
                    >
                        <FaCloudDownloadAlt size={12} />
                        {savingAll ? `saving ${saveAllProgress.done}/${saveAllProgress.total}…` : !online ? 'offline' : 'save all offline'}
                    </button>
                )}
                {eligibleCount > 0 && viewMode !== 'playlists' && (
                    <button
                        onClick={openPublishModal}
                        disabled={!online}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors disabled:opacity-50 text-gray-400 hover:text-sky-500 border border-gray-200 dark:border-gray-800 hover:border-sky-500"
                    >
                        publish eligible ({eligibleCount})
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
                            ? "grid grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-9 gap-2 mb-4"
                            : "flex flex-col mb-4"
                        }>
                            {albums.map(album => (
                                <AlbumCard
                                    key={album.collectionId}
                                    album={album}
                                    isCompact={!isDesktop}
                                    isActive={playContext?.id === `album:${album.collectionId}`}
                                    isPlaying={isPlaying}
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
                                        const ctx = { label: genre, href: `${routes.library}?view=genres`, id: `genre:${genre}` }
                                        const queue = group
                                            .filter(s => s.properties)
                                            .map(s => ({ uuid: s.uuid, properties: s.properties!, last_position: s.last_position, last_played_at: s.last_played_at, artwork_cached: s.artwork_cached, source: ctx }))
                                        play(
                                            { uuid: song.uuid, properties: song.properties, last_position: song.last_position, last_played_at: song.last_played_at, artwork_cached: song.artwork_cached, source: ctx },
                                            queue,
                                            ctx
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

                                    isPrivate={!!song.owner_id || !!song.parent_song_id}
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
                                    onClick={(e?: React.MouseEvent) => {
                                        if (!song.properties) return
                                        if (selectMode) {
                                            handleSelect(song.uuid, e?.shiftKey)
                                            return
                                        }
                                        const ctx = { ...VIEW_CONTEXT[viewMode], id: viewMode === 'songs' ? 'library' : viewMode }
                                        const queue = allSortedSongs
                                            .filter(s => s.properties)
                                            .map(s => ({ uuid: s.uuid, properties: s.properties!, last_position: s.last_position, last_played_at: s.last_played_at, artwork_cached: s.artwork_cached, source: ctx }))
                                        play(
                                            { uuid: song.uuid, properties: song.properties, last_position: song.last_position, last_played_at: song.last_played_at, artwork_cached: song.artwork_cached, source: ctx },
                                            queue,
                                            ctx
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

                                    isPrivate={!!song.owner_id || !!song.parent_song_id}
                                    playlists={playlistStubs}
                                    onPlaylistAdd={refreshPlaylists}
                                    selectMode={selectMode}
                                    isSelected={selectedIds.has(song.uuid)}
                                    onSelect={(id, shiftKey) => handleSelect(id, shiftKey)}
                                    onLongPress={(id) => { if (!selectMode) enterSelectMode(id) }}
                                />
                                </div>
                            ))}
                        </div>
                    </div>
                ))
            }

            {/* Bulk action bar */}
            {selectMode && selectedIds.size > 0 && (
                <div className="fixed bottom-24 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
                    <div className="pointer-events-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl px-4 py-3 flex gap-3 items-center">
                        {bulkLoading ? (
                            <span className="text-sm text-gray-500">Working…</span>
                        ) : (
                            <>
                                <button
                                    onClick={handleBulkRemoveFromLibrary}
                                    className="px-4 py-2 rounded-xl text-sm font-medium bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 active:bg-red-200 touch-manipulation min-h-[44px]"
                                >
                                    Remove
                                </button>
                                <button
                                    onClick={bulkSaveOffline}
                                    className="px-4 py-2 rounded-xl text-sm font-medium bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/50 active:bg-sky-200 touch-manipulation min-h-[44px]"
                                >
                                    Save offline
                                </button>
                                <button
                                    onClick={bulkDownload}
                                    className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 active:bg-gray-300 touch-manipulation min-h-[44px]"
                                >
                                    Download
                                </button>
                                {[...selectedIds].some(id => cachedIds.has(id)) && (
                                    <button
                                        onClick={bulkRemoveOffline}
                                        className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 active:bg-gray-300 touch-manipulation min-h-[44px]"
                                    >
                                        Remove offline
                                    </button>
                                )}
                                {playlists.length > 0 && (
                                    <div className="relative">
                                        <button
                                            onClick={() => setBulkPlaylistPicking(p => !p)}
                                            className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 active:bg-gray-300 touch-manipulation min-h-[44px]"
                                        >
                                            + Playlist
                                        </button>
                                        {bulkPlaylistPicking && (
                                            <div className="absolute bottom-full mb-2 right-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden min-w-[160px]">
                                                {playlists.map(pl => (
                                                    <button
                                                        key={pl.id}
                                                        onClick={() => bulkAddToPlaylist(pl.id)}
                                                        className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-200 touch-manipulation"
                                                    >
                                                        {pl.name}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* A-Z index */}
            {viewMode !== 'playlists' && (
                <div className="fixed right-0 top-1/2 -translate-y-1/2 z-50 flex items-center">
                    {/* scrub bubble */}
                    {scrubLetter && (
                        <div className="mr-1 w-10 h-10 rounded-full bg-gray-800 dark:bg-gray-200 flex items-center justify-center shadow-lg pointer-events-none">
                            <span className="text-lg font-bold text-white dark:text-gray-900 leading-none">{scrubLetter}</span>
                        </div>
                    )}
                    <div
                        ref={barRef}
                        className="flex flex-col items-center py-2 touch-none select-none cursor-pointer"
                        onPointerDown={handleBarPointerDown}
                        onPointerMove={handleBarPointerMove}
                        onPointerUp={handleBarPointerUp}
                        onPointerCancel={() => { scrubbing.current = false; setScrubLetter(null) }}
                    >
                        {ALPHABET.map(letter => (
                            <span
                                key={letter}
                                className={`text-[10px] font-semibold w-7 h-5 flex items-center justify-center leading-none transition-colors ${
                                    letter === (scrubLetter ?? activeLetter)
                                        ? 'text-gray-500 dark:text-gray-400'
                                        : presentLetters.has(letter)
                                            ? 'text-sky-500'
                                            : 'text-gray-200 dark:text-gray-700'
                                }`}
                            >
                                {letter}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* publish modal */}
            <SongPickerModal
                open={publishModalOpen}
                onClose={() => setPublishModalOpen(false)}
                title="Publish songs"
                songs={eligibleSongs.map(s => ({ uuid: s.uuid, properties: s.properties, artwork_cached: s.artwork_cached }))}
                selectable
                initialSelected={new Set(eligibleSongs.filter(s => s.eligible).map(s => s.uuid))}
                actionLabel="Publish"
                actionLoading={publishing}
                onConfirm={handlePublishConfirm}
                emptyState="no private songs"
                disabledItems={Object.fromEntries(eligibleSongs.filter(s => !s.eligible).map(s => [s.uuid, s.missing_fields]))}
            />

            {/* offline sync modal */}
            <SongPickerModal
                open={offlineSyncModalOpen}
                onClose={() => setOfflineSyncModalOpen(false)}
                title="Songs saved offline on another device"
                songs={syncPromptIds.flatMap(id => {
                    const s = songs.find(s => s.uuid === id)
                    return s ? [{ uuid: s.uuid, properties: s.properties, artwork_cached: s.artwork_cached } as PickerSong] : []
                })}
                selectable
                initialSelected={new Set(syncPromptIds)}
                actionLabel="Download"
                onConfirm={async (ids) => {
                    setOfflineSyncModalOpen(false)
                    const toSync = songs.filter(s => ids.includes(s.uuid))
                    await cacheSongsById(toSync)
                    setSyncPromptIds(prev => prev.filter(id => !ids.includes(id)))
                }}
                emptyState="no songs to sync"
            />
        </div>
    )
}
