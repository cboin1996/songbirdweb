'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useToast } from "./toast"
import { useVirtualList } from "../lib/use-virtual-list"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { MdCloudOff } from "react-icons/md"
import { FaPause, FaPlay, FaStepBackward, FaStepForward, FaRandom, FaRedo, FaList, FaTimes, FaVolumeUp, FaVolumeMute, FaBars, FaMusic, FaChevronDown } from "react-icons/fa"
import { filterSongs } from "../lib/use-filtered-songs"
import SearchInput from "./search-input"
import Spinner from "./spinner"
import { DOWNLOAD_URL, LibrarySong, RefreshResult, PlayableSong, PlayerState, artworkUrl, songArtworkUrl, ensureFreshToken, isSigningOut, redirectToLogin, tryRefresh, fetchLibrarySongs, fetchLibrarySongsAtLaunch, fetchPlayerState, fetchPlayerStateAtLaunch, fetchSongById, recordPlay, savePlayerState, playerWritesPending, readLocalPlayerState, updatePosition, queueInsert, queueRemove, queueReorder as apiQueueReorder } from "../lib/data"
import { isOffline } from "../lib/offline-signal"
import { useOnline } from "../lib/use-online"
import { getSongFile, cacheArtworkUrls } from "../lib/offline"
import { useOfflineSave } from "../lib/offline-save-context"
import { createBlobSlot } from "../lib/blob-slot"
import { readTestOverride } from "../lib/test-overrides"
import { isValidShuffleOrder } from "../lib/shuffle-order"
import Slider from "./slider"
import { routes } from "../lib/routes"

function contextFromId(id: string | null): PlayContext | null {
    if (!id) return null
    if (id === 'library')   return { id, label: 'Library',   href: routes.library }
    if (id === 'artists')   return { id, label: 'Artists',   href: `${routes.library}?view=artists` }
    if (id === 'albums')    return { id, label: 'Albums',    href: `${routes.library}?view=albums` }
    if (id === 'genres')    return { id, label: 'Genres',    href: `${routes.library}?view=genres` }
    if (id === 'playlists') return { id, label: 'Playlists', href: `${routes.library}?view=playlists` }
    if (id === 'explore')   return { id, label: 'Explore',   href: routes.explore }
    if (id === 'downloads') return { id, label: 'Downloads', href: routes.download }
    if (id.startsWith('genre:')) { const g = id.slice(6); return { id, label: g, href: `${routes.library}?view=genres` } }
    if (id.startsWith('album:')) return { id, label: 'Album', href: `${routes.library}?view=albums` }
    return null
}

export type RepeatMode = 'off' | 'one' | 'all'
export type PlayContext = { label: string; href: string; id: string }

function seededShuffle(arr: number[], seed: number): number[] {
    // Mulberry32 PRNG — deterministic, fast, good distribution
    let s = seed >>> 0
    function rand() {
        s += 0x6D2B79F5
        let t = Math.imul(s ^ s >>> 15, 1 | s)
        t ^= t + Math.imul(t ^ t >>> 7, 61 | t)
        return ((t ^ t >>> 14) >>> 0) / 4294967296
    }
    const out = [...arr]
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]]
    }
    return out
}

interface PlayerContextValue {
    current: PlayableSong | null
    isPlaying: boolean
    queue: PlayableSong[]
    shuffle: boolean
    repeat: RepeatMode
    playContext: PlayContext | null
    play: (song: PlayableSong, queue?: PlayableSong[], context?: PlayContext) => void
    pause: () => void
    resume: () => void
    skipNext: () => void
    skipPrev: () => void
    toggleShuffle: () => void
    toggleRepeat: () => void
    insertNext: (song: PlayableSong) => void
    playNow: (song: PlayableSong) => void
    removeFromQueue: (index: number) => void
    reorderQueue: (fromIdx: number, toIdx: number) => void
    onLibraryAdd: (song: PlayableSong) => void
    onLibraryRemove: (songId: string) => void
}

const PlayerContext = createContext<PlayerContextValue>({
    current: null,
    isPlaying: false,
    queue: [],
    shuffle: false,
    repeat: 'all',
    playContext: null,
    play: () => {},
    pause: () => {},
    resume: () => {},
    skipNext: () => {},
    skipPrev: () => {},
    toggleShuffle: () => {},
    toggleRepeat: () => {},
    insertNext: () => {},
    playNow: () => {},
    removeFromQueue: () => {},
    reorderQueue: () => {},
    onLibraryAdd: () => {},
    onLibraryRemove: () => {},
})


export function usePlayer() {
    return useContext(PlayerContext)
}

const QUEUE_ROW_H = 52

// A dead zone must cost one song, not the queue: after this many consecutive
// failed loads the player lands back where it started and stops.
const MAX_CONSECUTIVE_FAILURES = 5
// Real progress past the position a load started at. Not "playback began": on
// weak cellular a song buffers, starts, stalls and fails, which would zero the
// failure budget on every hop and recreate the runaway.
const PROGRESS_RESET_SEC = 10

// Everything an error cascade moves while it walks the queue. Restoring the
// index alone is not enough — the walk also moves the shuffle position, shifts
// entries off the manual-next list, and rebuilds the whole shuffle order if it
// crosses a lap boundary.
type AdvanceSnapshot = {
    queueIndex: number
    shufflePos: number
    shuffleOrder: number[]
    shuffleSeed: number | null
    manualNext: PlayableSong[]
}

function fmt(s: number) {
    if (!isFinite(s) || s < 0) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
}

function ProgressBar({ current, duration, buffered, onSeek }: {
    current: number
    duration: number
    buffered: number
    onSeek: (t: number) => void
}) {
    const barRef = useRef<HTMLDivElement>(null)
    const dragging = useRef(false)

    function posFromX(clientX: number) {
        const rect = barRef.current!.getBoundingClientRect()
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * (duration || 0)
    }

    function onMouseDown(e: React.MouseEvent) {
        dragging.current = true
        onSeek(posFromX(e.clientX))
        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
    }

    function onMouseMove(e: MouseEvent) {
        if (dragging.current) onSeek(posFromX(e.clientX))
    }

    function onMouseUp(e: MouseEvent) {
        if (dragging.current) {
            onSeek(posFromX(e.clientX))
            dragging.current = false
        }
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
    }

    function onTouchStart(e: React.TouchEvent) {
        onSeek(posFromX(e.touches[0].clientX))
    }

    function onTouchMove(e: React.TouchEvent) {
        e.preventDefault()
        onSeek(posFromX(e.touches[0].clientX))
    }

    const pct = duration ? (current / duration) * 100 : 0
    const bufferedPct = duration ? Math.min((buffered / duration) * 100, 100) : 0

    return (
        <div className="flex items-center gap-3 flex-1">
            <span className="text-xs text-gray-400 tabular-nums w-8 text-right shrink-0">{fmt(current)}</span>
            <div
                ref={barRef}
                onMouseDown={onMouseDown}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                className="flex-1 py-3 cursor-pointer group relative touch-manipulation select-none"
            >
                <div className="h-0.5 bg-gray-200 dark:bg-gray-700 rounded-full relative">
                    {/* buffer track */}
                    <div
                        className="absolute inset-y-0 left-0 bg-gray-400/40 dark:bg-gray-500/40 rounded-full"
                        style={{ width: `${bufferedPct}%` }}
                    />
                    {/* played track */}
                    <div
                        className="h-full bg-sky-500 rounded-full relative"
                        style={{ width: `${pct}%` }}
                    >
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-sky-500 rounded-full opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity" />
                    </div>
                </div>
            </div>
            <span className="text-xs text-gray-400 tabular-nums w-8 shrink-0">-{fmt((duration || 0) - current)}</span>
        </div>
    )
}

const QUEUE_STYLES = {
    panel: {
        px: '',
        drag: 'text-gray-300 dark:text-gray-600',
        activeRow: 'bg-sky-50 dark:bg-sky-950/30',
        hoverRow: 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
        activeTrack: 'text-sky-500',
        normalTrack: '',
        artist: 'text-xs text-gray-400 truncate',
        activePing: 'text-sky-500',
        artFallback: 'bg-gray-100 dark:bg-gray-800',
        artIcon: 'text-gray-400',
        badge: 'bg-sky-100 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400',
        source: 'text-xs text-gray-400 hover:text-sky-500 truncate max-w-[80px] shrink-0',
        remove: 'shrink-0 text-gray-300 dark:text-gray-600 hover:text-red-400 transition-colors p-2 -m-1 touch-manipulation',
        empty: 'text-gray-400 text-xs py-6 text-center',
    },
    overlay: {
        px: 'px-2',
        drag: 'text-gray-300 dark:text-gray-600',
        activeRow: 'bg-sky-50 dark:bg-sky-950/30',
        hoverRow: 'hover:bg-gray-50 dark:hover:bg-gray-800/50',
        activeTrack: 'text-sky-500 dark:text-sky-400',
        normalTrack: '',
        artist: 'text-xs text-gray-400 truncate',
        activePing: 'text-sky-500 dark:text-sky-400',
        artFallback: 'bg-gray-100 dark:bg-gray-800',
        artIcon: 'text-gray-400',
        badge: 'bg-sky-100 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400',
        source: 'text-xs text-gray-400 hover:text-sky-500 truncate max-w-[80px] shrink-0',
        remove: 'shrink-0 text-gray-300 dark:text-gray-600 hover:text-red-400 transition-colors p-2 -m-1 touch-manipulation',
        empty: 'text-gray-400 text-xs py-6 text-center',
    },
} as const

interface QueueRowListProps {
    containerRef: React.RefObject<HTMLDivElement | null>
    items: Array<{ song: PlayableSong; qi: number }>
    start: number; end: number; totalHeight: number; offsetTop: number
    currentUuid: string | null
    isPlaying: boolean
    dragFromRef: React.MutableRefObject<number | null>
    draggedQi: number | null
    setDraggedQi: (n: number | null) => void
    queueDropTarget: number | null
    setQueueDropTarget: (n: number | null) => void
    manualNextIds: Set<string>
    // What is saved, when the queue is to show which songs are not: offline, once the
    // launch scan has finished. `available` and `total` count the whole queue, for the
    // line at the top. Null leaves the queue as it is online.
    offline: { savedIds: Set<string>; available: number; total: number } | null
    queueSearch: string
    setQueueSearch: (s: string) => void
    showSearch: boolean
    searchTestId?: string
    emptyTestId?: string
    reorderQueue: (from: number, to: number) => void
    removeFromQueue: (qi: number) => void
    onPlayAt: (qi: number) => void
    onPause: () => void
    onResume: () => void
    onSourceNav: () => void
    variant: 'panel' | 'overlay'
}

