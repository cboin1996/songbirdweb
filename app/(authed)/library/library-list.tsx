'use client'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { LibrarySong, Playlist, EligibleSong, artworkUrl, songArtworkUrl, fetchLibrarySongs, getCachedLibrarySongs, fetchPlaylists, fetchPlaylistSongs, fetchEligibleSongs, fetchDrafts, publishSongs, removeFromLibrary, downloadSongToFile, addSongToPlaylist, bulkRemoveFromLibrary, bulkAddSongsToPlaylist, syncOfflineSongs, removeServerOfflineSong, clearServerOfflineSongs } from "../../lib/data"
import { ArtImage } from '../../components/art-image'
import { queryKeys } from "../../lib/query-keys"
import SongPickerModal, { PickerSong } from "../../components/song-picker-modal"
import { saveSongsOffline, reportSaveResult, uncacheSong, cacheArtworkUrls } from "../../lib/offline"
import { useOfflineSave } from "../../lib/offline-save-context"
import { useOnline } from "../../lib/use-online"
import { isOffline } from "../../lib/offline-signal"
import { useRenderCount } from "../../lib/perf"
import Song from "../../components/song"
import { usePlayerActions, usePlayerSelector } from "../../components/player"
import { routes } from "../../lib/routes"
import { EVENTS } from "../../lib/events"
import { FaPlay, FaPause, FaCloudDownloadAlt, FaCloudUploadAlt, FaMusic, FaBookmark, FaDownload, FaListUl } from "react-icons/fa"
import { useToast } from "../../components/toast"
import PlaylistsView from "./playlists-view"
import EditsBanner from "./edits-banner"
import QueryError from "../../components/query-error"
import SearchInput from "../../components/search-input"
import LetterRail from "./letter-rail"
import { useIsDesktop } from "../../lib/use-is-desktop"
import { useFilteredSongs } from "../../lib/use-filtered-songs"
import { ALPHABET, letterKey, groupSongsByLetter, groupSongsByGenre, groupAlbumsByLetter, type LibraryAlbum } from "../../lib/library-grouping"
import { removeSongFromLibraryCache } from "../../lib/library-cache"

type ViewMode = 'songs' | 'artists' | 'albums' | 'genres' | 'playlists'

