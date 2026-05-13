'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useToast } from "./toast"
import { useVirtualList } from "../lib/use-virtual-list"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { FaPause, FaPlay, FaStepBackward, FaStepForward, FaRandom, FaRedo, FaList, FaTimes, FaVolumeUp, FaVolumeMute, FaBars, FaMusic } from "react-icons/fa"
import Spinner from "./spinner"
import { DOWNLOAD_URL, LibrarySong, PlayableSong, PlayerState, artworkUrl, songArtworkUrl, fetchLibrarySongs, fetchPlayerState, fetchSongById, recordPlay, savePlayerState, updatePosition, queueInsert, queueRemove, queueReorder as apiQueueReorder } from "../lib/data"
import { getSongFile, cacheArtworkUrls } from "../lib/offline"
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

export function PlayerProvider({ children }: { children: React.ReactNode }) {
    const audioRef = useRef<HTMLAudioElement>(null)
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
    const [volume, setVolume] = useState(() => {
        if (typeof window === 'undefined') return 1
        const saved = localStorage.getItem('playerVolume')
        return saved !== null ? parseFloat(saved) : 1
    })
    const pendingPosition = useRef<number>(0)
    const shouldPlayRef = useRef(false)
    const loadGenRef = useRef(0)
    const hasUserPlayedRef = useRef(false)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const blobUrlRef = useRef<string | null>(null)
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
    const [queueDropTarget, setQueueDropTarget] = useState<number | null>(null)
    const [draggedQi, setDraggedQi] = useState<number | null>(null)
    const [manualNextIds, setManualNextIds] = useState<Set<string>>(new Set())
    const [syncPrompt, setSyncPrompt] = useState<{ serverState: PlayerState; localState: PlayerState } | null>(null)
    const libMapRef = useRef<Map<string, LibrarySong>>(new Map())
    const shuffleSeedRef = useRef<number | null>(null)
    const playContextRef = useRef<PlayContext | null>(null)

    const { showToast } = useToast()

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

    async function resolveAudioSrc(songUuid: string): Promise<string> {
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current)
            blobUrlRef.current = null
        }
        try {
            const cached = await getSongFile(songUuid)
            if (cached) {
                blobUrlRef.current = URL.createObjectURL(cached)
                return blobUrlRef.current
            }
        } catch {}
        return `${DOWNLOAD_URL}/${songUuid}`
    }

    function applyAudioSrc(audio: HTMLAudioElement, src: string) {
        audio.src = src
        setAudioSrc(src)
    }

    async function applyPlayerState(state: PlayerState) {
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

        setShuffle(state.shuffle)
        shuffleRef.current = state.shuffle
        setRepeat(state.repeat)
        repeatRef.current = state.repeat
        if (state.play_context) setPlayContext(contextFromId(state.play_context))

        const restoredQueue = await resolveUuids(state.queue ?? [])

        if (restoredQueue.length === 0) {
            const entries = [...libMap.values()]
            const last = entries
                .filter(s => s.last_played_at && s.properties)
                .sort((a, b) => new Date(b.last_played_at!).getTime() - new Date(a.last_played_at!).getTime())[0]
            if (last?.properties) {
                const song: PlayableSong = { uuid: last.uuid, properties: last.properties!, last_position: last.last_position, last_played_at: last.last_played_at, artwork_cached: last.artwork_cached, source: fallbackCtx }
                setCurrent(song)
                setCurrentTime(last.last_position ?? 0)
                queueRef.current = [song]
                queueIndexRef.current = 0
                setQueue([song])
                const audio = audioRef.current
                if (audio) {
                    pendingPosition.current = last.last_position ?? 0
                    const src = await resolveAudioSrc(last.uuid)
                    applyAudioSrc(audio, src)
                }
            }
            return
        }

        const safeIndex = Math.max(0, Math.min(state.queue_index, restoredQueue.length - 1))
        const song = restoredQueue[safeIndex]
        queueRef.current = restoredQueue
        queueIndexRef.current = safeIndex
        setQueue(restoredQueue)

        const seed = state.shuffle_seed
        const savedPos = state.shuffle_position ?? 0
        if (state.shuffle_order && state.shuffle_order.length === restoredQueue.length) {
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

        const savedManualNext = state.manual_next ?? []
        if (savedManualNext.length > 0) {
            manualNextRef.current = await resolveUuids(savedManualNext)
            setManualNextIds(new Set(savedManualNext))
        } else {
            manualNextRef.current = []
            setManualNextIds(new Set())
        }

        setCurrent(song)
        setCurrentTime(song.last_position ?? 0)
        const audio = audioRef.current
        if (audio) {
            pendingPosition.current = song.last_position ?? 0
            const src = await resolveAudioSrc(song.uuid)
            applyAudioSrc(audio, src)
        }
    }

    const savePosition = useCallback((song: PlayableSong, time: number) => {
        updatePosition(song.uuid, time).catch(() => {})
    }, [])

    async function loadSong(song: PlayableSong, fromStart = false) {
        const audio = audioRef.current
        if (!audio) return
        const gen = ++loadGenRef.current
        pendingPosition.current = fromStart ? 0 : (song.last_position ?? 0)

        setCurrentTime(0)
        setDuration(0)
        setCurrent(song)
        setIsPlaying(true)

        if (autoplayActivatedRef.current) {
            const src = await resolveAudioSrc(song.uuid)
            if (gen !== loadGenRef.current) return
            shouldPlayRef.current = true
            applyAudioSrc(audio, src)
            audio.play().catch(() => {})
        } else {
            // First play — must set src + play() synchronously within user-gesture window.
            const streamSrc = `${DOWNLOAD_URL}/${song.uuid}`
            shouldPlayRef.current = true
            applyAudioSrc(audio, streamSrc)
            audio.play().catch(() => {})
            // Swap to offline blob if available after gesture window
            const src = await resolveAudioSrc(song.uuid)
            if (gen !== loadGenRef.current) return
            if (src !== streamSrc) {
                shouldPlayRef.current = true
                applyAudioSrc(audio, src)
            }
        }
    }

    function play(song: PlayableSong, newQueue?: PlayableSong[], context?: PlayContext) {
        hasUserPlayedRef.current = true
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
        loadSong(playingSong, true)
        if (context !== undefined) {
            setPlayContext(context)
            playContextRef.current = context
        }
        scheduleSave()
    }

    function insertNext(song: PlayableSong, silent = false) {
        if (queueRef.current.some(s => s.uuid === song.uuid)) {
            if (!silent) showToast('Already in queue')
            return
        }
        const q = [...queueRef.current]
        const insertAt = queueIndexRef.current + 1 + manualNextRef.current.length
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
        if (audio.error) {
            loadSong(song)
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

    const skipNext = useCallback(() => {
        const q = queueRef.current
        const idx = queueIndexRef.current
        if (q.length === 0) return
        let nextIdx: number
        if (shuffleRef.current) {
            if (manualNextRef.current.length > 0) {
                manualNextRef.current.shift()
                setManualNextIds(new Set(manualNextRef.current.map(s => s.uuid)))
                nextIdx = idx + 1
                if (nextIdx >= q.length) return
                // advance shuffle position to wherever this manually-queued song lands
                const pos = shuffleOrderRef.current.indexOf(nextIdx)
                if (pos >= 0) shufflePosRef.current = pos
            } else {
                const nextPos = shufflePosRef.current + 1
                if (nextPos >= shuffleOrderRef.current.length) {
                    if (repeatRef.current === 'all') { generateShuffleOrder(idx); nextIdx = shuffleOrderRef.current[shufflePosRef.current] ?? idx }
                    else return
                } else {
                    shufflePosRef.current = nextPos
                    nextIdx = shuffleOrderRef.current[nextPos]
                }
            }
        } else {
            nextIdx = idx + 1
            if (nextIdx >= q.length) {
                if (repeatRef.current === 'all') nextIdx = 0
                else return
            }
        }
        queueIndexRef.current = nextIdx
        loadSong(q[nextIdx], true)
        scheduleSave()
    }, [])

    const skipPrev = useCallback(() => {
        const audio = audioRef.current
        if (!audio) return
        if (audio.currentTime > 3) {
            audio.currentTime = 0
            setCurrentTime(0)
            return
        }
        const idx = queueIndexRef.current
        if (shuffleRef.current) {
            const prevPos = shufflePosRef.current - 1
            if (prevPos < 0) return
            shufflePosRef.current = prevPos
            const prevIdx = shuffleOrderRef.current[prevPos]
            queueIndexRef.current = prevIdx
            loadSong(queueRef.current[prevIdx], true)
        } else {
            if (idx <= 0) return
            queueIndexRef.current = idx - 1
            loadSong(queueRef.current[idx - 1], true)
        }
        scheduleSave()
    }, [])

    function scheduleSave() {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
            const ctx = playContextRef.current
            const sources: Record<string, PlayContext> = {}
            for (const s of queueRef.current) if (s.source) sources[s.uuid] = s.source
            for (const s of manualNextRef.current) if (s.source) sources[s.uuid] = s.source
            const state = {
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
            try { localStorage.setItem('playerState', JSON.stringify({ ...state, saved_at: new Date().toISOString() })) } catch {}
            savePlayerState(state).catch(() => {})
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

    function playAt(index: number) {
        const q = queueRef.current
        if (index < 0 || index >= q.length) return
        queueIndexRef.current = index
        if (shuffleRef.current) {
            const pos = shuffleOrderRef.current.indexOf(index)
            if (pos >= 0) shufflePosRef.current = pos
        }
        loadSong(q[index])
        scheduleSave()
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
            if (audio!.buffered.length > 0) setBuffered(audio!.buffered.end(audio!.buffered.length - 1))
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

    // Sync React state with actual audio state when app returns to foreground
    useEffect(() => {
        function onVisibilityChange() {
            if (document.visibilityState !== 'visible') return
            const audio = audioRef.current
            if (!audio) return
            setIsPlaying(!audio.paused)
            setCurrentTime(audio.currentTime)
            if (isFinite(audio.duration)) setDuration(audio.duration)
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
                skipNext()
            }
        }
        function onError() {
            const name = current?.properties?.trackName ?? 'song'
            const code = audio?.error?.code
            const reason = code === 2 ? 'network error'
                : code === 3 ? 'file corrupt or unsupported'
                : code === 4 ? 'source not found'
                : 'playback failed'
            if (current) showToast(`skipped "${name}" — ${reason}`, true)
            skipNext()
        }
        audio.addEventListener('ended', onEnded)
        audio.addEventListener('error', onError)
        return () => {
            audio.removeEventListener('ended', onEnded)
            audio.removeEventListener('error', onError)
        }
    }, [current, savePosition, skipNext])

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
        Promise.all([fetchPlayerState(), fetchLibrarySongs()]).then(async ([serverState, libSongs]) => {
            const libMap = new Map((libSongs ?? []).map(s => [s.uuid, s]))
            libMapRef.current = libMap

            let localState: (PlayerState & { saved_at?: string }) | undefined
            try {
                const raw = localStorage.getItem('playerState')
                if (raw) localState = JSON.parse(raw)
            } catch {}

            const queuesMatch = serverState && localState
                && serverState.current_song_uuid === localState.current_song_uuid
                && JSON.stringify(serverState.queue) === JSON.stringify(localState.queue)

            let state: PlayerState | undefined
            if (serverState && localState && !queuesMatch) {
                const serverTime = serverState.updated_at ? new Date(serverState.updated_at).getTime() : Infinity
                const localTime = localState.saved_at ? new Date(localState.saved_at).getTime() : 0
                if (localTime > serverTime) {
                    setSyncPrompt({ serverState, localState })
                    state = localState
                } else {
                    showToast('Player synced from another device')
                    state = serverState
                }
            } else {
                state = serverState ?? localState
            }

            if (!state || hasUserPlayedRef.current) return
            await applyPlayerState(state)
        }).catch(() => {})
    }, [])

    useEffect(() => {
        if (audioRef.current) audioRef.current.volume = volume
        try { localStorage.setItem('playerVolume', String(volume)) } catch {}
    }, [volume])

    const QUEUE_ROW_H = 52
    const queueDisplayItems = useMemo(
        () => shuffle && shuffleOrder.length === queue.length
            ? shuffleOrder.map(qi => ({ song: queue[qi], qi }))
            : queue.map((song, qi) => ({ song, qi })),
        [shuffle, shuffleOrder, queue]
    )
    const { start, end, totalHeight, offsetTop } = useVirtualList(queueContainerRef, queueDisplayItems.length, QUEUE_ROW_H, 3, showQueue)

    useEffect(() => {
        if (!showQueue || !queueContainerRef.current || !current) return
        const idx = queueDisplayItems.findIndex(({ song }) => song.uuid === current.uuid)
        if (idx >= 0) queueContainerRef.current.scrollTop = Math.max(0, idx * QUEUE_ROW_H - 88)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showQueue, current?.uuid])

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
                    <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-t-2xl p-6 shadow-2xl">
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
            {current && p && !isEditorPage && (
                <>
                    {/* Queue panel */}
                    {showQueue && queue.length > 0 && (
                        <div
                            data-testid="player-queue-panel"
                            className="fixed z-[60] left-0 right-0 bottom-[88px] bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 flex flex-col max-h-[45vh] shadow-2xl
                                       md:left-auto md:right-4 md:bottom-24 md:w-[360px] md:max-h-[min(520px,70vh)] md:rounded-2xl md:border md:border-gray-200 md:dark:border-gray-700"
                        >
                            {/* header */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
                                <span className="font-semibold text-sm">Queue</span>
                                <div className="flex items-center gap-3">
                                    {(() => {
                                        const pos = shuffle
                                            ? shuffleOrder.findIndex(qi => queue[qi]?.uuid === current.uuid)
                                            : queue.findIndex(s => s.uuid === current.uuid)
                                        return <span className="text-xs text-gray-400">{pos + 1} / {queue.length}</span>
                                    })()}
                                    {playContext && (
                                        <Link href={playContext.href} onClick={() => setShowQueue(false)} className="text-xs text-gray-400 hover:text-sky-500 transition-colors truncate max-w-[120px]">
                                            {playContext.label}
                                        </Link>
                                    )}
                                    <button onClick={() => setShowQueue(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">
                                        <FaTimes size={14} />
                                    </button>
                                </div>
                            </div>
                            {/* virtual scroll rows */}
                            <div
                                ref={queueContainerRef}
                                className="overflow-y-auto flex-1"
                                onPointerMove={e => {
                                    const from = dragFromRef.current
                                    if (from === null) return
                                    const el = document.elementFromPoint(e.clientX, e.clientY)
                                    const row = el?.closest('[data-dpos]') as HTMLElement | null
                                    if (!row) return
                                    const dpos = parseInt(row.dataset.dpos!)
                                    if (dpos === from) { setQueueDropTarget(null); return }
                                    setQueueDropTarget(dpos > from ? dpos + 1 : dpos)
                                }}
                                onPointerUp={() => {
                                    if (dragFromRef.current !== null && queueDropTarget !== null && dragFromRef.current !== queueDropTarget) {
                                        reorderQueue(dragFromRef.current, queueDropTarget)
                                    }
                                    dragFromRef.current = null
                                    setDraggedQi(null)
                                    setQueueDropTarget(null)
                                }}
                                onPointerLeave={() => {
                                    dragFromRef.current = null
                                    setDraggedQi(null)
                                    setQueueDropTarget(null)
                                }}
                            >
                                <div style={{ height: totalHeight }}>
                                    <div style={{ paddingTop: offsetTop }}>
                                        {queueDisplayItems.slice(start, end).map(({ song, qi }, i) => {
                                            const dpos = start + i
                                            const isActive = song.uuid === current.uuid
                                            const sp = song.properties
                                            const isBeingDragged = draggedQi === dpos
                                            const isDropTarget = queueDropTarget === dpos && !isBeingDragged
                                            const isDropAfter = queueDropTarget === dpos + 1 && dpos === queueDisplayItems.length - 1 && !isBeingDragged
                                            return (
                                                <div
                                                    key={`${song.uuid}-${qi}`}
                                                    data-qi={qi}
                                                    data-dpos={dpos}
                                                    style={{ height: QUEUE_ROW_H }}
                                                    className={`flex items-center gap-3 px-4 border-t-2 border-b-2 transition-colors select-none ${isDropTarget ? 'border-t-sky-500' : 'border-t-transparent'} ${isDropAfter ? 'border-b-sky-500' : 'border-b-transparent'} ${isBeingDragged ? 'opacity-40' : ''} ${isActive ? 'bg-sky-50 dark:bg-sky-950/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
                                                >
                                                    <span
                                                        data-testid="queue-drag-handle"
                                                        className="text-gray-300 dark:text-gray-600 cursor-grab active:cursor-grabbing shrink-0 touch-none select-none p-2 -m-2"
                                                        onPointerDown={e => { e.preventDefault(); dragFromRef.current = dpos; setDraggedQi(dpos); setQueueDropTarget(null) }}
                                                    >
                                                        <FaBars size={14} />
                                                    </span>
                                                    <button onClick={() => { if (isActive) { isPlaying ? pause() : resume() } else { playAt(qi) } }} className="flex items-center gap-3 flex-1 text-left min-w-0">
                                                        {(() => { const a = songArtworkUrl(song.uuid, song.artwork_cached, sp?.artworkUrl100, 200); return a ? <Image src={a} alt="" width={36} height={36} className="rounded shrink-0 object-cover" unoptimized={!!song.artwork_cached} /> : <div className="w-9 h-9 rounded shrink-0 bg-gray-100 dark:bg-gray-800 flex items-center justify-center"><FaMusic size={11} className="text-gray-400" /></div> })()}
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-1.5">
                                                                <p className={`text-sm font-medium truncate ${isActive ? 'text-sky-500' : ''}`}>{sp?.trackName ?? '—'}</p>
                                                                {manualNextIds.has(song.uuid) && (
                                                                    <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 shrink-0">Queued</span>
                                                                )}
                                                            </div>
                                                            <p className="text-xs text-gray-400 truncate">{sp?.artistName ?? '—'}</p>
                                                        </div>
                                                        {isActive && (isPlaying ? <FaPause size={9} className="text-sky-500 shrink-0" /> : <FaPlay size={9} className="text-sky-500 shrink-0" />)}
                                                    </button>
                                                    {song.source && (
                                                        <Link href={song.source.href} onClick={e => { e.stopPropagation(); setShowQueue(false) }} className="text-xs text-gray-400 hover:text-sky-500 truncate max-w-[80px] shrink-0">
                                                            {song.source.label}
                                                        </Link>
                                                    )}
                                                    <button data-testid="queue-remove" onClick={() => removeFromQueue(qi)} className="shrink-0 text-gray-300 dark:text-gray-600 hover:text-red-400 transition-colors p-1">
                                                        <FaTimes size={10} />
                                                    </button>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div data-testid="player-bar" className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--background)]/90 backdrop-blur-md border-t border-gray-100 dark:border-gray-800">
                        <div className="flex flex-col">
                            {/* Mobile: single row. Desktop: three-column layout */}
                            <div className="flex items-center gap-3 px-4 pt-3 pb-1.5 md:grid md:grid-cols-[1fr_auto_1fr]">
                                {/* Left: artwork + track info */}
                                <div className="flex items-center gap-3 min-w-0 flex-1 md:flex-initial">
                                    {(() => { const a = songArtworkUrl(current?.uuid, current?.artwork_cached, p.artworkUrl100, 200); return a ? <Image src={a} alt="" width={44} height={44} className="rounded shrink-0 w-11 h-11 md:w-9 md:h-9" unoptimized={!!current?.artwork_cached} /> : null })()}
                                    {(() => {
                                        const ctx = current?.source ?? playContext
                                        return ctx ? (
                                            <Link href={ctx.href} onClick={() => setShowQueue(false)} className="flex flex-col min-w-0 flex-1 group">
                                                <span data-testid="player-track-name" className="text-sm md:text-xs font-medium truncate group-hover:text-sky-500 transition-colors">{p.trackName || 'Unknown title'}</span>
                                                <span className="text-sm md:text-xs text-sky-500 truncate">{p.artistName || 'Unknown artist'}</span>
                                                <span className="text-xs text-gray-400 truncate hidden md:block">from {ctx.label}</span>
                                            </Link>
                                        ) : (
                                            <div className="flex flex-col min-w-0 flex-1">
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
                                    <button data-testid="player-play-pause" onClick={isPlaying ? pause : resume} className={`shrink-0 ${idleClass}`}>
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
                                    <button data-testid="player-queue-toggle" onClick={() => setShowQueue(v => !v)} className={`shrink-0 p-2 -m-1 touch-manipulation ${showQueue ? activeClass : idleClass}`}>
                                        <FaList size={16} className="md:w-3 md:h-3" />
                                    </button>
                                    {/* Volume controls: desktop only — mobile audio.volume is ignored by iOS/Android, system handles it */}
                                    <div className="hidden md:flex items-center gap-1.5 shrink-0">
                                        <button onClick={() => setVolume(v => v > 0 ? 0 : 1)} className={idleClass}>
                                            {volume === 0 ? <FaVolumeMute size={12} /> : <FaVolumeUp size={12} />}
                                        </button>
                                        <div className="w-16">
                                            <Slider value={volume} min={0} max={1} step={0.02} onChange={setVolume} label="volume" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div data-testid="player-progress" className="flex px-4 pb-3">
                                <ProgressBar current={currentTime} duration={duration} buffered={buffered} onSeek={handleSeek} />
                            </div>
                        </div>
                    </div>
                </>
            )}
        </PlayerContext.Provider>
    )
}