function QueueRowList({
    containerRef, items, start, end, totalHeight, offsetTop,
    currentUuid, isPlaying, dragFromRef, draggedQi, setDraggedQi,
    queueDropTarget, setQueueDropTarget, manualNextIds, offline,
    queueSearch, setQueueSearch, showSearch, searchTestId, emptyTestId,
    reorderQueue, removeFromQueue, onPlayAt, onPause, onResume, onSourceNav,
    variant,
}: QueueRowListProps) {
    const s = QUEUE_STYLES[variant]

    function handlePointerMove(e: React.PointerEvent) {
        const from = dragFromRef.current
        if (from === null) return
        const el = document.elementFromPoint(e.clientX, e.clientY)
        const row = el?.closest('[data-dpos]') as HTMLElement | null
        if (!row) return
        const dpos = parseInt(row.dataset.dpos!)
        if (dpos === from) { setQueueDropTarget(null); return }
        setQueueDropTarget(dpos > from ? dpos + 1 : dpos)
    }

    function handlePointerUp() {
        if (dragFromRef.current !== null && queueDropTarget !== null && dragFromRef.current !== queueDropTarget) {
            reorderQueue(dragFromRef.current, queueDropTarget)
        }
        dragFromRef.current = null; setDraggedQi(null); setQueueDropTarget(null)
    }

    return (
        <>
            {offline && (
                <p data-testid="queue-offline-summary" className="shrink-0 pb-2 text-xs text-gray-400">
                    Offline — {offline.available} of {offline.total} available
                </p>
            )}
            {showSearch && (
                <div className="shrink-0 pb-2">
                    <SearchInput value={queueSearch} onChange={setQueueSearch} placeholder="search queue…" testId={searchTestId ?? 'queue-search'} />
                </div>
            )}
            <div
                ref={containerRef}
                className="overflow-y-auto flex-1"
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
            >
                {queueSearch && items.length === 0 && (
                    <p data-testid={emptyTestId ?? 'queue-search-empty'} className={s.empty}>no songs match &ldquo;{queueSearch}&rdquo;</p>
                )}
                <div style={{ height: totalHeight }}>
                    <div style={{ paddingTop: offsetTop }}>
                        {items.slice(start, end).map(({ song, qi }, i) => {
                            const dpos = start + i
                            const isActive = song.uuid === currentUuid
                            const sp = song.properties
                            const isBeingDragged = draggedQi === dpos
                            const isDropTarget = queueDropTarget === dpos && !isBeingDragged
                            const isDropAfter = queueDropTarget === dpos + 1 && dpos === items.length - 1 && !isBeingDragged
                            const unsaved = offline !== null && !offline.savedIds.has(song.uuid)
                            const art = songArtworkUrl(song.uuid, song.artwork_cached, sp?.artworkUrl100, 200)
                            return (
                                <div
                                    key={`${song.uuid}-${qi}`}
                                    data-qi={qi}
                                    data-dpos={dpos}
                                    data-unsaved={unsaved ? 'true' : undefined}
                                    style={{ height: QUEUE_ROW_H }}
                                    className={`flex items-center gap-3 ${s.px} border-t-2 border-b-2 transition-colors select-none ${isDropTarget ? 'border-t-sky-500' : 'border-t-transparent'} ${isDropAfter ? 'border-b-sky-500' : 'border-b-transparent'} ${isBeingDragged ? 'opacity-40' : unsaved ? 'opacity-50' : ''} ${isActive ? s.activeRow : s.hoverRow}`}
                                >
                                    <span
                                        data-testid={variant === 'panel' ? 'queue-drag-handle' : undefined}
                                        className={`${s.drag} cursor-grab active:cursor-grabbing shrink-0 touch-none select-none p-2 -m-2`}
                                        onPointerDown={e => { e.preventDefault(); dragFromRef.current = dpos; setDraggedQi(dpos); setQueueDropTarget(null) }}
                                    >
                                        <FaBars size={14} />
                                    </span>
                                    <button
                                        onClick={() => isActive ? (isPlaying ? onPause() : onResume()) : onPlayAt(qi)}
                                        className="flex items-center gap-3 flex-1 text-left min-w-0"
                                    >
                                        {art
                                            ? <Image src={art} alt="" width={36} height={36} className="rounded shrink-0 object-cover" unoptimized={!!song.artwork_cached} />
                                            : <div className={`w-9 h-9 rounded shrink-0 ${s.artFallback} flex items-center justify-center`}><FaMusic size={11} className={s.artIcon} /></div>
                                        }
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <p className={`text-sm font-medium truncate ${isActive ? s.activeTrack : s.normalTrack}`}>{sp?.trackName ?? '—'}</p>
                                                {manualNextIds.has(song.uuid) && (
                                                    <span className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${s.badge}`}>Queued</span>
                                                )}
                                            </div>
                                            <p className={s.artist}>{sp?.artistName ?? '—'}</p>
                                        </div>
                                        {unsaved && <MdCloudOff role="img" aria-label="not saved offline" size={14} className="shrink-0 text-gray-400" />}
                                        {isActive && (isPlaying ? <FaPause size={9} className={`${s.activePing} shrink-0`} /> : <FaPlay size={9} className={`${s.activePing} shrink-0`} />)}
                                    </button>
                                    {song.source && (
                                        <Link href={song.source.href} onClick={e => { e.stopPropagation(); onSourceNav() }} className={s.source}>
                                            {song.source.label}
                                        </Link>
                                    )}
                                    <button
                                        data-testid={variant === 'panel' ? 'queue-remove' : undefined}
                                        onClick={() => removeFromQueue(qi)}
                                        className={s.remove}
                                    >
                                        <FaTimes size={10} />
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>
        </>
    )
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
    const audioRef = useRef<HTMLAudioElement>(null)
    const playerBarRef = useRef<HTMLDivElement>(null)
    const [current, setCurrent] = useState<PlayableSong | null>(null)
    const currentRef = useRef<PlayableSong | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [isBuffering, setIsBuffering] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [buffered, setBuffered] = useState(0)
    const [duration, setDuration] = useState(0)
    const [queue, setQueue] = useState<PlayableSong[]>([])
    const [shuffle, setShuffle] = useState(false)
    const [repeat, setRepeat] = useState<RepeatMode>('all')

    const [playContext, setPlayContext] = useState<PlayContext | null>(null)
    const [showQueue, setShowQueue] = useState(false)
    const [showExpanded, setShowExpanded] = useState(false)
    const [expandedTab, setExpandedTab] = useState<'nowplaying' | 'queue'>('nowplaying')
    const [queueSearch, setQueueSearch] = useState('')
    const [volume, setVolume] = useState(() => {
        if (typeof window === 'undefined') return 1
        const saved = localStorage.getItem('playerVolume')
        return saved !== null ? parseFloat(saved) : 1
    })
    const supportsVolumeControl = typeof navigator !== 'undefined' && !/iPad|iPhone|iPod/.test(navigator.userAgent)
    const pendingPosition = useRef<number>(0)
    const shouldPlayRef = useRef(false)
    const loadGenRef = useRef(0)
    const hasUserPlayedRef = useRef(false)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const blobSlotRef = useRef(createBlobSlot())
    // The song whose source was last assigned to the element, which can differ
    // from `current` while a load is in flight.
    const srcUuidRef = useRef<string | null>(null)
    const autoplayActivatedRef = useRef(false)
    // refs mirror state so stable callbacks always see latest values
    const queueRef = useRef<PlayableSong[]>([])
    const queueIndexRef = useRef(-1)
    const manualNextRef = useRef<PlayableSong[]>([])
    const shuffleRef = useRef(false)
    const repeatRef = useRef<RepeatMode>('all')
    // pre-computed shuffle order: indices into queueRef, in the order they'll be played
    const [shuffleOrder, setShuffleOrder] = useState<number[]>([])
    const shuffleOrderRef = useRef<number[]>([])
    const shufflePosRef = useRef(0)
    const [audioSrc, setAudioSrc] = useState('')
    const dragFromRef = useRef<number | null>(null)
    const queueContainerRef = useRef<HTMLDivElement>(null)
    const expandedQueueContainerRef = useRef<HTMLDivElement>(null)
    const [queueDropTarget, setQueueDropTarget] = useState<number | null>(null)
    const [draggedQi, setDraggedQi] = useState<number | null>(null)
    const [manualNextIds, setManualNextIds] = useState<Set<string>>(new Set())
    const [syncPrompt, setSyncPrompt] = useState<{ serverState: PlayerState; localState: PlayerState } | null>(null)
    const libMapRef = useRef<Map<string, LibrarySong>>(new Map())
    const shuffleSeedRef = useRef<number | null>(null)
    const playContextRef = useRef<PlayContext | null>(null)
    // Failure containment. The counter is consecutive failed loads; the snapshot
    // is where the cascade started; stopped is an explicit terminal state that
    // nothing but the user leaves.
    const failureCountRef = useRef(0)
    const failureSnapshotRef = useRef<AdvanceSnapshot | null>(null)
    const stoppedRef = useRef(false)
    // The load generation that has already used its one silent retry, and the
    // generation that assigned the source currently on the element.
    const retriedGenRef = useRef(-1)
    const srcGenRef = useRef(0)
    // The load whose synchronous stream-URL guess has not yet been confirmed or
    // replaced by the resolved source. Errors from the guess are held until then.
    const pendingSwapGenRef = useRef(-1)
    const loadStartPositionRef = useRef(0)
    const lastPositionRef = useRef(0)
    const lastRefreshOutcomeRef = useRef<'none' | RefreshResult>('none')

    const { showToast } = useToast()
    // Which songs have a local copy. Read through refs, never through the context
    // value directly: the advance path is a stable callback with no dependencies
    // and is also captured once into the media-session and keyboard handlers, so
    // a direct read would pin the provider's initial empty set for the whole
    // session and report "no offline copies left" with a full offline library.
    const { cachedIds, cachedIdsStatus, savedNow, dropSaved } = useOfflineSave()
    const online = useOnline()
    const cachedIdsStatusRef = useRef(cachedIdsStatus)
    useEffect(() => { cachedIdsStatusRef.current = cachedIdsStatus }, [cachedIdsStatus])

    // The local copies to filter the advance against, or null for no pre-filter.
    // Online, no provider (the public share page mounts the player without one),
    // and a scan that has not finished all keep today's behaviour; only a
    // finished scan justifies concluding there is nothing left to play. "Offline"
    // is the shared signal, which includes a server that cannot be reached while
    // the browser still reports a connection.
    function offlineOnlyIds(): Set<string> | null {
        if (!isOffline()) return null
        if (cachedIdsStatusRef.current !== 'scanned') return null
        return savedNow()
    }

    function generateShuffleOrder(currentIdx = queueIndexRef.current, existingSeed?: number) {
        const seed = existingSeed ?? (Math.random() * 0xFFFFFFFF | 0)
        shuffleSeedRef.current = seed
        const q = queueRef.current
        // Always pin currentIdx first so the queue display starts at the selected song
        const rest = seededShuffle(q.map((_, i) => i).filter(i => i !== currentIdx), seed)
        const order = currentIdx >= 0 ? [currentIdx, ...rest] : rest
        shuffleOrderRef.current = order
        shufflePosRef.current = 0
        setShuffleOrder([...order])
    }

    // A load found no local copy of the song and there is no network to stream it from.
    // What was playing stops, so it does not carry on under the new song's title. A
    // walk that was stepping to this song as one it believed saved goes on to the next;
    // a tap is told why nothing plays.
    function stopForMissingCopy(audio: HTMLAudioElement, walk: boolean) {
        audio.pause()
        shouldPlayRef.current = false
        if (walk) {
            advanceTrack()
            return
        }
        setIsPlaying(false)
        showToast('not saved offline')
    }

    // `gen` is the load generation that asked for this source. A superseded
    // caller gets null. Omitting `gen` opts out of the check.
    //
    // A blob made here belongs to nobody until `applyAudioSrc` assigns it: this
    // function must not revoke the current one, because the element may still be
    // playing it, and a load that overlaps this one may be about to assign what it
    // made. Every caller assigns the result without an await in between, so a
    // blob made here is never left unassigned.
    async function resolveAudioSrc(songUuid: string, gen?: number): Promise<string | null> {
        const superseded = () => gen !== undefined && gen !== loadGenRef.current
        if (superseded()) return null
        let cached: File | null = null
        let lookupSucceeded = false
        try {
            cached = await getSongFile(songUuid)
            lookupSucceeded = true
        } catch (err) {
            console.warn('could not look up the saved copy of a song', songUuid, err)
        }
        if (superseded()) return null
        if (cached) return URL.createObjectURL(cached)
        // The saved list names a song whose file is missing or empty: the launch scan
        // lists names without opening the files. It stops being a saved song now, in
        // every view. The file itself is left alone: an empty one costs nothing, the
        // next save overwrites it, and deleting here could race a save that has made
        // the file and not yet written it.
        //
        // A lookup that failed says nothing about the file, so online the song is
        // streamed and stays listed. Offline there is no stream to fall back on, and
        // leaving it listed would let the walk land on it again and again: for this
        // session it is treated as missing, and the next launch scans it afresh.
        if (lookupSucceeded || offlineOnlyIds()) dropSaved(songUuid)
        return `${DOWNLOAD_URL}/${songUuid}`
    }

    // "Already loaded" means this exact song's source is on the element and has
    // not failed. `currentRef` is set by an effect after render, so mid-load it can
    // already name the new song while the element still holds the old one's
    // source; the uuid recorded at assignment is what the element actually has.
    // A source that errored is not loaded: keeping it would leave the player
    // showing a song it cannot play through every later sync.
    function sourceAlreadyLoaded(uuid: string): boolean {
        const audio = audioRef.current
        return srcUuidRef.current === uuid && !!audio?.src && !audio.error
    }

    function applyAudioSrc(audio: HTMLAudioElement, src: string, uuid: string) {
        audio.src = src
        blobSlotRef.current.adopt(src)
        srcUuidRef.current = uuid
        srcGenRef.current = loadGenRef.current
        setAudioSrc(src)
    }

    // Called on real playback progress and on anything the user started.
    function clearFailureState() {
        failureCountRef.current = 0
        failureSnapshotRef.current = null
        stoppedRef.current = false
        lastRefreshOutcomeRef.current = 'none'
    }

    function snapshotAdvanceState(): AdvanceSnapshot {
        return {
            queueIndex: queueIndexRef.current,
            shufflePos: shufflePosRef.current,
            shuffleOrder: [...shuffleOrderRef.current],
            shuffleSeed: shuffleSeedRef.current,
            manualNext: [...manualNextRef.current],
        }
    }

    // Restores where the cascade started **without touching the audio source**.
    // Restoring by loading the song would assign a source, fail again in the
    // dead zone, and re-enter the error handler with a freshly zeroed counter —
    // the same endless walk, one toast per lap.
    function restoreAdvanceState(snap: AdvanceSnapshot) {
        queueIndexRef.current = snap.queueIndex
        shufflePosRef.current = snap.shufflePos
        shuffleOrderRef.current = snap.shuffleOrder
        setShuffleOrder([...snap.shuffleOrder])
        shuffleSeedRef.current = snap.shuffleSeed
        manualNextRef.current = snap.manualNext
        setManualNextIds(new Set(snap.manualNext.map(s => s.uuid)))
        const song = queueRef.current[snap.queueIndex]
        if (song) setCurrent(song)
    }

    // The terminal state: nothing but the user leaves it, and it says so once.
    // Shared by the repeated-failure stop and the "nothing saved offline left"
    // stop, which differ in their message and in whether it is an error: running
    // out of saved songs offline is expected, so it gets the plain toast.
    function enterStoppedState(message: string, isError = true) {
        stoppedRef.current = true
        failureCountRef.current = 0
        failureSnapshotRef.current = null
        setIsPlaying(false)
        setIsBuffering(false)
        shouldPlayRef.current = false
        // The element may still be mid-song: the user pressed next, and the walk
        // found nothing to move to. Saying "stopped" over audible playback would
        // be worse than the silence.
        audioRef.current?.pause()
        showToast(message, isError)
        // The cascade or the walk may have moved the queue before the state was
        // put back; the server should hold where the user is now, not where the
        // last debounced save happened to catch it.
        scheduleSave()
    }

    async function applyPlayerState(state: PlayerState) {
        // Everything down to the barrier resolves and decides; nothing writes.
        // A reconcile overtaken by the user tapping a song must leave nothing
        // half-applied behind it, so the generation is re-checked after each
        // await and all writes happen together at the end.
        const gen = loadGenRef.current
        const superseded = () => gen !== loadGenRef.current
        const libMap = libMapRef.current
        let sourceMap: Record<string, PlayContext> = state.queue_sources ?? {}
        if (Object.keys(sourceMap).length === 0) {
            try {
                const raw = localStorage.getItem('playerSources')
                if (raw) sourceMap = JSON.parse(raw)
            } catch {}
        }
        const fallbackCtx = contextFromId(state.play_context ?? null)
        const resolveUuids = async (uuids: string[]): Promise<PlayableSong[]> => {
            const results: PlayableSong[] = []
            for (const id of uuids) {
                const lib = libMap.get(id)
                if (lib?.properties) {
                    results.push({ uuid: lib.uuid, properties: lib.properties!, last_position: lib.last_position, last_played_at: lib.last_played_at, artwork_cached: lib.artwork_cached, source: sourceMap[id] ?? fallbackCtx })
                } else {
                    try {
                        const fetched = await fetchSongById(id)
                        if (fetched) results.push({ ...fetched, source: sourceMap[id] ?? fallbackCtx })
                    } catch {}
                }
            }
            return results
        }

        const audio = audioRef.current
        const restoredQueue = await resolveUuids(state.queue ?? [])
        if (superseded()) return

        if (restoredQueue.length === 0) {
            const entries = [...libMap.values()]
            const last = entries
                .filter(s => s.last_played_at && s.properties)
                .sort((a, b) => new Date(b.last_played_at!).getTime() - new Date(a.last_played_at!).getTime())[0]
            if (!last?.properties) return
            const song: PlayableSong = { uuid: last.uuid, properties: last.properties!, last_position: last.last_position, last_played_at: last.last_played_at, artwork_cached: last.artwork_cached, source: fallbackCtx }
            const keepSource = sourceAlreadyLoaded(song.uuid)
            let src: string | null = null
            if (!keepSource && audio) {
                src = await resolveAudioSrc(song.uuid, gen)
                if (src === null) return
            }
            setCurrent(song)
            queueRef.current = [song]
            queueIndexRef.current = 0
            setQueue([song])
            if (!keepSource) {
                setCurrentTime(last.last_position ?? 0)
                if (audio && src !== null) {
                    pendingPosition.current = last.last_position ?? 0
                    applyAudioSrc(audio, src, song.uuid)
                }
            }
            return
        }

        const safeIndex = Math.max(0, Math.min(state.queue_index, restoredQueue.length - 1))
        const song = restoredQueue[safeIndex]

        const savedManualNext = state.manual_next ?? []
        const resolvedManualNext = savedManualNext.length > 0 ? await resolveUuids(savedManualNext) : []
        if (superseded()) return

        // Source-preserving: the same song already on the element keeps its
        // source and its position. Re-assigning the source would re-download it
        // and seek back to whatever the server last recorded.
        const keepSource = sourceAlreadyLoaded(song.uuid)
        let src: string | null = null
        if (!keepSource && audio) {
            src = await resolveAudioSrc(song.uuid, gen)
            if (src === null) return
        }

        // ---- barrier: everything below writes, and nothing below awaits ----
        setShuffle(state.shuffle)
        shuffleRef.current = state.shuffle
        setRepeat(state.repeat)
        repeatRef.current = state.repeat
        if (state.play_context) setPlayContext(contextFromId(state.play_context))

        queueRef.current = restoredQueue
        queueIndexRef.current = safeIndex
        setQueue(restoredQueue)

        const seed = state.shuffle_seed
        const savedPos = state.shuffle_position ?? 0
        if (isValidShuffleOrder(state.shuffle_order, restoredQueue.length)) {
            shuffleOrderRef.current = state.shuffle_order
            if (seed != null) shuffleSeedRef.current = seed
            shufflePosRef.current = Math.max(0, Math.min(savedPos, state.shuffle_order.length - 1))
            setShuffleOrder([...state.shuffle_order])
        } else if (seed != null) {
            shuffleSeedRef.current = seed
            const rest = seededShuffle(restoredQueue.map((_, i) => i).filter(i => i !== safeIndex), seed)
            const order = [safeIndex, ...rest]
            shuffleOrderRef.current = order
            shufflePosRef.current = Math.max(0, Math.min(savedPos, order.length - 1))
            setShuffleOrder([...order])
        } else if (state.shuffle) {
            generateShuffleOrder(safeIndex)
        }

        manualNextRef.current = resolvedManualNext
        setManualNextIds(new Set(savedManualNext))

        setCurrent(song)
        if (!keepSource) {
            setCurrentTime(song.last_position ?? 0)
            if (audio && src !== null) {
                pendingPosition.current = song.last_position ?? 0
                applyAudioSrc(audio, src, song.uuid)
            }
        }

        // Persist baseline so future reconcile can compare timestamps
        try {
            localStorage.setItem('playerState', JSON.stringify({
                ...state,
                saved_at: state.updated_at ?? new Date().toISOString(),
            }))
        } catch {}
    }

    // The launch checks hasUserPlayedRef itself: that guard protects the launch from a
    // late answer, and has no business stopping a later return to the tab.
    async function reconcilePlayerState(serverState: PlayerState) {
        if (audioRef.current && !audioRef.current.paused) return
        // A change is waiting for its debounced save, so this player is ahead of the
        // server by definition. Comparing against what the server has not heard yet
        // would read the user's own skip or toggle as another device's edit.
        if (saveTimerRef.current) return
        // Or the save has gone out, or is waiting its turn behind a slow request: the
        // server still has not heard, and what it holds is older than this screen.
        if (playerWritesPending()) return

        const localState = readLocalPlayerState()

        // Compare against the player's own live refs once it holds a song:
        // inside the save debounce the mirror in local storage lags, and a
        // lagging mirror produces a false match that drops a real change. At a
        // cold mount nothing is loaded yet, so the mirror is all there is.
        const loaded = currentRef.current != null
        const baseSong = loaded ? currentRef.current!.uuid : localState?.current_song_uuid
        const baseQueue = loaded ? queueRef.current.map(s => s.uuid) : (localState?.queue ?? [])
        const sameSong = baseSong != null && serverState.current_song_uuid === baseSong
        const sameQueue = JSON.stringify(serverState.queue ?? []) === JSON.stringify(baseQueue)
        if (sameSong && sameQueue) {
            // Nothing differs: returning here saves a download. This is an
            // optimisation, not the safety mechanism — applying is safe too,
            // because applying the same song no longer touches the source.
            if (loaded
                && serverState.shuffle === shuffleRef.current
                && serverState.repeat === repeatRef.current
                && JSON.stringify(serverState.manual_next ?? [])
                    === JSON.stringify(manualNextRef.current.map(s => s.uuid))) return
            // This device changed them after the server's copy was made, and the
            // server never heard (the save failed, out of reach): they are the newer
            // ones. Keep them, and send them again.
            if (loaded && localState?.saved_at && serverState.updated_at
                && new Date(localState.saved_at).getTime() > new Date(serverState.updated_at).getTime()) {
                scheduleSave()
                return
            }
            // Same song, but shuffle, repeat or manual-next moved on another
            // device. Apply it: it costs nothing now, and dropping it is the
            // bug this replaces.
            await applyPlayerState(serverState)
            return
        }

        if (!localState) {
            await applyPlayerState(serverState)
            return
        }
        const serverTime = serverState.updated_at ? new Date(serverState.updated_at).getTime() : Infinity
        const localTime = localState.saved_at ? new Date(localState.saved_at).getTime() : 0
        if (localTime > serverTime) {
            setSyncPrompt({ serverState, localState })
            await applyPlayerState(localState)
        } else {
            showToast('Player synced from another device')
            await applyPlayerState(serverState)
        }
    }

    const savePosition = useCallback((song: PlayableSong, time: number) => {
        updatePosition(song.uuid, time).catch(() => {})
    }, [])

    // `startAt` overrides the stored last-played position. The error retry needs
    // it: `last_position` comes from an app-start library snapshot, so reloading
    // on it would throw away however far the song had actually got.
    // `walk` marks a load made by the offline advance stepping to a song it believed
    // was saved, so that finding it is not, it can step on without a word.
    async function loadSong(song: PlayableSong, startAt?: number, walk = false) {
        const audio = audioRef.current
        if (!audio) return
        const gen = ++loadGenRef.current
        const startPosition = startAt ?? song.last_position ?? 0
        pendingPosition.current = startPosition
        loadStartPositionRef.current = startPosition
        lastPositionRef.current = startPosition

        setCurrentTime(0)
        setDuration(0)
        setCurrent(song)
        setIsPlaying(true)

        if (autoplayActivatedRef.current) {
            // Not a gesture path — this already awaits src resolution, so a stale
            // token can be refreshed before the stream request carries it.
            await ensureFreshToken()
            if (gen !== loadGenRef.current) return
            const src = await resolveAudioSrc(song.uuid, gen)
            if (src === null) return
            // Offline there is no stream to fall back on. A song the list called saved
            // had no playable file; the lookup has dropped it, and the walk goes on to
            // the next saved one. A tap on it is told why nothing plays.
            if (src.startsWith(DOWNLOAD_URL) && offlineOnlyIds()) {
                stopForMissingCopy(audio, walk)
                return
            }
            shouldPlayRef.current = true
            applyAudioSrc(audio, src, song.uuid)
            audio.play().catch(() => {})
        } else {
            // First play — must set src + play() synchronously within user-gesture window.
            // Fire the refresh unawaited: any await here and iOS rejects play()
            // silently while the UI has already flipped to "playing".
            void ensureFreshToken()
            const streamSrc = `${DOWNLOAD_URL}/${song.uuid}`
            shouldPlayRef.current = true
            // The stream URL is a guess made to fit inside the gesture window. In
            // airplane mode it always fails, and on a song that is saved offline
            // that failure means nothing — so hold its error until the swap below
            // has had its say, or a saved song never starts in airplane mode.
            pendingSwapGenRef.current = gen
            applyAudioSrc(audio, streamSrc, song.uuid)
            audio.play().catch(() => {})
            // Swap to offline blob if available after gesture window
            const src = await resolveAudioSrc(song.uuid, gen)
            // Superseded: the mark belongs to the newer load now, so leave it.
            if (src === null) return
            pendingSwapGenRef.current = -1
            if (src !== streamSrc) {
                shouldPlayRef.current = true
                applyAudioSrc(audio, src, song.uuid)
            } else if (offlineOnlyIds()) {
                // No local copy and no network to stream from: the stream that was started
                // to fit the gesture window cannot succeed. Say why, and stop.
                stopForMissingCopy(audio, walk)
            } else if (audio.error) {
                // There was no local copy and the stream really did fail. The held
                // error has to surface or the UI sits there claiming to play, so
                // load the same source again and let it error with nothing held.
                audio.load()
            }
        }
    }

    // Runs `start` when the song may be started, and says "not saved offline" when
    // it may not, leaving the player exactly as it was. Online, and while the saved
    // list is unknown, every song may start. Offline the list decides, and once
    // playback has begun the file is opened as well: a name on the list can stand for
    // an empty file, and finding out after the queue and the current song had moved
    // would leave the old song playing under the new one's title.
    //
    // Before the first play there is no await to spare: iOS wants the source set
    // inside the gesture, so `start` runs at once and loadSong finds out afterwards.
    // `start` may return false to say it found the queue had moved on and did nothing.
    // Resolves to whether the song was started.
    function startIfPlayable(uuid: string, start: () => boolean | void): Promise<boolean> {
        const localOnly = offlineOnlyIds()
        if (localOnly && !localOnly.has(uuid)) {
            showToast('not saved offline')
            return Promise.resolve(false)
        }
        if (!localOnly || !autoplayActivatedRef.current) return Promise.resolve(start() !== false)
        return getSongFile(uuid).catch(() => null).then(file => {
            if (file) return start() !== false
            dropSaved(uuid)
            showToast('not saved offline')
            return false
        })
    }

    function play(song: PlayableSong, newQueue?: PlayableSong[], context?: PlayContext) {
        void startIfPlayable(song.uuid, () => startPlaying(song, newQueue, context))
    }

    function startPlaying(song: PlayableSong, newQueue?: PlayableSong[], context?: PlayContext) {
        hasUserPlayedRef.current = true
        clearFailureState()
        const baseQueue = newQueue ?? [song]
        const q = context !== undefined
            ? baseQueue.map(s => ({ ...s, source: s.source ?? context }))
            : baseQueue
        const idx = Math.max(0, q.findIndex(s => s.uuid === song.uuid))
        const playingSong = q[idx] ?? song
        queueRef.current = q
        queueIndexRef.current = idx
        manualNextRef.current = []
        setManualNextIds(new Set())
        setQueue(q)
        if (shuffleRef.current) generateShuffleOrder(idx)
        syncMediaSession(playingSong)
        loadSong(playingSong, 0)
        if (context !== undefined) {
            setPlayContext(context)
            playContextRef.current = context
        }
        scheduleSave()
    }

    function insertNext(song: PlayableSong, silent = false) {

        const q = [...queueRef.current]
        // Clamped because splice clamps: an index past the end would put the song
        // last in the queue but leave the shuffle order naming a slot that is not there.
        const insertAt = Math.min(queueIndexRef.current + 1 + manualNextRef.current.length, q.length)
        q.splice(insertAt, 0, song)
        queueRef.current = q
        manualNextRef.current.push(song)
        setManualNextIds(new Set(manualNextRef.current.map(s => s.uuid)))
        setQueue([...q])
        // Keep shuffleOrder in sync without reseeding: shift ≥insertAt indices up,
        // splice the new index right after the current shuffle position.
        if (shuffleRef.current && shuffleOrderRef.current.length > 0) {
            const order = shuffleOrderRef.current.map(idx => idx >= insertAt ? idx + 1 : idx)
            order.splice(shufflePosRef.current + 1, 0, insertAt)
            shuffleOrderRef.current = order
            setShuffleOrder([...order])
        }
        scheduleSave()
        queueInsert(song.uuid, insertAt, song.source ?? undefined).catch(() => {})
        if (!silent) {
            const afterName = queueRef.current[queueIndexRef.current]?.properties?.trackName
            showToast(afterName ? `Playing after ${afterName}` : 'Added to queue')
        }
    }

    function playNow(song: PlayableSong) {
        hasUserPlayedRef.current = true
        if (queueRef.current.length === 0) {
            play(song)
            return
        }
        const existingIdx = queueRef.current.findIndex(s => s.uuid === song.uuid)
        if (existingIdx >= 0) {
            removeFromQueue(existingIdx)
        }
        manualNextRef.current = []
        setManualNextIds(new Set())
        insertNext(song, true)
        skipNext()
    }

    function removeFromQueue(index: number) {
        const songId = queueRef.current[index]?.uuid
        const q = [...queueRef.current]
        const currentIdx = queueIndexRef.current
        q.splice(index, 1)
        queueRef.current = q
        if (index <= currentIdx) queueIndexRef.current = Math.max(-1, currentIdx - 1)
        setQueue([...q])
        // A manually queued song that leaves the queue leaves the manual list too:
        // the count sets where the next "play next" lands, so a stale entry puts
        // it a slot too far.
        if (songId && manualNextRef.current.some(s => s.uuid === songId)) {
            manualNextRef.current = manualNextRef.current.filter(s => s.uuid !== songId)
            setManualNextIds(new Set(manualNextRef.current.map(s => s.uuid)))
        }
        if (shuffleRef.current && shuffleOrderRef.current.length > 0) {
            const removedShufflePos = shuffleOrderRef.current.indexOf(index)
            const order = shuffleOrderRef.current
                .filter(idx => idx !== index)
                .map(idx => idx > index ? idx - 1 : idx)
            shuffleOrderRef.current = order
            if (removedShufflePos >= 0 && removedShufflePos < shufflePosRef.current) {
                shufflePosRef.current -= 1
            }
            setShuffleOrder([...order])
        }
        scheduleSave()
        if (songId) queueRemove(songId).catch(() => {})
    }

    // fromDpos / toDpos are *display positions* — i.e. positions in the queue panel as the
    // user sees it (which equals shuffleOrder positions when shuffled, queue indices otherwise).
    // toDpos = N means "drop above row N"; toDpos = N+1 means "drop below row N".
    function reorderQueue(fromDpos: number, toDpos: number) {
        if (fromDpos === toDpos || fromDpos === toDpos - 1) return
        if (shuffleRef.current) {
            const order = [...shuffleOrderRef.current]
            const [moved] = order.splice(fromDpos, 1)
            const insertAt = toDpos > fromDpos ? toDpos - 1 : toDpos
            order.splice(insertAt, 0, moved)
            shuffleOrderRef.current = order
            const currentUuid = queueRef.current[queueIndexRef.current]?.uuid
            if (currentUuid) {
                const newPos = order.findIndex(qi => queueRef.current[qi]?.uuid === currentUuid)
                if (newPos >= 0) shufflePosRef.current = newPos
            }
            setShuffleOrder([...order])
            scheduleSave()
            apiQueueReorder(fromDpos, toDpos).catch(() => {})
            return
        }
        const q = [...queueRef.current]
        const [item] = q.splice(fromDpos, 1)
        const insertAt = toDpos > fromDpos ? toDpos - 1 : toDpos
        q.splice(insertAt, 0, item)
        const currentIdx = queueIndexRef.current
        let newIdx = currentIdx
        if (fromDpos === currentIdx) newIdx = insertAt
        else if (fromDpos < currentIdx && insertAt >= currentIdx) newIdx = currentIdx - 1
        else if (fromDpos > currentIdx && insertAt <= currentIdx) newIdx = currentIdx + 1
        queueRef.current = q
        queueIndexRef.current = newIdx
        setQueue([...q])
        scheduleSave()
        apiQueueReorder(fromDpos, toDpos).catch(() => {})
    }

    function onLibraryAdd(song: PlayableSong) {
        if (queueRef.current.length === 0) return
        if (queueRef.current.some(s => s.uuid === song.uuid)) return
        const q = [...queueRef.current]
        if (shuffleRef.current) {
            const insertAt = q.length
            q.push(song)
            queueRef.current = q
            setQueue([...q])
            if (shuffleOrderRef.current.length > 0) {
                const remaining = shuffleOrderRef.current.length - shufflePosRef.current - 1
                const offset = remaining > 0 ? 1 + Math.floor(Math.random() * remaining) : 1
                const shuffleInsertAt = shufflePosRef.current + offset
                const order = [...shuffleOrderRef.current]
                order.splice(shuffleInsertAt, 0, insertAt)
                shuffleOrderRef.current = order
                setShuffleOrder([...order])
            }
            scheduleSave()
            queueInsert(song.uuid, insertAt).catch(() => {})
        } else {
            const trackName = song.properties?.trackName?.toLowerCase() ?? ''
            const currentIdx = queueIndexRef.current
            let insertAt = q.length
            for (let i = currentIdx + 1; i < q.length; i++) {
                const name = q[i].properties?.trackName?.toLowerCase() ?? ''
                if (name > trackName) { insertAt = i; break }
            }
            q.splice(insertAt, 0, song)
            queueRef.current = q
            setQueue([...q])
            scheduleSave()
            queueInsert(song.uuid, insertAt).catch(() => {})
        }
    }

    function onLibraryRemove(songId: string) {
        const idx = queueRef.current.findIndex(s => s.uuid === songId)
        if (idx < 0) return
        if (idx === queueIndexRef.current) return
        removeFromQueue(idx)
    }

    function setMediaAction(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
        try { navigator.mediaSession.setActionHandler(action, handler) } catch {}
    }

    function syncMediaSession(song: PlayableSong) {
        if (!('mediaSession' in navigator) || !song.properties) return
        const p = song.properties
        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        const sizes = [128, 192, 256, 384, 512]
        const artwork: { src: string; sizes: string; type: string }[] = []
        for (const s of sizes) {
            const url = songArtworkUrl(song.uuid, song.artwork_cached, p.artworkUrl100, s)
            if (!url) continue
            const absolute = url.startsWith('/') ? `${origin}${url}` : url
            artwork.push({ src: absolute, sizes: `${s}x${s}`, type: 'image/jpeg' })
        }
        navigator.mediaSession.metadata = new MediaMetadata({
            title: p.trackName,
            artist: p.artistName,
            album: p.collectionName,
            artwork,
        })
        setMediaAction('play', () => resume())
        setMediaAction('pause', () => pause())
        setMediaAction('previoustrack', skipPrev)
        setMediaAction('nexttrack', skipNext)
        setMediaAction('seekto', (details) => {
            const audio = audioRef.current
            if (!audio || details.seekTime == null) return
            audio.currentTime = details.seekTime
            setCurrentTime(details.seekTime)
            updatePositionState()
        })
    }

    function updatePositionState() {
        if (!('mediaSession' in navigator)) return
        const audio = audioRef.current
        if (!audio || !isFinite(audio.duration) || audio.duration <= 0) return
        navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate,
            position: Math.min(audio.currentTime, audio.duration),
        })
    }

    const pause = useCallback(() => {
        const audio = audioRef.current
        const song = currentRef.current
        if (!audio || !song) return
        audio.pause()
        savePosition(song, audio.currentTime)
        setIsPlaying(false)
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
    }, [savePosition])

    const resume = useCallback(() => {
        const audio = audioRef.current
        const song = currentRef.current
        if (!audio || !song) return
        // Pressing play is how the user leaves the stopped state: the budget is
        // theirs to spend again, and the errored element reloads below.
        clearFailureState()
        // Gesture path (button and media-session 'play'): fire unawaited. resume()
        // sets no src, so the rest of the song arrives as range requests carrying
        // whatever cookie is current by then.
        void ensureFreshToken()
        // Offline, a song that is not saved cannot play, so pressing play moves to the
        // next one that can, in queue order.
        const localOnly = offlineOnlyIds()
        if (localOnly && !localOnly.has(song.uuid)) {
            // Nowhere to go, and nothing said: the queue just ended on a song that is
            // not saved. (A walk that found the rest unsaved has already said so.)
            if (!advanceTrack() && !stoppedRef.current) showToast('not saved offline')
            return
        }
        if (audio.error) {
            // A saved song whose file turns out to be missing is stepped over, not
            // reported: pressing play offline is asking for something to play.
            loadSong(song, undefined, !!localOnly)
            return
        }
        audio.play().catch(() => {})
        setIsPlaying(true)
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
        if (song) syncMediaSession(song)
    }, [])

    function handleSeek(t: number) {
        const audio = audioRef.current
        if (!audio) return
        audio.currentTime = t
        setCurrentTime(t)
    }

    // One step of the advance order. Mutates the shuffle position, the manual-next
    // list and the shuffle order exactly as a normal advance would, and returns
    // the index it lands on — or null at the end of a queue that does not repeat.
    // It does **not** move the queue index or load anything, so the offline walk
    // can take several steps before committing to one.
    // `consumedManual` is the manual-next entry this step used up, so a walk that
    // steps over it for want of a local copy can put it back.
    function stepAdvance(): { idx: number; consumedManual: PlayableSong | null } | null {
        const q = queueRef.current
        const idx = queueIndexRef.current
        if (shuffleRef.current) {
            if (manualNextRef.current.length > 0) {
                const consumedManual = manualNextRef.current.shift() ?? null
                setManualNextIds(new Set(manualNextRef.current.map(s => s.uuid)))
                const nextIdx = idx + 1
                if (nextIdx >= q.length) return null
                // advance shuffle position to wherever this manually-queued song lands
                const pos = shuffleOrderRef.current.indexOf(nextIdx)
                if (pos >= 0) shufflePosRef.current = pos
                return { idx: nextIdx, consumedManual }
            }
            const nextPos = shufflePosRef.current + 1
            if (nextPos >= shuffleOrderRef.current.length) {
                if (repeatRef.current !== 'all') return null
                // A new lap. Pinning the song that just ended would replay
                // it back to back, so pick a different one and pin the fresh
                // order to that. Pick-then-pin rather than re-roll-until-
                // different: the reload path rebuilds a missing order as
                // "pinned song, then a seeded shuffle of the rest", so only
                // an order built that way survives a reload.
                const others = q.map((_, i) => i).filter(i => i !== idx)
                const startIdx = others.length > 0
                    ? others[Math.floor(Math.random() * others.length)]
                    : idx
                generateShuffleOrder(startIdx)
                return { idx: startIdx, consumedManual: null }
            }
            shufflePosRef.current = nextPos
            return { idx: shuffleOrderRef.current[nextPos], consumedManual: null }
        }
        const nextIdx = idx + 1
        if (nextIdx >= q.length) {
            if (repeatRef.current !== 'all') return null
            return { idx: 0, consumedManual: null }
        }
        return { idx: nextIdx, consumedManual: null }
    }

    // Moves to the next track without touching the failure budget, and says
    // whether it loaded one. The automatic advances — end of track, and the error
    // cascade — go through this: a song ending is not the user saying "try
    // again". False means the queue has nowhere left to go: either it simply
    // ended (nothing happens, as online) or the walk below stopped the player and
    // told the user why.
    const advanceTrack = useCallback((): boolean => {
        const q = queueRef.current
        if (q.length === 0) return false
        const localOnly = offlineOnlyIds()

        if (!localOnly) {
            const step = stepAdvance()
            if (!step) return false
            queueIndexRef.current = step.idx
            loadSong(q[step.idx], 0)
            scheduleSave()
            return true
        }

        // Offline with nothing in the queue saved: there is nowhere to walk to.
        if (!q.some(s => localOnly.has(s.uuid))) {
            enterStoppedState('no offline copies left', false)
            return false
        }

        // Offline: walk the same order the normal advance would, stepping over
        // songs with no local copy instead of letting each one fail. A saved song
        // is known to be in the queue, so the walk only has to be long enough to
        // reach it: the rest of the lap it is in, then one whole new lap (a repeat-
        // all wrap reshuffles, and the song it lands on is chosen at random), plus
        // up to a lap of slack for each manually queued song, whose jump can move
        // the position anywhere. Shorter than that, the walk gave up with a saved
        // song still ahead.
        const before = snapshotAdvanceState()
        const steppedOverManual: PlayableSong[] = []
        let steppedOver = 0
        const bound = (manualNextRef.current.length + 2) * q.length
        for (let steps = 0; steps < bound; steps++) {
            const step = stepAdvance()
            if (!step) break
            queueIndexRef.current = step.idx
            if (localOnly.has(q[step.idx].uuid)) {
                // Manually queued songs stepped over for want of a local copy keep
                // their queued status, so they are still there when the connection
                // comes back.
                if (steppedOverManual.length > 0) {
                    manualNextRef.current = [...steppedOverManual, ...manualNextRef.current]
                    setManualNextIds(new Set(manualNextRef.current.map(s => s.uuid)))
                }
                loadSong(q[step.idx], 0, true)
                scheduleSave()
                return true
            }
            steppedOver++
            if (step.consumedManual) steppedOverManual.push(step.consumedManual)
        }
        // No saved song ahead. Restore where the walk started so the queue is
        // where the user left it. If the queue just ended there is nothing to
        // report, as online; if unsaved songs stood between here and the end, say
        // so, because the silence would otherwise look like a crash.
        restoreAdvanceState(before)
        if (steppedOver > 0) enterStoppedState('the rest of the queue is not saved offline', false)
        return false
    }, [])

    // What the user presses: a fresh start, so the failure budget resets.
    const skipNext = useCallback(() => {
        clearFailureState()
        advanceTrack()
    }, [advanceTrack])

    const skipPrev = useCallback(() => {
        const audio = audioRef.current
        if (!audio) return
        clearFailureState()
        if (audio.currentTime > 3) {
            audio.currentTime = 0
            setCurrentTime(0)
            return
        }
        const q = queueRef.current
        let prevIdx: number
        let prevPos = -1
        if (shuffleRef.current) {
            prevPos = shufflePosRef.current - 1
            if (prevPos < 0) return
            prevIdx = shuffleOrderRef.current[prevPos]
        } else {
            if (queueIndexRef.current <= 0) return
            prevIdx = queueIndexRef.current - 1
        }
        const prev = q[prevIdx]
        if (!prev) return
        void startIfPlayable(prev.uuid, () => {
            // The queue may have moved while the file was being checked.
            if (queueRef.current !== q) return false
            if (prevPos >= 0) shufflePosRef.current = prevPos
            queueIndexRef.current = prevIdx
            loadSong(prev, 0)
            scheduleSave()
            return true
        })
    }, [])

    // What the player holds right now, in the shape the server stores. Read when
    // the save goes out as well as when it is asked for: a save held behind a slow
    // request must not send what the player held two seconds earlier.
    function buildPlayerState(): PlayerState {
        const ctx = playContextRef.current
        const sources: Record<string, PlayContext> = {}
        for (const s of queueRef.current) if (s.source) sources[s.uuid] = s.source
        for (const s of manualNextRef.current) if (s.source) sources[s.uuid] = s.source
        return {
            shuffle: shuffleRef.current,
            repeat: repeatRef.current,
            queue: queueRef.current.map(s => s.uuid),
            queue_index: queueIndexRef.current,
            shuffle_order: shuffleOrderRef.current,
            play_context: ctx?.id ?? null,
            shuffle_seed: shuffleSeedRef.current,
            shuffle_position: shufflePosRef.current,
            manual_next: manualNextRef.current.map(s => s.uuid),
            current_song_uuid: queueRef.current[queueIndexRef.current]?.uuid ?? null,
            queue_sources: sources,
        }
    }

    function scheduleSave() {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null
            try { localStorage.setItem('playerState', JSON.stringify({ ...buildPlayerState(), saved_at: new Date().toISOString() })) } catch {}
            savePlayerState(buildPlayerState).catch(() => {})
        }, 2000)
    }

    function toggleShuffle() {
        setShuffle(prev => {
            const next = !prev
            shuffleRef.current = next
            if (next) {
                // Resume prior shuffle if seed + order are intact and queue length matches.
                // Otherwise generate a fresh shuffle. Re-anchor position to current song.
                const q = queueRef.current
                const order = shuffleOrderRef.current
                const currentUuid = q[queueIndexRef.current]?.uuid
                if (shuffleSeedRef.current !== null && order.length === q.length && currentUuid) {
                    const newPos = order.findIndex(idx => q[idx]?.uuid === currentUuid)
                    if (newPos >= 0) {
                        shufflePosRef.current = newPos
                        setShuffleOrder([...order])
                    } else {
                        generateShuffleOrder()
                    }
                } else {
                    generateShuffleOrder()
                }
            }
            // Toggle OFF: keep seed/order/pos so the user can re-enter shuffle without re-shuffling.
            scheduleSave()
            return next
        })
    }

    // Resolves to false when nothing was started, so a caller can leave things as
    // they are.
    function playAt(index: number): Promise<boolean> {
        const q = queueRef.current
        if (index < 0 || index >= q.length) return Promise.resolve(false)
        return startIfPlayable(q[index].uuid, () => {
            // The queue may have moved while the file was being checked.
            if (queueRef.current !== q) return false
            clearFailureState()
            queueIndexRef.current = index
            if (shuffleRef.current) {
                const pos = shuffleOrderRef.current.indexOf(index)
                if (pos >= 0) shufflePosRef.current = pos
            }
            loadSong(q[index])
            scheduleSave()
            return true
        })
    }

    function toggleRepeat() {
        setRepeat(prev => {
            const next: RepeatMode = prev === 'off' ? 'one' : prev === 'one' ? 'all' : 'off'
            repeatRef.current = next
            scheduleSave()
            return next
        })
    }

    // Stable listeners — never re-register, so canplay/durationchange are never missed
    useEffect(() => {
        const audio = audioRef.current
        if (!audio) return
        function onCanPlay() {
            setIsBuffering(false)
            if (pendingPosition.current > 0) {
                audio!.currentTime = pendingPosition.current
                setCurrentTime(pendingPosition.current)
                pendingPosition.current = 0
            }
            if (shouldPlayRef.current) {
                shouldPlayRef.current = false
                audio!.play().catch(() => {})
            }
        }
        function onPlay() {
            setIsPlaying(true); setIsBuffering(false); autoplayActivatedRef.current = true
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
        }
        function onPause() {
            if (!shouldPlayRef.current) setIsPlaying(false)
            setIsBuffering(false)
        }
        function onLoadStart() { setIsBuffering(true); setBuffered(0) }
        function onWaiting() { setIsBuffering(true) }
        function onPlaying() { setIsBuffering(false) }
        function onTimeUpdate() {
            setCurrentTime(audio!.currentTime)
            lastPositionRef.current = audio!.currentTime
            if (audio!.buffered.length > 0) setBuffered(audio!.buffered.end(audio!.buffered.length - 1))
            // Enough real progress past where this load started means the song is
            // genuinely playing, so the failure budget resets.
            if ((failureCountRef.current > 0 || stoppedRef.current)
                && audio!.currentTime - loadStartPositionRef.current >= readTestOverride('__playerProgressResetSec', PROGRESS_RESET_SEC)) {
                clearFailureState()
            }
            updatePositionState()
        }
        function onDurationChange() { setDuration(audio!.duration); updatePositionState() }
        function onError() {
            setIsBuffering(false)
            setIsPlaying(false)
        }
        audio.addEventListener('play', onPlay)
        audio.addEventListener('pause', onPause)
        audio.addEventListener('loadstart', onLoadStart)
        audio.addEventListener('waiting', onWaiting)
        audio.addEventListener('playing', onPlaying)
        audio.addEventListener('canplay', onCanPlay)
        audio.addEventListener('timeupdate', onTimeUpdate)
        audio.addEventListener('durationchange', onDurationChange)
        audio.addEventListener('error', onError)
        return () => {
            audio.removeEventListener('play', onPlay)
            audio.removeEventListener('pause', onPause)
            audio.removeEventListener('loadstart', onLoadStart)
            audio.removeEventListener('waiting', onWaiting)
            audio.removeEventListener('playing', onPlaying)
            audio.removeEventListener('canplay', onCanPlay)
            audio.removeEventListener('timeupdate', onTimeUpdate)
            audio.removeEventListener('durationchange', onDurationChange)
            audio.removeEventListener('error', onError)
        }

    }, [])

    // Sync React state with actual audio state when app returns to foreground;
    // re-fetch server state if tab was hidden long enough to go stale
    useEffect(() => {
        let hiddenAt: number | null = null

        async function onVisibilityChange() {
            if (document.visibilityState !== 'visible') {
                hiddenAt = Date.now()
                return
            }
            const audio = audioRef.current
            if (audio) {
                setIsPlaying(!audio.paused)
                setCurrentTime(audio.currentTime)
                if (isFinite(audio.duration)) setDuration(audio.duration)
            }
            const wasHiddenMs = hiddenAt !== null ? Date.now() - hiddenAt : 0
            hiddenAt = null
            // The browser's own word on the connection, on purpose, not the shared offline
            // signal: when the app only believes the server is gone, this return to the
            // tab is the request that finds out it is back.
            if (!navigator.onLine) return
            // Keep the 15-minute token valid before the user can press play. This,
            // not the check at src assignment, is what covers the long pause: a
            // resume sets no src and fetches the rest of the song as range requests.
            // Not awaited: it can take its eight-second timeout, and the state fetch
            // below joins the same refresh if it meets a 401.
            void ensureFreshToken()
            if (wasHiddenMs < readTestOverride('__playerStaleThresholdMs', 0)) return
            const serverState = await fetchPlayerState({ current: true }).catch(() => undefined)
            if (!serverState) return
            await reconcilePlayerState(serverState)
        }
        document.addEventListener('visibilitychange', onVisibilityChange)
        return () => document.removeEventListener('visibilitychange', onVisibilityChange)
    }, [])

    useEffect(() => { currentRef.current = current }, [current])

    // current-dependent: onEnded needs current to save position
    useEffect(() => {
        const audio = audioRef.current
        if (!audio) return
        function onEnded() {
            setIsPlaying(false)
            if (current) savePosition(current, 0)
            if (repeatRef.current === 'one') {
                audio!.currentTime = 0
                audio!.play().catch(() => {})
                setIsPlaying(true)
            } else {
                advanceTrack()
            }
        }
        function onError() {
            // Order matters: stopped, then superseded load, then the held first-play
            // guess, and only then the one-retry and cascade logic. Checking the
            // retry before the first three counts an outgoing load's error against
            // the new song and walks the queue forever.
            if (stoppedRef.current) return
            // Logout clears the cookies before the page navigates away, so the
            // stream can fail on that; the page is leaving, there is nothing to do.
            if (isSigningOut()) return
            // A newer load has started but not yet assigned its source, so this
            // error belongs to the outgoing one.
            if (srcGenRef.current !== loadGenRef.current) return
            // The first play of a session guesses the stream URL synchronously to
            // stay inside the gesture window; offline, that guess fails before the
            // local copy resolves. loadSong resurfaces the error if the swap finds
            // nothing to replace it with.
            if (pendingSwapGenRef.current === loadGenRef.current) return
            const song = current
            if (!song) return
            const name = song.properties?.trackName ?? 'song'
            const code = audio?.error?.code
            const reason = code === 2 ? 'network error'
                : code === 3 ? 'file corrupt or unsupported'
                : code === 4 ? 'source not found'
                : 'playback failed'
            const gen = loadGenRef.current

            if (retriedGenRef.current !== gen) {
                // One silent retry per load, gated on a per-load flag rather than
                // token staleness: in a dead zone the refresh fails too, nothing
                // records the attempt, so a staleness gate would take this branch
                // on every error and never increment the counter.
                retriedGenRef.current = gen
                const failedAt = lastPositionRef.current
                void (async () => {
                    const refreshed = await tryRefresh()
                    lastRefreshOutcomeRef.current = refreshed
                    // The user may have chosen something else while the refresh was
                    // in flight; reloading the old song over it would be worse than
                    // the error.
                    if (gen !== loadGenRef.current) return
                    if (refreshed === 'rejected') {
                        // The refresh token is gone, so every song in the queue
                        // would fail the same way. Walking to the failure limit
                        // would end in "check your connection", which is not what
                        // is wrong. Say so and send the user to sign in.
                        enterStoppedState('session expired — sign in again')
                        redirectToLogin()
                        return
                    }
                    loadSong(song, failedAt)
                    // A failed refresh still consumes the retry, so a dead zone
                    // still reaches the stop: the reload's own generation inherits
                    // the mark. loadSong bumps the generation synchronously, so
                    // this is the generation it just created.
                    retriedGenRef.current = loadGenRef.current
                })()
                return
            }

            if (failureCountRef.current === 0) failureSnapshotRef.current = snapshotAdvanceState()
            failureCountRef.current += 1
            const limit = Math.min(Math.max(queueRef.current.length, 1), MAX_CONSECUTIVE_FAILURES)
            if (failureCountRef.current < limit) {
                showToast(`skipped "${name}" — ${reason}`, true)
                // Nowhere to skip to is the same dead end as the limit: the tail of
                // a queue that does not repeat would otherwise go silent with no
                // stop and no way back to where the cascade began. A walk that
                // stopped the player itself has already said so.
                if (advanceTrack() || stoppedRef.current) return
            }

            const snap = failureSnapshotRef.current
            if (snap) restoreAdvanceState(snap)
            enterStoppedState('playback stopped — check your connection, then press play')
            // A 401 and a dead zone are indistinguishable after the fact: the media
            // error exposes only a numeric code.
            console.warn('[player] playback stopped after repeated failures', {
                mediaErrorCode: code ?? null,
                refresh: lastRefreshOutcomeRef.current,
                failures: limit,
                song: song.uuid,
            })
        }
        audio.addEventListener('ended', onEnded)
        audio.addEventListener('error', onError)
        return () => {
            audio.removeEventListener('ended', onEnded)
            audio.removeEventListener('error', onError)
        }
    }, [current, savePosition, advanceTrack])

    useEffect(() => {
        if (!isPlaying || !current) return
        const posTimer = setInterval(() => {
            if (audioRef.current && current) savePosition(current, audioRef.current.currentTime)
        }, 10000)
        const playTimer = setTimeout(() => {
            if (current) recordPlay(current.uuid).catch(() => {})
        }, 30000)
        return () => {
            clearInterval(posTimer)
            clearTimeout(playTimer)
        }
    }, [isPlaying, current, savePosition])

    useEffect(() => {
        if (current) syncMediaSession(current)
    }, [current, skipNext, skipPrev, pause, resume])

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            const tag = (e.target as HTMLElement).tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
            if (e.key === 'Escape') { setShowExpanded(false); return }
            const audio = audioRef.current
            if (!audio || !currentRef.current) return
            if (e.code === 'Space') {
                e.preventDefault()
                if (audio.paused) resume()
                else pause()
            } else if (e.code === 'ArrowLeft') {
                e.preventDefault()
                skipPrev()
            } else if (e.code === 'ArrowRight') {
                e.preventDefault()
                skipNext()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [pause, resume, skipPrev, skipNext])

    useEffect(() => {
        // A failed request is no answer, like a 401: this device's own copy still restores.
        Promise.all([fetchPlayerStateAtLaunch().catch(() => undefined), fetchLibrarySongsAtLaunch()]).then(async ([answer, libSongs]) => {
            const libMap = new Map((libSongs ?? []).map(s => [s.uuid, s]))
            libMapRef.current = libMap
            // Whatever the user picked while the request was out stands; no answer, fresh or
            // not, replaces it.
            if (hasUserPlayedRef.current) return
            if (answer && !answer.stale) {
                await reconcilePlayerState(answer.state)
                return
            }
            // No answer, or one the service worker served from its cache: that copy is
            // older than anything this device did since the connection dropped, so it
            // is no news to offer the user. This device's own copy wins, and the cached
            // one stands in only when there is nothing local.
            const localState = readLocalPlayerState()
            const restore = localState ?? answer?.state
            if (restore) await applyPlayerState(restore)
        }).catch(() => {})
    }, [])

    useEffect(() => {
        if (audioRef.current) audioRef.current.volume = volume
        try { localStorage.setItem('playerVolume', String(volume)) } catch {}
    }, [volume])

    const queueDisplayItemsAll = useMemo(
        () => shuffle && isValidShuffleOrder(shuffleOrder, queue.length)
            ? shuffleOrder.map(qi => ({ song: queue[qi], qi }))
            : queue.map((song, qi) => ({ song, qi })),
        [shuffle, shuffleOrder, queue]
    )
    // Offline, and only once the launch scan has finished (before that an empty list
    // means nothing has been looked at, not that nothing is saved), the queue marks
    // the songs that will not play. Counted over the whole queue, whatever the search
    // has narrowed the list to.
    const queueSavedIds = !online && cachedIdsStatus === 'scanned' ? cachedIds : null
    const queueOffline = useMemo(
        () => queueSavedIds
            ? { savedIds: queueSavedIds, available: queue.filter(s => queueSavedIds.has(s.uuid)).length, total: queue.length }
            : null,
        [queueSavedIds, queue]
    )

    const queueDisplayItems = useMemo(() => {
        if (!queueSearch.trim()) return queueDisplayItemsAll
        const matched = filterSongs(queueDisplayItemsAll.map(i => i.song), queueSearch)
        const matchedIds = new Set(matched.map(s => s.uuid))
        return queueDisplayItemsAll.filter(i => matchedIds.has(i.song.uuid))
    }, [queueDisplayItemsAll, queueSearch])
    const { start, end, totalHeight, offsetTop } = useVirtualList(queueContainerRef, queueDisplayItems.length, QUEUE_ROW_H, 3, showQueue)
    const { start: eqStart, end: eqEnd, totalHeight: eqTotalHeight, offsetTop: eqOffsetTop } = useVirtualList(expandedQueueContainerRef, queueDisplayItems.length, QUEUE_ROW_H, 3, showExpanded && expandedTab === 'queue')

    useEffect(() => {
        if (!showQueue || !queueContainerRef.current || !current) return
        const idx = queueDisplayItems.findIndex(({ song }) => song.uuid === current.uuid)
        if (idx >= 0) queueContainerRef.current.scrollTop = Math.max(0, idx * QUEUE_ROW_H - 88)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showQueue, current?.uuid])

    useEffect(() => {
        if (!(showExpanded && expandedTab === 'queue') || !expandedQueueContainerRef.current || !current) return
        const idx = queueDisplayItems.findIndex(({ song }) => song.uuid === current.uuid)
        if (idx >= 0) expandedQueueContainerRef.current.scrollTop = Math.max(0, idx * QUEUE_ROW_H - 88)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showExpanded, expandedTab, current?.uuid])

    useEffect(() => {
        if (!showExpanded) setExpandedTab('nowplaying')
    }, [showExpanded])

    useEffect(() => {
        document.body.style.overflow = showExpanded ? 'hidden' : ''
        return () => { document.body.style.overflow = '' }
    }, [showExpanded])

    useEffect(() => {
        const el = playerBarRef.current
        if (!el) {
            document.documentElement.style.setProperty('--player-bar-h', '0px')
            return
        }
        const ro = new ResizeObserver(([entry]) => {
            const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
            document.documentElement.style.setProperty('--player-bar-h', `${h}px`)
        })
        ro.observe(el)
        return () => { ro.disconnect(); document.documentElement.style.setProperty('--player-bar-h', '0px') }
    }, [!!current])

    const p = current?.properties
    const hasQueue = queue.length > 1
    const activeClass = 'text-sky-500'
    const idleClass = 'text-gray-400 hover:text-sky-500 transition-colors'
    const pathname = usePathname()
    const isEditorPage = /^\/songs\/[^/]+\/edit/.test(pathname)

    async function handleSyncLoad() {
        if (!syncPrompt) return
        await applyPlayerState(syncPrompt.serverState)
        setSyncPrompt(null)
        showToast('Loaded player state from other device')
    }

    function handleSyncKeep() {
        setSyncPrompt(null)
        scheduleSave()
        showToast('Kept local player state')
    }

    const contextValue = useMemo(() => ({
        current, isPlaying, queue, shuffle, repeat, playContext,
        play, pause, resume, skipNext, skipPrev, toggleShuffle, toggleRepeat, insertNext, playNow, removeFromQueue, reorderQueue, onLibraryAdd, onLibraryRemove,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [current, isPlaying, queue, shuffle, repeat, playContext])

    return (
        <PlayerContext.Provider value={contextValue}>
            <audio ref={audioRef} src={audioSrc || undefined} preload="metadata" playsInline/>
            {children}
            {syncPrompt && (
                <div data-testid="sync-prompt" className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40">
                    <div className="w-full max-w-md bg-surface rounded-t-2xl p-6 shadow-2xl">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">Player out of sync</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Your local player state differs from another device. Which would you like to keep?</p>
                        <div className="flex gap-3">
                            <button
                                data-testid="sync-load-remote"
                                onClick={handleSyncLoad}
                                className="flex-1 px-4 py-2.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-600 transition-colors"
                            >
                                Load from other device
                            </button>
                            <button
                                data-testid="sync-keep-local"
                                onClick={handleSyncKeep}
                                className="flex-1 px-4 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            >
                                Keep mine
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showExpanded && current && p && (
                <div
                    className="fixed inset-0 z-[65] bg-[var(--background)]"
                >
                    {/* Panel */}
                    <div
                        data-testid="player-expanded"
                        className="relative w-full h-full overflow-hidden flex flex-col bg-[var(--background)] landscape:flex-row"
                        style={{
                            paddingLeft: 'env(safe-area-inset-left, 0px)',
                            paddingRight: 'env(safe-area-inset-right, 0px)',
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Art / Queue column */}
                        <div className="flex-1 min-h-0 flex flex-col p-8 pb-4
                                        landscape:w-[45%] landscape:flex-none landscape:h-full landscape:p-8">
                            {expandedTab === 'queue' ? (
                                <QueueRowList
                                    variant="overlay"
                                    containerRef={expandedQueueContainerRef}
                                    items={queueDisplayItems}
                                    start={eqStart} end={eqEnd} totalHeight={eqTotalHeight} offsetTop={eqOffsetTop}
                                    currentUuid={current.uuid}
                                    isPlaying={isPlaying}
                                    dragFromRef={dragFromRef}
                                    draggedQi={draggedQi} setDraggedQi={setDraggedQi}
                                    queueDropTarget={queueDropTarget} setQueueDropTarget={setQueueDropTarget}
                                    manualNextIds={manualNextIds}
                                    offline={queueOffline}
                                    queueSearch={queueSearch} setQueueSearch={setQueueSearch}
                                    showSearch={queue.length > 5}
                                    reorderQueue={reorderQueue}
                                    removeFromQueue={removeFromQueue}
                                    onPlayAt={qi => { void playAt(qi).then(started => { if (started) setExpandedTab('nowplaying') }) }}
                                    onPause={pause}
                                    onResume={resume}
                                    onSourceNav={() => setShowExpanded(false)}
                                />
                            ) : (
                                <div className="flex-1 flex items-center justify-center">
                                    {(() => {
                                        const a = songArtworkUrl(current.uuid, current.artwork_cached, p.artworkUrl100, 600)
                                        return a
                                            ? <Image src={a} alt="" width={480} height={480} className="rounded-lg w-full max-w-[72vmin] md:max-w-[360px] aspect-square object-cover shadow-2xl" unoptimized={!!current.artwork_cached} />
                                            : <div className="w-full max-w-[72vmin] md:max-w-[360px] aspect-square rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center"><FaMusic size={64} className="text-gray-400" /></div>
                                    })()}
                                </div>
                            )}
                        </div>

                        {/* Controls column */}
                        <div
                            className="shrink-0 flex flex-col px-7
                                       landscape:flex-1 landscape:justify-center landscape:overflow-y-auto landscape:py-6"
                            style={{ paddingBottom: 'max(1.75rem, env(safe-area-inset-bottom, 1.75rem))' }}
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between py-3 mb-1">
                                <button onClick={() => setShowExpanded(false)} className="p-2 -ml-2 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors touch-manipulation" aria-label="Close">
                                    <FaChevronDown size={18} />
                                </button>
                                <span className="text-xs uppercase tracking-widest font-medium text-gray-400 dark:text-gray-500">Now Playing</span>
                                <button
                                    onClick={() => setExpandedTab(t => t === 'queue' ? 'nowplaying' : 'queue')}
                                    className={`p-2 -mr-2 transition-colors touch-manipulation ${expandedTab === 'queue' ? 'text-sky-500 dark:text-sky-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
                                    aria-label="Toggle queue"
                                >
                                    <FaList size={16} />
                                </button>
                            </div>

                            {/* Track info */}
                            <div className="mb-4">
                                <p className="text-xl font-bold truncate">{p.trackName || 'Unknown title'}</p>
                                <p className="text-sky-500 dark:text-sky-400 truncate mt-0.5">{p.artistName || 'Unknown artist'}</p>
                                {p.collectionName && (
                                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">{p.collectionName}</p>
                                )}
                                {playContext && (
                                    <Link href={playContext.href} onClick={() => setShowExpanded(false)} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors mt-0.5 block truncate">
                                        from {playContext.label}
                                    </Link>
                                )}
                            </div>

                            {/* Progress */}
                            <div className="mb-1">
                                <ProgressBar current={currentTime} duration={duration} buffered={buffered} onSeek={handleSeek} />
                            </div>

                            {/* Transport + volume inline */}
                            <div className="flex items-center py-3">
                                <div className="flex-1" />
                                <div className="flex items-center gap-7">
                                    <button aria-pressed={shuffle} onClick={toggleShuffle} className={`shrink-0 transition-colors ${shuffle ? 'text-sky-500 dark:text-sky-400' : 'text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white'}`}><FaRandom size={16} /></button>
                                    <button onClick={skipPrev} disabled={!hasQueue} className="shrink-0 disabled:opacity-30 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors touch-manipulation"><FaStepBackward size={22} /></button>
                                    <button onClick={isPlaying ? pause : resume} className="shrink-0 hover:text-sky-500 dark:hover:text-sky-400 transition-colors touch-manipulation">
                                        {isBuffering && isPlaying ? <Spinner size={32} /> : isPlaying ? <FaPause size={28} /> : <FaPlay size={28} />}
                                    </button>
                                    <button onClick={skipNext} disabled={!hasQueue} className="shrink-0 disabled:opacity-30 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors touch-manipulation"><FaStepForward size={22} /></button>
                                    <button onClick={toggleRepeat} className={`shrink-0 relative transition-colors ${repeat !== 'off' ? 'text-sky-500 dark:text-sky-400' : 'text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white'}`}>
                                        <FaRedo size={16} />
                                        {repeat === 'one' && <span className="absolute -top-1.5 -right-1.5 text-[8px] font-bold leading-none">1</span>}
                                    </button>
                                </div>
                                {/* Volume — hidden on iOS; audio.volume is read-only, hardware controls it */}
                                <div className="flex-1 flex items-center justify-end gap-1.5">
                                    {supportsVolumeControl && <>
                                        <button onClick={() => setVolume(v => v > 0 ? 0 : 1)} className="shrink-0 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors touch-manipulation">
                                            {volume === 0 ? <FaVolumeMute size={12} /> : <FaVolumeUp size={12} />}
                                        </button>
                                        <div className="w-20">
                                            <Slider value={volume} min={0} max={1} step={0.02} onChange={setVolume} label="volume" />
                                        </div>
                                    </>}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {current && p && !isEditorPage && (
                <>
                    {/* Queue panel */}
                    {showQueue && queue.length > 0 && (
                        <div
                            data-testid="player-queue-panel"
                            style={{
                                bottom: 'var(--player-bar-h, 88px)',
                                paddingLeft: 'env(safe-area-inset-left, 0px)',
                                paddingRight: 'env(safe-area-inset-right, 0px)',
                            }}
                            className="fixed z-[60] left-0 right-0 bg-surface border-t border-gray-100 dark:border-gray-800 flex flex-col max-h-[45vh] shadow-2xl
                                       md:left-auto md:right-4 md:w-[360px] md:max-h-[min(520px,70vh)] md:rounded-2xl md:border md:border-gray-200 md:dark:border-gray-700"
                        >
                            {/* header */}
                            <div className="flex flex-col border-b border-gray-100 dark:border-gray-800 shrink-0">
                                <div className="flex items-center justify-between px-4 py-3">
                                    <span className="font-semibold text-sm">Queue</span>
                                    <div className="flex items-center gap-3">
                                        {(() => {
                                            const pos = shuffle
                                                ? shuffleOrder.findIndex(qi => queue[qi]?.uuid === current.uuid)
                                                : queue.findIndex(s => s.uuid === current.uuid)
                                            return <span className="text-xs text-gray-400">{pos + 1} / {queue.length}</span>
                                        })()}
                                        {playContext && (
                                            <Link href={playContext.href} onClick={() => { setShowQueue(false); setQueueSearch('') }} className="text-xs text-gray-400 hover:text-sky-500 transition-colors truncate max-w-[120px]">
                                                {playContext.label}
                                            </Link>
                                        )}
                                        <button onClick={() => { setShowQueue(false); setQueueSearch('') }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-2 -m-1 touch-manipulation">
                                            <FaTimes size={14} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="px-4 flex flex-col flex-1 min-h-0">
                                <QueueRowList
                                    variant="panel"
                                    containerRef={queueContainerRef}
                                    items={queueDisplayItems}
                                    start={start} end={end} totalHeight={totalHeight} offsetTop={offsetTop}
                                    currentUuid={current.uuid}
                                    isPlaying={isPlaying}
                                    dragFromRef={dragFromRef}
                                    draggedQi={draggedQi} setDraggedQi={setDraggedQi}
                                    queueDropTarget={queueDropTarget} setQueueDropTarget={setQueueDropTarget}
                                    manualNextIds={manualNextIds}
                                    offline={queueOffline}
                                    queueSearch={queueSearch} setQueueSearch={setQueueSearch}
                                    showSearch={queue.length > 5}
                                    searchTestId="queue-search"
                                    emptyTestId="queue-search-empty"
                                    reorderQueue={reorderQueue}
                                    removeFromQueue={removeFromQueue}
                                    onPlayAt={playAt}
                                    onPause={pause}
                                    onResume={resume}
                                    onSourceNav={() => setShowQueue(false)}
                                />
                            </div>
                        </div>
                    )}

                    <div ref={playerBarRef} data-testid="player-bar" className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--background)]/90 backdrop-blur-md border-t border-gray-100 dark:border-gray-800">
                        <div className="flex flex-col" style={{ paddingLeft: 'env(safe-area-inset-left, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
                            {/* Mobile: single row. Desktop: three-column layout */}
                            <div className="flex items-center gap-3 px-4 pt-3 pb-1.5 md:grid md:grid-cols-[1fr_auto_1fr]">
                                {/* Left: artwork + track info — entire section opens expanded player */}
                                <div
                                    data-testid="player-expand"
                                    className="flex items-center gap-3 min-w-0 flex-1 md:flex-initial cursor-pointer touch-manipulation select-none"
                                    onClick={() => setShowExpanded(true)}
                                >
                                    <div data-testid="player-expand-art" className="shrink-0">
                                        {(() => { const a = songArtworkUrl(current?.uuid, current?.artwork_cached, p.artworkUrl100, 200); return a
                                            ? <Image src={a} alt="" width={44} height={44} className="rounded w-11 h-11 md:w-9 md:h-9 pointer-events-none" unoptimized={!!current?.artwork_cached} />
                                            : <div className="w-11 h-11 md:w-9 md:h-9 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center pointer-events-none"><FaMusic size={14} className="text-gray-400" /></div>
                                        })()}
                                    </div>
                                    {(() => {
                                        const ctx = current?.source ?? playContext
                                        return ctx ? (
                                            <Link href={ctx.href} onClick={e => { e.stopPropagation(); setShowQueue(false) }} className="flex flex-col min-w-0 flex-1 group">
                                                <span data-testid="player-track-name" className="text-sm md:text-xs font-medium truncate group-hover:text-sky-500 transition-colors">{p.trackName || 'Unknown title'}</span>
                                                <span className="text-sm md:text-xs text-sky-500 truncate">{p.artistName || 'Unknown artist'}</span>
                                                <span className="text-xs text-gray-400 truncate hidden md:block">from {ctx.label}</span>
                                            </Link>
                                        ) : (
                                            <div className="flex flex-col min-w-0 flex-1 pointer-events-none">
                                                <span data-testid="player-track-name" className="text-sm md:text-xs font-medium truncate">{p.trackName || 'Unknown title'}</span>
                                                <span className="text-sm md:text-xs text-sky-500 truncate">{p.artistName || 'Unknown artist'}</span>
                                            </div>
                                        )
                                    })()}
                                </div>

                                {/* Center: transport (desktop only — on mobile lives in right section) */}
                                <div className="hidden md:flex items-center gap-4">
                                    <button data-testid="player-shuffle" aria-pressed={shuffle} onClick={toggleShuffle} className={`shrink-0 ${shuffle ? activeClass : idleClass}`}>
                                        <FaRandom size={13} />
                                    </button>
                                    <button data-testid="player-prev" onClick={skipPrev} disabled={!hasQueue} className={`shrink-0 disabled:opacity-30 ${idleClass}`}>
                                        <FaStepBackward size={13} />
                                    </button>
                                    <button data-testid="player-play-pause" title={isPlaying ? 'pause' : 'play'} onClick={isPlaying ? pause : resume} className={`shrink-0 ${idleClass}`}>
                                        {isBuffering && isPlaying ? <Spinner /> : isPlaying ? <FaPause size={18} /> : <FaPlay size={18} />}
                                    </button>
                                    <button data-testid="player-next" onClick={skipNext} disabled={!hasQueue} className={`shrink-0 disabled:opacity-30 ${idleClass}`}>
                                        <FaStepForward size={13} />
                                    </button>
                                    <button data-testid="player-repeat" onClick={toggleRepeat} title={repeat === 'off' ? 'repeat: off' : repeat === 'one' ? 'repeat: one' : 'repeat: all'} className={`shrink-0 relative ${repeat !== 'off' ? activeClass : idleClass}`}>
                                        <FaRedo size={13} />
                                        {repeat === 'one' && (
                                            <span className="absolute -top-1.5 -right-1.5 text-[8px] font-bold leading-none">1</span>
                                        )}
                                    </button>
                                </div>

                                {/* Right: mobile has all controls; desktop has volume + queue toggle */}
                                <div className="flex items-center gap-3 shrink-0 md:justify-end">
                                    {/* Mobile-only transport */}
                                    <div className="flex md:hidden items-center gap-1">
                                        <button data-testid="player-shuffle" aria-pressed={shuffle} onClick={toggleShuffle} className={`shrink-0 p-2 -m-1 touch-manipulation ${shuffle ? activeClass : idleClass}`}>
                                            <FaRandom size={16} />
                                        </button>
                                        <button data-testid="player-prev" onClick={skipPrev} disabled={!hasQueue} className={`shrink-0 p-2 -m-1 touch-manipulation disabled:opacity-30 ${idleClass}`}>
                                            <FaStepBackward size={16} />
                                        </button>
                                        <button onClick={isPlaying ? pause : resume} className={`shrink-0 p-2 -m-1 touch-manipulation ${idleClass}`}>
                                            {isBuffering && isPlaying ? <Spinner size={20} /> : isPlaying ? <FaPause size={20} /> : <FaPlay size={20} />}
                                        </button>
                                        <button data-testid="player-next" onClick={skipNext} disabled={!hasQueue} className={`shrink-0 p-2 -m-1 touch-manipulation disabled:opacity-30 ${idleClass}`}>
                                            <FaStepForward size={16} />
                                        </button>
                                        <button data-testid="player-repeat" onClick={toggleRepeat} title={repeat === 'off' ? 'repeat: off' : repeat === 'one' ? 'repeat: one' : 'repeat: all'} className={`shrink-0 p-2 -m-1 touch-manipulation relative ${repeat !== 'off' ? activeClass : idleClass}`}>
                                            <FaRedo size={16} />
                                            {repeat === 'one' && (
                                                <span className="absolute top-0 right-0 text-[8px] font-bold leading-none">1</span>
                                            )}
                                        </button>
                                    </div>
                                    {/* Queue toggle (both breakpoints) — bigger tap target on mobile */}
                                    <button data-testid="player-queue-toggle" onClick={() => { setShowQueue(v => !v); if (showQueue) setQueueSearch('') }} className={`shrink-0 p-2 -m-1 touch-manipulation ${showQueue ? activeClass : idleClass}`}>
                                        <FaList size={16} className="md:w-3 md:h-3" />
                                    </button>
                                    {/* Volume controls: non-iOS desktop only */}
                                    {supportsVolumeControl && <div className="hidden md:flex items-center gap-1.5 shrink-0">
                                        <button onClick={() => setVolume(v => v > 0 ? 0 : 1)} className={idleClass}>
                                            {volume === 0 ? <FaVolumeMute size={12} /> : <FaVolumeUp size={12} />}
                                        </button>
                                        <div className="w-16">
                                            <Slider value={volume} min={0} max={1} step={0.02} onChange={setVolume} label="volume" />
                                        </div>
                                    </div>}
                                </div>
                            </div>
                            <div data-testid="player-progress" className="flex px-4">
                                <ProgressBar current={currentTime} duration={duration} buffered={buffered} onSeek={handleSeek} />
                            </div>
                        </div>
                    </div>
                </>
            )}
        </PlayerContext.Provider>
    )
}