// Handlers take the album, so the list passes the same two functions to every card,
// and only the active card gets a playing flag: a play or pause re-renders one card.
const AlbumCard = memo(function AlbumCard({ album, isCompact, isActive, isPlaying, onOpen, onPlay }: { album: LibraryAlbum; isCompact: boolean; isActive: boolean; isPlaying: boolean; onOpen: (album: LibraryAlbum) => void; onPlay: (album: LibraryAlbum) => void }) {
  useRenderCount('album')
    const firstSong = album.songs[0]
    const smallArt = songArtworkUrl(firstSong?.uuid, firstSong?.artwork_cached, album.artworkUrl100, 200)
    // Grid tiles are never wider than 200 css px (see the sizes below), so the thumbnail serves them too.
    const largeArt = smallArt
    const useLocalArt = !!firstSong?.artwork_cached
    if (isCompact) {
        return (
            <button
                onClick={() => onOpen(album)}
                className="flex items-center gap-3 w-full text-left rounded-md p-3 transition-colors hover:bg-gray-100 dark:hover:bg-gray-900 select-none"
            >
                {(() => {
                    const stand = <div className="w-12 h-12 rounded shrink-0 bg-gray-100 dark:bg-gray-800 flex items-center justify-center"><FaMusic size={14} className="text-gray-400" /></div>
                    return smallArt
                        ? <ArtImage src={smallArt} alt="" width={48} height={48} className="rounded shrink-0 w-12 h-12" unoptimized={useLocalArt} fallback={stand} />
                        : stand
                })()}
                <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                    <span className={`text-base font-medium truncate${isActive ? ' text-sky-500' : ''}`}>{album.collectionName}</span>
                    <span className="text-sm text-sky-500 truncate">{album.artistName} · {album.songs.length} songs</span>
                </div>
                <div role="button" data-testid="album-play" onClick={e => { e.stopPropagation(); onPlay(album) }} className="shrink-0 mr-1 p-1">
                    {isActive && isPlaying
                        ? <FaPause size={10} className="text-sky-500" />
                        : <FaPlay size={10} className="text-gray-300 dark:text-gray-600" />
                    }
                </div>
            </button>
        )
    }
    return (
        <button
            onClick={() => onOpen(album)}
            className="group flex flex-col gap-2 rounded-lg p-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-900 w-full"
        >
            <div className="relative w-full aspect-square">
                {(() => {
                    const stand = <div className="w-full h-full rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center"><FaMusic size={24} className="text-gray-400" /></div>
                    return largeArt
                        ? <ArtImage src={largeArt} alt="" fill sizes="(max-width: 1024px) 16vw, (max-width: 1280px) 12vw, (max-width: 1536px) 10vw, 9vw" className="rounded-lg object-cover" unoptimized={useLocalArt} fallback={stand} />
                        : stand
                })()}
                <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    <div
                        role="button"
                        data-testid="album-play"
                        onClick={e => { e.stopPropagation(); onPlay(album) }}
                        className="bg-black/40 rounded-full p-3 cursor-pointer"
                    >
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
})

// The publish badge's data is asked for this long after the list shows, so it never competes with first paint.
const ELIGIBLE_DELAY_MS = 2500

export default function LibraryList() {
  useRenderCount('list')
    const online = useOnline()
    const { showToast } = useToast()
    const queryClient = useQueryClient()
    // The device's stored copy of the library stands in while the real request is out,
    // so a slow network shows rows at once and the fresh answer replaces them. It is only
    // a placeholder: never written into the cache, never taken for the server's answer.
    const [storedSongs, setStoredSongs] = useState<LibrarySong[] | undefined>()
    useEffect(() => {
        let alive = true
        getCachedLibrarySongs().then(rows => { if (alive && rows.length > 0) setStoredSongs(rows) }).catch(() => {})
        return () => { alive = false }
    }, [])
    const { data: songs = [], error: songsError, refetch: refetchSongs, isLoading: songsLoading } = useQuery({
        queryKey: queryKeys.librarySongs,
        queryFn: fetchLibrarySongs,
        retry: false,
        placeholderData: storedSongs,
    })
    const { data: playlists = [] } = useQuery({
        queryKey: queryKeys.playlists,
        queryFn: fetchPlaylists,
    })
    const { data: drafts = [] } = useQuery({
        queryKey: queryKeys.drafts,
        queryFn: fetchDrafts,
    })
    const draftIds = useMemo(() => new Set(drafts.map(x => x.song_id)), [drafts])
    const [eligibleWanted, setEligibleWanted] = useState(false)
    useEffect(() => {
        if (songsLoading) return
        const id = setTimeout(() => setEligibleWanted(true), ELIGIBLE_DELAY_MS)
        return () => clearTimeout(id)
    }, [songsLoading])
    const { data: eligibleSongs = [] } = useQuery({
        queryKey: queryKeys.eligibleSongs,
        queryFn: fetchEligibleSongs,
        // Not part of the library load: asked once the list is up and the page has
        // been idle a moment (it only drives the publish button and row dots), and
        // asked again fresh when the picker opens.
        enabled: online && eligibleWanted,
        staleTime: 60_000,
    })
    const router = useRouter()
    const searchParams = useSearchParams()
    const viewMode = (searchParams.get('view') as ViewMode | null) ?? 'songs'
    const [searchQuery, setSearchQuery] = useState('')
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault()
                const el = document.querySelector<HTMLInputElement>('[data-testid="library-search"]')
                el?.focus()
                el?.select()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [])
    const { play, playNow, pause, resume, onLibraryRemove } = usePlayerActions()
    const currentId = usePlayerSelector(s => s.current?.uuid)
    const isPlaying = usePlayerSelector(s => s.isPlaying)
    const playContextId = usePlayerSelector(s => s.playContext?.id)
    const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
    const stickyHeaderRef = useRef<HTMLDivElement | null>(null)
    const isDesktop = useIsDesktop()
    const { savingAll, progress: saveAllProgress, failedIds, clearFailedIds, cachedIds, setCachedIds, cacheSongsById, refreshCachedIds, readSavedAfterLaunch } = useOfflineSave()
    const [offlineReady, setOfflineReady] = useState(false)
    const [syncPromptIds, setSyncPromptIds] = useState<string[]>([])
    const eligibleIds = useMemo(() => new Set(eligibleSongs.filter(s => s.eligible).map(s => s.uuid)), [eligibleSongs])
    const eligibleCount = useMemo(() => eligibleSongs.filter(s => s.eligible).length, [eligibleSongs])
    const [publishModalOpen, setPublishModalOpen] = useState(false)
    const [publishing, setPublishing] = useState(false)
    const [offlineSyncModalOpen, setOfflineSyncModalOpen] = useState(false)
    const [selectMode, setSelectMode] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)
    const [bulkLoading, setBulkLoading] = useState(false)
    const [bulkPlaylistPicking, setBulkPlaylistPicking] = useState(false)
    const [albumModal, setAlbumModal] = useState<LibraryAlbum | null>(null)
    const [albumPlaylistOpen, setAlbumPlaylistOpen] = useState(false)
    const listContainerRef = useRef<HTMLDivElement>(null)
    const dragState = useRef<{ startId: string; lastId: string; committed: boolean; startY: number; addMode: boolean; initialSelected: Set<string>; seeded: boolean } | null>(null)
    const pendingDragSeed = useRef<{ songId: string; clientX: number; clientY: number } | null>(null)
    const selectedIdsRef = useRef(selectedIds)
    useEffect(() => { selectedIdsRef.current = selectedIds }, [selectedIds])
    const lastSelectedIdRef = useRef(lastSelectedId)
    useEffect(() => { lastSelectedIdRef.current = lastSelectedId }, [lastSelectedId])

    useEffect(() => {
        const handler = () => {
            setCachedIds(new Set())
            setSyncPromptIds([])
            if (!isOffline()) queryClient.invalidateQueries({ queryKey: queryKeys.librarySongs })
        }
        window.addEventListener(EVENTS.offlineCleared, handler)
        return () => window.removeEventListener(EVENTS.offlineCleared, handler)
    }, [queryClient])

    const supersededIds = useMemo(
        () => new Set(songs.map(s => s.parent_song_id).filter(Boolean) as string[]),
        [songs]
    )
    // The saved set narrows the list only offline; online, a save or a drop must not
    // rebuild every derived list (and with them every row).
    const offlineOnlyIds = online ? null : cachedIds
    const baseSongs = useMemo(
        () => {
            const base = offlineOnlyIds ? songs.filter(s => offlineOnlyIds.has(s.uuid)) : songs
            return base.filter(s => !supersededIds.has(s.uuid))
        },
        [songs, offlineOnlyIds, supersededIds]
    )
    // The input stays responsive; the long list catches up when React has time.
    const deferredQuery = useDeferredValue(searchQuery)
    const displaySongs = useFilteredSongs(baseSongs, deferredQuery)
    const playlistStubs = useMemo(() => playlists.map(p => ({ id: p.id, name: p.name })), [playlists])

    useEffect(() => {
        // The launch has already listed what is saved, so opening the library does not
        // open every file again. "Save all offline" still checks them all.
        readSavedAfterLaunch().then(async ids => {
            // Offline, the list narrows to what the device saved. Judged now, not by the
            // first render's empty list: online, that copy of `songs` is just "still
            // loading", and replacing the library with the saved songs was the bug.
            if (isOffline()) {
                try {
                    const cached = await fetchLibrarySongs()
                    const playable = cached.filter(s => ids.has(s.uuid))
                    if (playable.length > 0) queryClient.setQueryData(queryKeys.librarySongs, playable)
                } catch {}
            }
            setOfflineReady(true)
            if (!isOffline()) {
                try {
                    const serverOnly = await syncOfflineSongs([...ids])
                    // The library as it is now (this effect closed over the first render's empty one).
                    const current = await queryClient.fetchQuery({ queryKey: queryKeys.librarySongs, queryFn: fetchLibrarySongs })
                    const resolvable = serverOnly.filter(id => current.some(s => s.uuid === id))
                    if (resolvable.length > 0) setSyncPromptIds(resolvable)
                } catch {}
            }
        })
        function onDraftChanged(e: Event) {
            const deleted = (e as CustomEvent).detail?.deleted
            if (deleted) {
                queryClient.setQueryData(queryKeys.drafts, (prev: { song_id: string }[]) =>
                    prev ? prev.filter(d => d.song_id !== deleted) : []
                )
            } else {
                queryClient.invalidateQueries({ queryKey: queryKeys.drafts })
            }
        }
        window.addEventListener(EVENTS.draftChanged, onDraftChanged)
        return () => window.removeEventListener(EVENTS.draftChanged, onDraftChanged)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    function changeViewMode(v: ViewMode) {
        if (v !== 'songs' && selectMode) exitSelectMode()
        router.replace(`${routes.library}?view=${v}`, { scroll: false })
    }

    function refreshPlaylists() {
        queryClient.invalidateQueries({ queryKey: queryKeys.playlists })
    }

    async function openPublishModal() {
        await queryClient.fetchQuery({ queryKey: queryKeys.eligibleSongs, queryFn: fetchEligibleSongs, staleTime: 0 })
        setPublishModalOpen(true)
    }

    async function handlePublishConfirm(ids: string[]) {
        setPublishing(true)
        try {
            await publishSongs(ids)
            setPublishModalOpen(false)
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.librarySongs }),
                queryClient.invalidateQueries({ queryKey: queryKeys.eligibleSongs }),
                queryClient.invalidateQueries({ queryKey: queryKeys.library }),
                queryClient.invalidateQueries({ queryKey: queryKeys.drafts }),
            ])
        } catch {}
        setPublishing(false)
    }

    async function saveAllOffline() {
        const freshCached = await refreshCachedIds()
        const uncached = displaySongs.filter(s => s.properties && !freshCached.has(s.uuid))
        if (uncached.length) await cacheSongsById(uncached)
        await queryClient.invalidateQueries({ queryKey: queryKeys.playlists })
        const fresh = queryClient.getQueryData<Playlist[]>(queryKeys.playlists) ?? []
        await Promise.allSettled(fresh.map(p => fetchPlaylistSongs(p.id)))
    }

    async function retryFailed() {
        const toRetry = songs.filter(s => failedIds.has(s.uuid))
        await cacheSongsById(toRetry)
    }

    async function downloadSyncSongs() {
        const toSync = songs.filter(s => syncPromptIds.includes(s.uuid))
        setSyncPromptIds([])
        await cacheSongsById(toSync)
    }

    // Each grouping is sorted once per list change.
    const songGrouped = useMemo(() =>
        viewMode === 'songs' || viewMode === 'artists' ? groupSongsByLetter(displaySongs, viewMode) : new Map<string, LibrarySong[]>(),
    [displaySongs, viewMode])
    const genreGrouped = useMemo(() =>
        viewMode === 'genres' ? groupSongsByGenre(displaySongs) : new Map<string, LibrarySong[]>(),
    [displaySongs, viewMode])
    const albumGrouped = useMemo(() =>
        viewMode === 'albums' ? groupAlbumsByLetter(displaySongs) : new Map<string, LibraryAlbum[]>(),
    [displaySongs, viewMode])

    const genreNames = useMemo(() => [...genreGrouped.keys()], [genreGrouped])

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

    function withSong(href: string, uuid: string) {
        return href.includes('?') ? `${href}&song=${uuid}` : `${href}?song=${uuid}`
    }

    // Scroll restore: relying on Next.js + browser native back-button restore.
    // Forward-nav scroll-to-song uses ?song=<uuid> (deep-link in player). Letter rail
    // gives 1-tap jump-anywhere. No manual sessionStorage scroll handling — the
    // earlier attempts (URL-based, pixel-Y, letter-based) all had drift edge cases.

    // Jump to and highlight a specific song or album when URL includes ?song=<uuid> or ?album=<id>.
    // Instant scroll: deterministic landing, no layout-shift drift, no timing edge cases.
    useEffect(() => {
        const songId = searchParams.get('song')
        const albumId = searchParams.get('album')
        const target = songId
            ? `[data-song-id="${songId}"]`
            : albumId ? `[data-album-id="${albumId}"]` : null
        if (!target) return
        if (searchQuery) setSearchQuery('')

        const POLL_INTERVAL_MS = 150
        const MAX_POLL_ATTEMPTS = 80  // 80 × 150ms = 12s window for late renders

        let cancelled = false
        let pollTimer: ReturnType<typeof setTimeout> | null = null

        const tryScroll = (attempt: number) => {
            if (cancelled) return
            const el = document.querySelector<HTMLElement>(target)
            if (!el) {
                if (attempt < MAX_POLL_ATTEMPTS) {
                    pollTimer = setTimeout(() => tryScroll(attempt + 1), POLL_INTERVAL_MS)
                } else {
                    console.warn(`[library] scroll-to target "${target}" not found after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS}ms`)
                }
                return
            }
            el.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'center' })
            el.style.animation = 'none'
            void el.offsetWidth
            el.style.animation = 'song-highlight 1.5s ease-out forwards'
            el.dataset.animated = 'once'
            el.addEventListener('animationend', () => { el.style.animation = '' }, { once: true })
            // Strip ?song/?album without triggering RSC refetch (router.replace recreates DOM nodes,
            // wiping dataset.animated). history.replaceState updates the URL in-place.
            const params = new URLSearchParams(searchParams.toString())
            params.delete('song')
            params.delete('album')
            const qs = params.toString()
            window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
        }

        tryScroll(0)
        return () => {
            cancelled = true
            if (pollTimer) clearTimeout(pollTimer)
        }
    }, [searchParams, viewMode])

    const VIEW_CONTEXT: Record<ViewMode, { label: string; href: string }> = {
        songs: { label: 'Library', href: routes.library },
        artists: { label: 'Artists', href: `${routes.library}?view=artists` },
        albums: { label: 'Albums', href: `${routes.library}?view=albums` },
        genres: { label: 'Genres', href: `${routes.library}?view=genres` },
        playlists: { label: 'Playlists', href: `${routes.library}?view=playlists` },
    }

    function playAll() {
        const baseCtx = VIEW_CONTEXT[viewMode]
        const ctx = { ...baseCtx, id: viewMode === 'songs' ? 'library' : viewMode }
        if (viewMode === 'albums') {
            // Albums: source = album view (not per-song), keep generic ctx
            const allAlbumSongs = [...albumGrouped.values()].flat().flatMap(a => a.songs)
            const first = allAlbumSongs[0]
            if (!first?.properties) return
            const queue = allAlbumSongs.filter(s => s.properties).map(s => ({ uuid: s.uuid, properties: s.properties!, last_position: s.last_position, last_played_at: s.last_played_at, artwork_cached: s.artwork_cached, source: ctx }))
            play({ uuid: first.uuid, properties: first.properties, last_position: first.last_position, last_played_at: first.last_played_at, artwork_cached: first.artwork_cached, source: ctx }, queue, ctx)
        } else {
            const first = allSortedSongs[0]
            if (!first?.properties) return
            const queue = allSortedSongs.filter(s => s.properties).map(s => ({ uuid: s.uuid, properties: s.properties!, last_position: s.last_position, last_played_at: s.last_played_at, artwork_cached: s.artwork_cached, source: { ...ctx, href: withSong(baseCtx.href, s.uuid) } }))
            play({ uuid: first.uuid, properties: first.properties, last_position: first.last_position, last_played_at: first.last_played_at, artwork_cached: first.artwork_cached, source: { ...ctx, href: withSong(baseCtx.href, first.uuid) } }, queue, ctx)
        }
    }

    function playAlbum(album: LibraryAlbum) {
        const ctxId = `album:${album.collectionId}`
        if (playContextId === ctxId) {
            isPlaying ? pause() : resume()
            return
        }
        const first = album.songs[0]
        if (!first?.properties) return
        const ctx = { label: album.collectionName, href: `${routes.library}?view=albums&album=${album.collectionId}`, id: ctxId }
        const queue = album.songs.filter(s => s.properties).map(s => ({ uuid: s.uuid, properties: s.properties!, last_position: s.last_position, last_played_at: s.last_played_at, artwork_cached: s.artwork_cached, source: ctx }))
        play({ uuid: first.uuid, properties: first.properties, last_position: first.last_position, last_played_at: first.last_played_at, artwork_cached: first.artwork_cached, source: ctx }, queue, ctx)
    }

    async function handleAlbumAddToPlaylist(playlistId: string) {
        if (!albumModal) return
        setAlbumPlaylistOpen(false)
        const songIds = albumModal.songs.map(s => s.uuid)
        try {
            await bulkAddSongsToPlaylist(playlistId, songIds)
            await refreshPlaylists()
            showToast(`added ${songIds.length} song${songIds.length !== 1 ? 's' : ''} to playlist`)
        } catch {
            showToast('failed to add to playlist', true)
        }
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

    function selectAllSongs() {
        const allIds = [...songGrouped.values()].flat().map(s => s.uuid)
        setSelectedIds(new Set(allIds))
    }

    useEffect(() => {
        if (!selectMode) return
        function onKeyDown(e: KeyboardEvent) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                e.preventDefault()
                selectAllSongs()
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

        // If select mode was entered via long-press, seed dragState so the ongoing
        // touch continues as a drag-select without requiring a lift-and-retouch.
        const seed = pendingDragSeed.current
        if (seed) {
            pendingDragSeed.current = null
            dragState.current = { startId: seed.songId, lastId: seed.songId, committed: false, startY: seed.clientY, addMode: true, initialSelected: new Set(selectedIdsRef.current), seeded: true }
        }

        function songIdAt(x: number, y: number): string | null {
            const el = document.elementFromPoint(x, y)
            return el?.closest<HTMLElement>('[data-song-id]')?.dataset.songId ?? null
        }

        function applyRange(fromId: string, toId: string, addMode: boolean, base: Set<string>) {
            const from = allIds.indexOf(fromId)
            const to = allIds.indexOf(toId)
            if (from === -1 || to === -1) return
            const [lo, hi] = from < to ? [from, to] : [to, from]
            setSelectedIds(() => {
                const next = new Set(base)
                for (let i = lo; i <= hi; i++) addMode ? next.add(allIds[i]) : next.delete(allIds[i])
                return next
            })
        }

        function onTouchStart(e: TouchEvent) {
            const t = e.touches[0]
            // Only initiate drag-select when touch starts in the checkbox zone (left ~52px).
            // Touches elsewhere fall through to native scroll.
            const containerLeft = container!.getBoundingClientRect().left
            if (t.clientX - containerLeft > 52) return
            const id = songIdAt(t.clientX, t.clientY)
            if (!id) return
            dragState.current = { startId: id, lastId: id, committed: false, startY: t.clientY, addMode: !selectedIdsRef.current.has(id), initialSelected: new Set(selectedIdsRef.current), seeded: false }
        }

        function onTouchMove(e: TouchEvent) {
            const state = dragState.current
            if (!state) return
            const t = e.touches[0]
            if (!state.committed) {
                const currentId = songIdAt(t.clientX, t.clientY)
                const ready = state.seeded
                    ? currentId !== null && currentId !== state.startId
                    : Math.abs(t.clientY - state.startY) >= 8
                if (!ready) return
                state.committed = true
                applyRange(state.startId, state.startId, state.addMode, state.initialSelected)
                setLastSelectedId(state.startId)
            }
            e.preventDefault()
            const id = songIdAt(t.clientX, t.clientY)
            if (id && id !== state.lastId) {
                applyRange(state.startId, id, state.addMode, state.initialSelected)
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
     
    }, [selectMode, songGrouped])

    function handleSelect(songId: string, shiftKey = false) {
        setSelectedIds(prev => {
            const next = new Set(prev)
            const anchor = lastSelectedIdRef.current
            if (shiftKey && anchor) {
                const flat = [...songGrouped.values()].flat()
                const ids = flat.map(s => s.uuid)
                const fromIdx = ids.indexOf(anchor)
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
        try { await bulkRemoveFromLibrary(ids) } catch { showToast('could not remove from library, try again', true); setBulkLoading(false); return }
        for (const id of ids) {
            onLibraryRemove(id)
            if (cachedIds.has(id)) {
                try { await uncacheSong(id) } catch {}
            }
        }
        setCachedIds(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next })
        setSyncPromptIds(prev => prev.filter(x => !selectedIds.has(x)))
        for (const id of ids) removeSongFromLibraryCache(queryClient, id)
        setStoredSongs(prev => prev?.filter(s => !selectedIds.has(s.uuid)))
        exitSelectMode()
        setBulkLoading(false)
    }

    async function bulkSaveOffline() {
        setBulkLoading(true)
        const result = await saveSongsOffline([...selectedIds].filter(id => !cachedIds.has(id)), {
            onSaved: id => setCachedIds(prev => new Set([...prev, id])),
        })
        reportSaveResult(result, showToast)
        // The selection becomes what is still unsaved, which includes songs the
        // batch never reached, so one press of the button retries exactly those.
        if (result.failed.size > 0) setSelectedIds(result.failed)
        else exitSelectMode()
        setBulkLoading(false)
    }

    async function bulkDownload() {
        setBulkLoading(true)
        const failedIds = new Set<string>()
        for (const id of selectedIds) {
            const song = songs.find(s => s.uuid === id)
            if (song?.properties) {
                try { await downloadSongToFile(id, song.properties.trackName, song.properties.artistName) } catch { failedIds.add(id) }
            }
        }
        if (failedIds.size > 0) {
            setSelectedIds(failedIds)
            showToast(`${failedIds.size} download${failedIds.size > 1 ? 's' : ''} failed`, true)
        } else {
            exitSelectMode()
        }
        setBulkLoading(false)
    }

    async function bulkRemoveOffline() {
        setBulkLoading(true)
        const failed = new Set<string>()
        for (const id of selectedIds) {
            if (cachedIds.has(id)) {
                try {
                    await removeServerOfflineSong(id)
                    await uncacheSong(id)
                    setCachedIds(prev => { const next = new Set(prev); next.delete(id); return next })
                } catch { failed.add(id) }
            }
        }
        if (failed.size > 0) {
            setSelectedIds(failed)
            showToast(`${failed.size} song${failed.size > 1 ? 's' : ''} failed to remove offline`, true)
        } else {
            exitSelectMode()
        }
        setBulkLoading(false)
    }

    async function bulkAddToPlaylist(playlistId: string) {
        setBulkLoading(true)
        setBulkPlaylistPicking(false)
        try {
            await bulkAddSongsToPlaylist(playlistId, [...selectedIds])
            await refreshPlaylists()
        } catch {
            showToast('failed to add to playlist', true)
        }
        exitSelectMode()
        setBulkLoading(false)
    }

    // A row keeps the handlers it was first given (Song's memo ignores them), so they
    // call through this ref and act on the view, order and select mode as they are now,
    // not as they were when the row mounted.
    function playRow(songId: string, e?: React.MouseEvent) {
        const song = songs.find(s => s.uuid === songId)
        if (!song?.properties) return
        if (selectMode) {
            handleSelect(songId, e?.shiftKey)
            return
        }
        const baseCtx = VIEW_CONTEXT[viewMode]
        const ctx = { ...baseCtx, id: viewMode === 'songs' ? 'library' : viewMode }
        playNow({ uuid: song.uuid, properties: song.properties, last_position: song.last_position, last_played_at: song.last_played_at, artwork_cached: song.artwork_cached, source: { ...ctx, href: withSong(baseCtx.href, song.uuid) } })
    }
    function playGenreRow(songId: string, genre: string) {
        const song = songs.find(s => s.uuid === songId)
        if (!song?.properties) return
        const baseHref = `${routes.library}?view=genres`
        const ctx = { label: genre, href: baseHref, id: `genre:${genre}` }
        playNow({ uuid: song.uuid, properties: song.properties, last_position: song.last_position, last_played_at: song.last_played_at, artwork_cached: song.artwork_cached, source: { ...ctx, href: withSong(baseHref, song.uuid) } })
    }
    function longPress(songId: string, pos: { clientX: number; clientY: number }) {
        if (selectMode) return
        const containerLeft = listContainerRef.current?.getBoundingClientRect().left ?? 0
        if (pos.clientX - containerLeft <= 52) pendingDragSeed.current = { songId, ...pos }
        enterSelectMode(songId)
    }
    const rowHandlers = useRef({ playRow, playGenreRow, longPress, handleSelect, playAlbum })
    rowHandlers.current = { playRow, playGenreRow, longPress, handleSelect, playAlbum }
    const playAlbumStable = useCallback((album: LibraryAlbum) => rowHandlers.current.playAlbum(album), [])

    if (songsLoading && baseSongs.length === 0) return null
    if (baseSongs.length === 0 && songsError) {
        return (
            <div className="py-4">
                <QueryError error={songsError} retry={refetchSongs} context="your library" />
            </div>
        )
    }
    if (baseSongs.length === 0 && !online) {
        return <p className="text-gray-400 text-sm py-4">no songs saved offline — save songs while online to listen offline</p>
    }
    if (baseSongs.length === 0) {
        return <p className="text-gray-400 text-sm py-4">library is empty</p>
    }

    return (
        <div ref={listContainerRef} className={`relative pr-7${selectMode ? ' select-none' : ''}`}>
            {/* Sticky header: toolbar + banners */}
            <div ref={stickyHeaderRef} className="md:sticky md:top-11 md:z-40 md:-mx-6 md:px-6 md:bg-[var(--background)]/90 md:backdrop-blur-md frosted-bar md:border-b border-gray-100 dark:border-gray-800 md:pt-2">
            {online && syncPromptIds.length > 0 && (
                <div className="mb-2 mt-2 px-3 py-2 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-400 text-xs flex items-center justify-between gap-3">
                    <span>{syncPromptIds.length} song{syncPromptIds.length !== 1 ? 's' : ''} saved offline on another device</span>
                    <div className="flex gap-2 shrink-0">
                        <button onClick={() => setOfflineSyncModalOpen(true)} className="font-medium underline underline-offset-2 hover:no-underline">View</button>
                        <button onClick={() => setSyncPromptIds([])} className="opacity-60 hover:opacity-100">Dismiss</button>
                    </div>
                </div>
            )}
            {failedIds.size > 0 && (
                <div className="mb-2 mt-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-xs flex items-center justify-between gap-3">
                    <span>{failedIds.size} song{failedIds.size !== 1 ? 's' : ''} failed to download offline</span>
                    <div className="flex gap-2 shrink-0">
                        <button onClick={retryFailed} className="font-medium underline underline-offset-2 hover:no-underline">Retry</button>
                        <button onClick={clearFailedIds} className="opacity-60 hover:opacity-100">Dismiss</button>
                    </div>
                </div>
            )}
            {/* Fixed Select button(s) */}
            {viewMode === 'songs' && (
                <div className="fixed top-14 right-4 z-40 flex items-center gap-2">
                    {selectMode && (() => {
                        const totalSongs = [...songGrouped.values()].flat().length
                        const allSelected = selectedIds.size > 0 && selectedIds.size === totalSongs
                        return (
                            <button
                                onClick={() => allSelected ? setSelectedIds(new Set()) : selectAllSongs()}
                                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors border bg-[var(--background)]/90 backdrop-blur-md text-gray-400 hover:text-sky-500 border-gray-200 dark:border-gray-800 hover:border-sky-500 min-h-[36px]"
                            >
                                {allSelected ? 'Deselect all' : 'Select all'}
                            </button>
                        )
                    })()}
                    <button
                        onClick={selectMode ? exitSelectMode : () => enterSelectMode()}
                        // On mobile, entering select mode is via long-press;
                        // hide the entry-point button. Keep visible while in
                        // select mode so users can cancel.
                        className={`items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors border min-h-[36px] ${selectMode ? 'flex bg-sky-500 text-white border-sky-500' : viewMode === 'songs' ? 'hidden md:flex bg-[var(--background)]/90 backdrop-blur-md text-gray-400 hover:text-sky-500 border-gray-200 dark:border-gray-800 hover:border-sky-500' : 'hidden'}`}
                    >
                        {selectMode
                            ? selectedIds.size > 0
                                ? `${selectedIds.size} selected`
                                : 'Cancel'
                            : 'Select'}
                    </button>
                </div>
            )}
            {/* Toolbar */}
            <div className="flex flex-wrap gap-3 items-center mb-2 py-2">
                <button
                    onClick={playAll}
                    className="flex items-center gap-1.5 px-3 py-1 bg-sky-500 hover:bg-sky-400 text-white rounded-full text-sm font-medium transition-colors"
                >
                    <FaPlay size={9} />
                    play all{deferredQuery ? ` (${displaySongs.length})` : ''}
                </button>
                <EditsBanner />
                <button
                    data-testid="save-all-offline"
                    onClick={saveAllOffline}
                    disabled={savingAll || !online}
                    title={!online ? 'go online to save songs for offline listening' : 'save all songs for offline listening'}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-gray-400 hover:text-sky-500 border border-gray-200 dark:border-gray-800 hover:border-sky-500"
                >
                    <FaCloudDownloadAlt size={12} />
                    {savingAll ? `saving ${saveAllProgress.done}/${saveAllProgress.total}…` : !online ? 'offline' : 'save all offline'}
                </button>
                <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="search library…" testId="library-search" className="w-40 md:w-52" />
                {eligibleCount > 0 && (
                    <button
                        onClick={openPublishModal}
                        disabled={!online}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors disabled:opacity-50 text-emerald-400 hover:text-emerald-300 border border-emerald-500/40 hover:border-emerald-400"
                    >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        publish eligible ({eligibleCount})
                    </button>
                )}
                <div className="flex gap-1 ml-auto md:ml-auto justify-center md:justify-end w-full md:w-auto">
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
            </div>{/* end sticky header */}

            {songsError && (
                <div className="my-4">
                    <QueryError error={songsError} retry={refetchSongs} context="your library" />
                </div>
            )}

            {deferredQuery && displaySongs.length === 0 && viewMode !== 'playlists' && (
                <p data-testid="library-search-empty" className="text-gray-400 text-sm py-8 text-center">no songs match &ldquo;{deferredQuery}&rdquo;</p>
            )}

            {/* Playlists view */}
            {viewMode === 'playlists' && (
                <PlaylistsView playlists={playlists} onRefresh={refreshPlaylists} />
            )}

            {/* Sections */}
            {viewMode === 'albums'
                ? [...albumGrouped.entries()].map(([letter, albums]) => (
                    <div key={letter} ref={el => { sectionRefs.current[letter] = el }} data-letter={letter} className="scroll-mt-24">
                        <div className="md:sticky md:top-24 z-30 bg-background px-1 py-0.5 mb-1">
                            <span className="text-xs font-bold text-sky-500 tracking-widest">{letter}</span>
                        </div>
                        <div className={isDesktop
                            ? "grid grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-9 gap-2 mb-4"
                            : "flex flex-col mb-4"
                        }>
                            {albums.map(album => (
                                <div key={album.collectionId} data-album-id={album.collectionId}>
                                <AlbumCard
                                    album={album}
                                    isCompact={!isDesktop}
                                    isActive={playContextId === `album:${album.collectionId}`}
                                    isPlaying={isPlaying && playContextId === `album:${album.collectionId}`}
                                    onOpen={setAlbumModal}
                                    onPlay={playAlbumStable}
                                />
                                </div>
                            ))}
                        </div>
                    </div>
                ))
                : viewMode === 'genres'
                ? [...genreGrouped.entries()].map(([genre, group]) => (
                    <div key={genre} ref={el => { sectionRefs.current[genre] = el }} data-letter={letterKey(genre)} className="scroll-mt-24 cv-auto">
                        <div className="md:sticky md:top-24 z-30 bg-background px-1 py-0.5 mb-1 flex items-center gap-2">
                            <span className="text-sm font-bold text-sky-500">{genre}</span>
                            <span className="text-xs text-gray-400">{group.length}</span>
                            <button
                                onClick={() => {
                                    const ctxId = `genre:${genre}`
                                    if (playContextId === ctxId) { isPlaying ? pause() : resume(); return }
                                    const baseHref = `${routes.library}?view=genres`
                                    const ctx = { label: genre, href: baseHref, id: ctxId }
                                    const songs = group.filter(s => s.properties)
                                    const first = songs[0]
                                    if (!first?.properties) return
                                    const queue = songs.map(s => ({ uuid: s.uuid, properties: s.properties!, last_position: s.last_position, last_played_at: s.last_played_at, artwork_cached: s.artwork_cached, source: ctx }))
                                    play({ uuid: first.uuid, properties: first.properties, last_position: first.last_position, last_played_at: first.last_played_at, artwork_cached: first.artwork_cached, source: ctx }, queue, ctx)
                                }}
                                className="ml-1 p-1 shrink-0"
                            >
                                {playContextId === `genre:${genre}` && isPlaying
                                    ? <FaPause size={9} className="text-sky-500" />
                                    : <FaPlay size={9} className={playContextId === `genre:${genre}` ? 'text-sky-500' : 'text-gray-300 dark:text-gray-600'} />
                                }
                            </button>
                        </div>
                        <div className={isDesktop
                            ? "grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2 md:gap-6 mb-6"
                            : "flex flex-col mb-6"
                        }>
                            {group.map(song => song.properties && (
                                <div key={song.uuid} data-song-id={song.uuid}>
                                <Song
                                    song={{ songId: song.uuid, properties: song.properties, artworkCached: song.artwork_cached, parentSongId: song.parent_song_id, rootSongId: song.root_song_id }}
                                    selected={currentId === song.uuid}
                                    onClick={() => rowHandlers.current.playGenreRow(song.uuid, genre)}
                                    inLibrary={true}
                                    onRemove={() => {
                                        setStoredSongs(prev => prev?.filter(s => s.uuid !== song.uuid))
                                        setSyncPromptIds(prev => prev.filter(x => x !== song.uuid))
                                    }}
                                    cachedOffline={cachedIds.has(song.uuid)}
                                    onCacheChange={(id, cached) => {
                                        setCachedIds(prev => {
                                            const next = new Set(prev)
                                            cached ? next.add(id) : next.delete(id)
                                            return next
                                        })
                                        if (cached) setSyncPromptIds(prev => prev.filter(x => x !== id))
                                    }}
                                    compact={!isDesktop}

                                    isPrivate={!!song.owner_id || !!song.parent_song_id}
                                    playlists={playlistStubs}
                                    onPlaylistAdd={refreshPlaylists}
                                    hasDraft={draftIds.has(song.uuid)}
                                    isEligible={eligibleIds.has(song.uuid)}
                                />
                                </div>
                            ))}
                        </div>
                    </div>
                ))
                : [...songGrouped.entries()].map(([letter, group]) => (
                    <div key={letter} ref={el => { sectionRefs.current[letter] = el }} data-letter={letter} className="scroll-mt-24 cv-auto">
                        <div className="md:sticky md:top-24 z-30 bg-background px-1 py-0.5 mb-1">
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
                                    selected={currentId === song.uuid}
                                    onClick={(e?: React.MouseEvent) => rowHandlers.current.playRow(song.uuid, e)}
                                    inLibrary={true}
                                    onRemove={() => {
                                        setStoredSongs(prev => prev?.filter(s => s.uuid !== song.uuid))
                                        setSyncPromptIds(prev => prev.filter(x => x !== song.uuid))
                                    }}
                                    cachedOffline={cachedIds.has(song.uuid)}
                                    onCacheChange={(id, cached) => {
                                        setCachedIds(prev => {
                                            const next = new Set(prev)
                                            cached ? next.add(id) : next.delete(id)
                                            return next
                                        })
                                        if (cached) setSyncPromptIds(prev => prev.filter(x => x !== id))
                                    }}
                                    compact={!isDesktop}

                                    isPrivate={!!song.owner_id || !!song.parent_song_id}
                                    playlists={playlistStubs}
                                    onPlaylistAdd={refreshPlaylists}
                                    selectMode={selectMode}
                                    isSelected={selectedIds.has(song.uuid)}
                                    onSelect={(id, shiftKey) => rowHandlers.current.handleSelect(id, shiftKey)}
                                    onLongPress={(id, pos) => rowHandlers.current.longPress(id, pos)}
                                    hasDraft={draftIds.has(song.uuid)}
                                    isEligible={eligibleIds.has(song.uuid)}
                                />
                                </div>
                            ))}
                        </div>
                    </div>
                ))
            }

            {/* Bulk action bar */}
            {selectMode && selectedIds.size > 0 && (
                <div className="fixed left-0 right-0 z-50 flex justify-center px-4 pointer-events-none" style={{ bottom: 'var(--player-bar-h, 6rem)' }}>
                    <div className="pointer-events-auto bg-[var(--background)]/90 backdrop-blur-md border border-gray-100 dark:border-gray-800 rounded-2xl shadow-lg px-3 py-3 flex flex-wrap gap-2 items-center justify-center">
                        {bulkLoading ? (
                            <span className="text-sm text-gray-500">Working…</span>
                        ) : (
                            <>
                                <button
                                    onClick={handleBulkRemoveFromLibrary}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 active:bg-red-200 touch-manipulation min-h-[44px]"
                                >
                                    <FaBookmark size={11} />
                                    Remove
                                </button>
                                <button
                                    onClick={bulkSaveOffline}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/50 active:bg-sky-200 touch-manipulation min-h-[44px]"
                                >
                                    <FaCloudDownloadAlt size={13} />
                                    Offline
                                </button>
                                {[...selectedIds].some(id => cachedIds.has(id)) && (
                                    <button
                                        onClick={bulkRemoveOffline}
                                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900/50 active:bg-sky-200 touch-manipulation min-h-[44px]"
                                    >
                                        <FaCloudUploadAlt size={13} />
                                        Rm offline
                                    </button>
                                )}
                                <button
                                    onClick={bulkDownload}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 active:bg-gray-300 touch-manipulation min-h-[44px]"
                                >
                                    <FaDownload size={11} />
                                    Download
                                </button>
                                {playlists.length > 0 && (
                                    <div className="relative">
                                        <button
                                            onClick={() => setBulkPlaylistPicking(p => !p)}
                                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 active:bg-gray-300 touch-manipulation min-h-[44px]"
                                        >
                                            <FaListUl size={11} />
                                            Playlist
                                        </button>
                                        {bulkPlaylistPicking && (
                                            <div className="absolute bottom-full mb-2 right-0 bg-surface border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden min-w-[160px]">
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

            {viewMode !== 'playlists' && (
                <LetterRail
                    viewMode={viewMode}
                    presentLetters={presentLetters}
                    genreNames={genreNames}
                    sectionRefs={sectionRefs}
                    stickyHeaderRef={stickyHeaderRef}
                />
            )}

            {/* album modal */}
            {albumModal && (
                <SongPickerModal
                    open={!!albumModal}
                    onClose={() => { setAlbumModal(null); setAlbumPlaylistOpen(false) }}
                    title={albumModal?.collectionName ?? ''}
                    titleActions={
                        playlists.length > 0 ? (
                            <div className="relative">
                                <button
                                    onClick={() => setAlbumPlaylistOpen(p => !p)}
                                    className="text-xs text-sky-500 hover:text-sky-400 font-medium px-2 py-1 rounded"
                                >
                                    + playlist
                                </button>
                                {albumPlaylistOpen && (
                                    <div className="absolute right-0 top-full mt-1 bg-surface border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden min-w-[160px] z-10">
                                        {playlists.map(pl => (
                                            <button
                                                key={pl.id}
                                                onClick={() => handleAlbumAddToPlaylist(pl.id)}
                                                className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 touch-manipulation"
                                            >
                                                {pl.name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : undefined
                    }
                    songs={albumModal?.songs.map(s => ({ uuid: s.uuid, properties: s.properties, artwork_cached: s.artwork_cached })) ?? []}
                    emptyState="no songs"
                    testId="album-modal"
                />
            )}

            {/* publish modal */}
            {publishModalOpen && (
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
            )}

            {/* offline sync modal */}
            {offlineSyncModalOpen && (
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
            )}
        </div>
    )
}
