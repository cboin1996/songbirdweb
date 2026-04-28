'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { FaPause, FaPlay, FaStepBackward, FaStepForward, FaRandom, FaRedo, FaList, FaTimes, FaVolumeUp, FaVolumeMute, FaBars } from "react-icons/fa"
import { DOWNLOAD_URL, PlayableSong, artworkUrl, fetchLibrarySongs, fetchPlayerState, recordPlay, savePlayerState, updatePosition } from "../lib/data"
import { getSongFile } from "../lib/offline"
import Slider from "./slider"

export type RepeatMode = 'off' | 'one' | 'all'
export type PlayContext = { label: string; href: string; id?: string }

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
    removeFromQueue: (index: number) => void
    reorderQueue: (fromIdx: number, toIdx: number) => void
}

const PlayerContext = createContext<PlayerContextValue>({
    current: null,
    isPlaying: false,
    queue: [],
    shuffle: false,
    repeat: 'off',
    playContext: null,
    play: () => {},
    pause: () => {},
    resume: () => {},
    skipNext: () => {},
    skipPrev: () => {},
    toggleShuffle: () => {},
    toggleRepeat: () => {},
    insertNext: () => {},
    removeFromQueue: () => {},
    reorderQueue: () => {},
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

function ProgressBar({ current, duration, onSeek }: {
    current: number
    duration: number
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

    return (
        <div className="flex items-center gap-3 flex-1">
            <span className="text-xs text-gray-400 tabular-nums w-8 text-right shrink-0">{fmt(current)}</span>
            <div
                ref={barRef}
                onMouseDown={onMouseDown}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove}
                className="flex-1 h-0.5 bg-gray-200 dark:bg-gray-700 rounded-full cursor-pointer group relative"
            >
                <div
                    className="h-full bg-sky-500 rounded-full relative"
                    style={{ width: `${pct}%` }}
                >
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-sky-500 rounded-full opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity touch-manipulation" />
                </div>
            </div>
            <span className="text-xs text-gray-400 tabular-nums w-8 shrink-0">-{fmt((duration || 0) - current)}</span>
        </div>
    )
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
    const audioRef = useRef<HTMLAudioElement>(null)
    const [current, setCurrent] = useState<PlayableSong | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [queue, setQueue] = useState<PlayableSong[]>([])
    const [shuffle, setShuffle] = useState(false)
    const [repeat, setRepeat] = useState<RepeatMode>('off')

    const [playContext, setPlayContext] = useState<PlayContext | null>(null)
    const [showQueue, setShowQueue] = useState(false)
    const [volume, setVolume] = useState(1)
    const pendingPosition = useRef<number>(0)
    const shouldPlayRef = useRef(false)
    const loadGenRef = useRef(0)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const blobUrlRef = useRef<string | null>(null)
    const autoplayActivatedRef = useRef(false)
    // refs mirror state so stable callbacks always see latest values
    const queueRef = useRef<PlayableSong[]>([])
    const queueIndexRef = useRef(-1)
    const manualNextRef = useRef<PlayableSong[]>([])
    const shuffleRef = useRef(false)
    const repeatRef = useRef<RepeatMode>('off')
    // pre-computed shuffle order: indices into queueRef, in the order they'll be played
    const [shuffleOrder, setShuffleOrder] = useState<number[]>([])
    const shuffleOrderRef = useRef<number[]>([])
    const shufflePosRef = useRef(0)
    const [toast, setToast] = useState<string | null>(null)
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const dragFromRef = useRef<number | null>(null)
    const touchDragRef = useRef<{ fromIdx: number; startY: number; rowHeight: number } | null>(null)

    function showToast(msg: string) {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
        setToast(msg)
        toastTimerRef.current = setTimeout(() => setToast(null), 2500)
    }

    function generateShuffleOrder(currentIdx = queueIndexRef.current) {
        const q = queueRef.current
        const rest = q.map((_, i) => i).filter(i => i !== currentIdx)
        for (let i = rest.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rest[i], rest[j]] = [rest[j], rest[i]]
        }
        const order = currentIdx >= 0 ? [currentIdx, ...rest] : rest
        shuffleOrderRef.current = order
        shufflePosRef.current = 0
        setShuffleOrder([...order])
    }

    const savePosition = useCallback((song: PlayableSong, time: number) => {
        updatePosition(song.uuid, time)
    }, [])

    async function loadSong(song: PlayableSong, fromStart = false) {
        const audio = audioRef.current
        if (!audio) return
        const gen = ++loadGenRef.current
        pendingPosition.current = fromStart ? 0 : (song.last_position ?? 0)
        if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current)
            blobUrlRef.current = null
        }

        setCurrentTime(0)
        setDuration(0)
        setCurrent(song)
        setIsPlaying(true)

        if (autoplayActivatedRef.current) {
            // Page already activated — safe to await before touching audio element.
            // Use offline blob directly if available, no streaming→blob swap needed.
            const cachedFile = await getSongFile(song.uuid)
            if (gen !== loadGenRef.current) return
            if (cachedFile) {
                blobUrlRef.current = URL.createObjectURL(cachedFile)
                audio.src = blobUrlRef.current
            } else {
                audio.src = `${DOWNLOAD_URL}/${song.uuid}`
            }
            shouldPlayRef.current = true
            audio.load()
        } else {
            // First play — must call play() within the user-gesture window before any await.
            audio.src = `${DOWNLOAD_URL}/${song.uuid}`
            shouldPlayRef.current = true
            audio.load()
            audio.play().catch(() => {})
            // Swap to offline blob if available after gesture window
            const cachedFile = await getSongFile(song.uuid)
            if (gen !== loadGenRef.current) return
            if (cachedFile) {
                blobUrlRef.current = URL.createObjectURL(cachedFile)
                audio.src = blobUrlRef.current
                shouldPlayRef.current = true
                audio.load()
            }
        }
    }

    function play(song: PlayableSong, newQueue?: PlayableSong[], context?: PlayContext) {
        const q = newQueue ?? [song]
        const idx = Math.max(0, q.findIndex(s => s.uuid === song.uuid))
        queueRef.current = q
        queueIndexRef.current = idx
        manualNextRef.current = []
        setQueue(q)
        if (shuffleRef.current) generateShuffleOrder(idx)
        loadSong(song)
        if (context !== undefined) setPlayContext(context)
        scheduleSave()
    }

    function insertNext(song: PlayableSong) {
        const q = [...queueRef.current]
        const insertAt = queueIndexRef.current + 1 + manualNextRef.current.length
        q.splice(insertAt, 0, song)
        queueRef.current = q
        manualNextRef.current.push(song)
        setQueue([...q])
        scheduleSave()
        const afterName = queueRef.current[queueIndexRef.current]?.properties?.trackName
        showToast(afterName ? `Playing after ${afterName}` : 'Added to queue')
    }

    function removeFromQueue(index: number) {
        const q = [...queueRef.current]
        const currentIdx = queueIndexRef.current
        q.splice(index, 1)
        queueRef.current = q
        if (index <= currentIdx) queueIndexRef.current = Math.max(-1, currentIdx - 1)
        setQueue([...q])
        if (shuffleRef.current) generateShuffleOrder()
        scheduleSave()
    }

    function reorderQueue(fromIdx: number, toIdx: number) {
        if (fromIdx === toIdx) return
        const q = [...queueRef.current]
        const [item] = q.splice(fromIdx, 1)
        q.splice(toIdx, 0, item)
        const currentIdx = queueIndexRef.current
        let newIdx = currentIdx
        if (fromIdx === currentIdx) newIdx = toIdx
        else if (fromIdx < currentIdx && toIdx >= currentIdx) newIdx = currentIdx - 1
        else if (fromIdx > currentIdx && toIdx <= currentIdx) newIdx = currentIdx + 1
        queueRef.current = q
        queueIndexRef.current = newIdx
        setQueue([...q])
        if (shuffleRef.current) generateShuffleOrder()
        scheduleSave()
    }

    function pause() {
        const audio = audioRef.current
        if (!audio || !current) return
        audio.pause()
        savePosition(current, audio.currentTime)
        setIsPlaying(false)
    }

    function resume() {
        audioRef.current?.play().catch(() => {})
        setIsPlaying(true)
    }

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
                nextIdx = idx + 1
                if (nextIdx >= q.length) return
                // advance shuffle position to wherever this manually-queued song lands
                const pos = shuffleOrderRef.current.indexOf(nextIdx)
                if (pos >= 0) shufflePosRef.current = pos
            } else {
                const nextPos = shufflePosRef.current + 1
                if (nextPos >= shuffleOrderRef.current.length) {
                    if (repeatRef.current === 'all') { generateShuffleOrder(idx); nextIdx = shuffleOrderRef.current[1] ?? idx; shufflePosRef.current = 1 }
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
            const state = {
                shuffle: shuffleRef.current,
                repeat: repeatRef.current,
                queue: queueRef.current.map(s => s.uuid),
                queue_index: queueIndexRef.current,
            }
            try { localStorage.setItem('playerState', JSON.stringify(state)) } catch {}
            savePlayerState(state)
        }, 2000)
    }

    function toggleShuffle() {
        setShuffle(prev => {
            const next = !prev
            shuffleRef.current = next
            if (next) generateShuffleOrder()
            else { shuffleOrderRef.current = []; shufflePosRef.current = 0; setShuffleOrder([]) }
            scheduleSave()
            return next
        })
    }

    function playAt(index: number) {
        const q = queueRef.current
        if (index < 0 || index >= q.length) return
        queueIndexRef.current = index
        loadSong(q[index])
        scheduleSave()
    }

    function toggleRepeat() {
        setRepeat(prev => {
            const next: RepeatMode = prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'
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
            if (pendingPosition.current > 0) {
                audio!.currentTime = pendingPosition.current
                pendingPosition.current = 0
            }
            if (shouldPlayRef.current) {
                shouldPlayRef.current = false
                audio!.play().catch(() => {})
            }
        }
        function onPlay() { setIsPlaying(true); autoplayActivatedRef.current = true }
        function onPause() { setIsPlaying(false) }
        function onTimeUpdate() { setCurrentTime(audio!.currentTime) }
        function onDurationChange() { setDuration(audio!.duration) }
        audio.addEventListener('play', onPlay)
        audio.addEventListener('pause', onPause)
        audio.addEventListener('canplay', onCanPlay)
        audio.addEventListener('timeupdate', onTimeUpdate)
        audio.addEventListener('durationchange', onDurationChange)
        return () => {
            audio.removeEventListener('play', onPlay)
            audio.removeEventListener('pause', onPause)
            audio.removeEventListener('canplay', onCanPlay)
            audio.removeEventListener('timeupdate', onTimeUpdate)
            audio.removeEventListener('durationchange', onDurationChange)
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

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
        audio.addEventListener('ended', onEnded)
        return () => audio.removeEventListener('ended', onEnded)
    }, [current, savePosition, skipNext])

    useEffect(() => {
        if (!isPlaying || !current) return
        const posTimer = setInterval(() => {
            if (audioRef.current && current) savePosition(current, audioRef.current.currentTime)
        }, 10000)
        const playTimer = setTimeout(() => {
            if (current) recordPlay(current.uuid)
        }, 30000)
        return () => {
            clearInterval(posTimer)
            clearTimeout(playTimer)
        }
    }, [isPlaying, current, savePosition])

    useEffect(() => {
        if (!current?.properties || !('mediaSession' in navigator)) return
        const p = current.properties
        navigator.mediaSession.metadata = new MediaMetadata({
            title: p.trackName,
            artist: p.artistName,
            album: p.collectionName,
            artwork: p.artworkUrl100 ? [{ src: artworkUrl(p.artworkUrl100, 600), sizes: '600x600', type: 'image/jpeg' }] : [],
        })
        navigator.mediaSession.setActionHandler('play', () => {
            audioRef.current?.play().catch(() => {})
            setIsPlaying(true)
        })
        navigator.mediaSession.setActionHandler('pause', () => {
            const audio = audioRef.current
            if (!audio) return
            audio.pause()
            savePosition(current, audio.currentTime)
            setIsPlaying(false)
        })
        navigator.mediaSession.setActionHandler('previoustrack', skipPrev)
        navigator.mediaSession.setActionHandler('nexttrack', skipNext)
    }, [current, skipNext, skipPrev, savePosition])

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            const tag = (e.target as HTMLElement).tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
            const audio = audioRef.current
            if (!audio || !current) return
            if (e.code === 'Space') {
                e.preventDefault()
                if (audio.paused) { audio.play().catch(() => {}); setIsPlaying(true) }
                else { audio.pause(); savePosition(current, audio.currentTime); setIsPlaying(false) }
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
    }, [current, skipPrev, skipNext, savePosition])

    useEffect(() => {
        Promise.all([fetchPlayerState(), fetchLibrarySongs()]).then(async ([serverState, libSongs]) => {
            const libMap = new Map(libSongs.map(s => [s.uuid, s]))

            let localState: typeof serverState | undefined
            try {
                const raw = localStorage.getItem('playerState')
                if (raw) localState = JSON.parse(raw)
            } catch {}
            const state = serverState ?? localState

            if (state) {
                setShuffle(state.shuffle)
                shuffleRef.current = state.shuffle
                setRepeat(state.repeat)
                repeatRef.current = state.repeat
            }

            const queueUuids = state?.queue ?? []
            const restoredQueue: PlayableSong[] = queueUuids
                .map(id => libMap.get(id))
                .filter((s): s is NonNullable<typeof s> => !!s?.properties)
                .map(s => ({ uuid: s.uuid, properties: s.properties!, last_position: s.last_position, last_played_at: s.last_played_at }))

            if (restoredQueue.length > 0) {
                const safeIndex = Math.max(0, Math.min(state!.queue_index, restoredQueue.length - 1))
                const song = restoredQueue[safeIndex]
                queueRef.current = restoredQueue
                queueIndexRef.current = safeIndex
                setQueue(restoredQueue)
                if (state?.shuffle) generateShuffleOrder(safeIndex)
                setCurrent(song)
                const audio = audioRef.current
                if (audio) {
                    pendingPosition.current = song.last_position ?? 0
                    const cached = await getSongFile(song.uuid)
                    if (cached) {
                        blobUrlRef.current = URL.createObjectURL(cached)
                        audio.src = blobUrlRef.current
                    } else {
                        audio.src = `${DOWNLOAD_URL}/${song.uuid}`
                    }
                    audio.load()
                }
            } else {
                // fallback: restore last played song
                const last = libSongs
                    .filter(s => s.last_played_at && s.properties)
                    .sort((a, b) => new Date(b.last_played_at!).getTime() - new Date(a.last_played_at!).getTime())[0]
                if (last?.properties) {
                    const song = { uuid: last.uuid, properties: last.properties, last_position: last.last_position, last_played_at: last.last_played_at }
                    setCurrent(song)
                    queueRef.current = [song]
                    queueIndexRef.current = 0
                    setQueue([song])
                    const audio = audioRef.current
                    if (audio) {
                        pendingPosition.current = last.last_position ?? 0
                        const cached = await getSongFile(last.uuid)
                        if (cached) {
                            blobUrlRef.current = URL.createObjectURL(cached)
                            audio.src = blobUrlRef.current
                        } else {
                            audio.src = `${DOWNLOAD_URL}/${last.uuid}`
                        }
                        audio.load()
                    }
                }
            }
        })
    }, [])

    useEffect(() => {
        if (audioRef.current) audioRef.current.volume = volume
    }, [volume])

    const p = current?.properties
    const hasQueue = queue.length > 1
    const activeClass = 'text-sky-500'
    const idleClass = 'text-gray-400 hover:text-sky-500 transition-colors'

    const contextValue = useMemo(() => ({
        current, isPlaying, queue, shuffle, repeat, playContext,
        play, pause, resume, skipNext, skipPrev, toggleShuffle, toggleRepeat, insertNext, removeFromQueue, reorderQueue,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [current, isPlaying, queue, shuffle, repeat, playContext])

    return (
        <PlayerContext.Provider value={contextValue}>
            <audio ref={audioRef} />
            {children}
            {toast && (
                <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-full bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-medium shadow-lg pointer-events-none whitespace-nowrap">
                    {toast}
                </div>
            )}
            {current && p && (
                <>
                    {/* Queue panel — mobile: full-width strip above bar; desktop: floating right panel */}
                    {showQueue && queue.length > 0 && (
                        <div
                            data-testid="player-queue-panel"
                            className="fixed z-50 left-0 right-0 bottom-[88px] border-t border-gray-100 dark:border-gray-800 bg-white/95 dark:bg-gray-950/95 backdrop-blur-md max-h-56 overflow-y-auto
                                       md:left-auto md:right-4 md:bottom-20 md:w-80 md:max-h-[min(480px,70vh)] md:rounded-xl md:border md:border-gray-200 md:dark:border-gray-700 md:shadow-2xl"
                        >
                            {playContext && (
                                <div className="px-4 py-1.5 border-b border-gray-100 dark:border-gray-800">
                                    <Link href={playContext.href} className="text-xs text-gray-400 hover:text-sky-500 transition-colors">
                                        playing from {playContext.label}
                                    </Link>
                                </div>
                            )}
                            {(shuffle && shuffleOrder.length === queue.length
                                ? shuffleOrder.map(qi => ({ song: queue[qi], qi }))
                                : queue.map((song, qi) => ({ song, qi }))
                            ).map(({ song, qi }, displayIdx) => {
                                const isActive = song.uuid === current.uuid
                                const sp = song.properties
                                return (
                                    <div
                                        key={`${song.uuid}-${qi}`}
                                        data-qi={qi}
                                        draggable
                                        onDragStart={() => { dragFromRef.current = qi }}
                                        onDragOver={e => e.preventDefault()}
                                        onDrop={e => { e.preventDefault(); if (dragFromRef.current !== null) { reorderQueue(dragFromRef.current, qi); dragFromRef.current = null } }}
                                        onDragEnd={() => { dragFromRef.current = null }}
                                        className={`flex items-center gap-2 px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors ${isActive ? 'bg-gray-50 dark:bg-gray-900' : ''}`}
                                    >
                                        <span
                                            className="text-gray-300 dark:text-gray-600 cursor-grab active:cursor-grabbing shrink-0 touch-none"
                                            onTouchStart={e => {
                                                const row = (e.currentTarget as HTMLElement).closest('[data-qi]') as HTMLElement
                                                touchDragRef.current = { fromIdx: qi, startY: e.touches[0].clientY, rowHeight: row?.offsetHeight ?? 44 }
                                            }}
                                            onTouchMove={e => {
                                                if (!touchDragRef.current) return
                                                e.preventDefault()
                                                const dy = e.touches[0].clientY - touchDragRef.current.startY
                                                const delta = Math.round(dy / touchDragRef.current.rowHeight)
                                                const toIdx = Math.max(0, Math.min(queue.length - 1, touchDragRef.current.fromIdx + delta))
                                                if (toIdx !== touchDragRef.current.fromIdx) {
                                                    reorderQueue(touchDragRef.current.fromIdx, toIdx)
                                                    touchDragRef.current = { ...touchDragRef.current, fromIdx: toIdx, startY: e.touches[0].clientY }
                                                }
                                            }}
                                            onTouchEnd={() => { touchDragRef.current = null }}
                                        >
                                            <FaBars size={10} />
                                        </span>
                                        <button onClick={() => playAt(qi)} className="flex items-center gap-3 flex-1 text-left min-w-0">
                                            {sp?.artworkUrl100 && (
                                                <Image src={artworkUrl(sp.artworkUrl100, 200)} alt="" width={28} height={28} className="rounded shrink-0" />
                                            )}
                                            <div className="flex flex-col min-w-0 flex-1">
                                                <span className={`text-xs font-medium truncate ${isActive ? 'text-sky-500' : ''}`}>{sp?.trackName || 'Unknown title'}</span>
                                                <span className="text-xs text-gray-400 truncate">{sp?.artistName || 'Unknown artist'}</span>
                                            </div>
                                            {isActive && <FaPlay size={8} className="text-sky-500 shrink-0" />}
                                        </button>
                                        <button onClick={() => removeFromQueue(qi)} className="shrink-0 text-gray-300 dark:text-gray-600 hover:text-red-400 transition-colors">
                                            <FaTimes size={10} />
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    <div data-testid="player-bar" className="fixed bottom-0 left-0 right-0 z-50 bg-white/90 dark:bg-gray-950/90 backdrop-blur-md border-t border-gray-100 dark:border-gray-800">
                        <div className="flex flex-col">
                            {/* Mobile: single row. Desktop: three-column layout */}
                            <div className="flex items-center gap-3 px-4 pt-3 pb-1.5 md:grid md:grid-cols-[1fr_auto_1fr]">
                                {/* Left: artwork + track info */}
                                <div className="flex items-center gap-3 min-w-0 flex-1 md:flex-initial">
                                    {p.artworkUrl100 && (
                                        <Image src={artworkUrl(p.artworkUrl100, 200)} alt="" width={36} height={36} className="rounded shrink-0" />
                                    )}
                                    {playContext ? (
                                        <Link href={playContext.href} className="flex flex-col min-w-0 flex-1 group">
                                            <span data-testid="player-track-name" className="text-xs font-medium truncate group-hover:text-sky-500 transition-colors">{p.trackName || 'Unknown title'}</span>
                                            <span className="text-xs text-sky-500 truncate">{p.artistName || 'Unknown artist'}</span>
                                            <span className="text-xs text-gray-400 truncate hidden md:block">from {playContext.label}</span>
                                        </Link>
                                    ) : (
                                        <div className="flex flex-col min-w-0 flex-1">
                                            <span data-testid="player-track-name" className="text-xs font-medium truncate">{p.trackName || 'Unknown title'}</span>
                                            <span className="text-xs text-sky-500 truncate">{p.artistName || 'Unknown artist'}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Center: transport (desktop only — on mobile lives in right section) */}
                                <div className="hidden md:flex items-center gap-4">
                                    <button data-testid="player-shuffle" onClick={toggleShuffle} className={`shrink-0 ${shuffle ? activeClass : idleClass}`}>
                                        <FaRandom size={13} />
                                    </button>
                                    <button data-testid="player-prev" onClick={skipPrev} disabled={!hasQueue} className={`shrink-0 disabled:opacity-30 ${idleClass}`}>
                                        <FaStepBackward size={13} />
                                    </button>
                                    <button data-testid="player-play-pause" onClick={isPlaying ? pause : resume} className={`shrink-0 ${idleClass}`}>
                                        {isPlaying ? <FaPause size={18} /> : <FaPlay size={18} />}
                                    </button>
                                    <button data-testid="player-next" onClick={skipNext} disabled={!hasQueue} className={`shrink-0 disabled:opacity-30 ${idleClass}`}>
                                        <FaStepForward size={13} />
                                    </button>
                                    <button data-testid="player-repeat" onClick={toggleRepeat} className={`shrink-0 relative ${repeat !== 'off' ? activeClass : idleClass}`}>
                                        <FaRedo size={13} />
                                        {repeat === 'one' && (
                                            <span className="absolute -top-1.5 -right-1.5 text-[8px] font-bold leading-none">1</span>
                                        )}
                                    </button>
                                </div>

                                {/* Right: mobile has all controls; desktop has volume + queue toggle */}
                                <div className="flex items-center gap-3 shrink-0 md:justify-end">
                                    {/* Mobile-only transport */}
                                    <div className="flex md:hidden items-center gap-3">
                                        <button data-testid="player-shuffle" onClick={toggleShuffle} className={`shrink-0 ${shuffle ? activeClass : idleClass}`}>
                                            <FaRandom size={12} />
                                        </button>
                                        <button data-testid="player-prev" onClick={skipPrev} disabled={!hasQueue} className={`shrink-0 disabled:opacity-30 ${idleClass}`}>
                                            <FaStepBackward size={12} />
                                        </button>
                                        <button onClick={isPlaying ? pause : resume} className={`shrink-0 ${idleClass}`}>
                                            {isPlaying ? <FaPause size={14} /> : <FaPlay size={14} />}
                                        </button>
                                        <button data-testid="player-next" onClick={skipNext} disabled={!hasQueue} className={`shrink-0 disabled:opacity-30 ${idleClass}`}>
                                            <FaStepForward size={12} />
                                        </button>
                                        <button data-testid="player-repeat" onClick={toggleRepeat} className={`shrink-0 relative ${repeat !== 'off' ? activeClass : idleClass}`}>
                                            <FaRedo size={12} />
                                            {repeat === 'one' && (
                                                <span className="absolute -top-1.5 -right-1.5 text-[8px] font-bold leading-none">1</span>
                                            )}
                                        </button>
                                    </div>
                                    {/* Queue toggle + volume (both breakpoints) */}
                                    <button data-testid="player-queue-toggle" onClick={() => setShowQueue(v => !v)} className={`shrink-0 ${showQueue ? activeClass : idleClass}`}>
                                        <FaList size={12} />
                                    </button>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <button onClick={() => setVolume(v => v > 0 ? 0 : 1)} className={idleClass}>
                                            {volume === 0 ? <FaVolumeMute size={12} /> : <FaVolumeUp size={12} />}
                                        </button>
                                        <div className="hidden sm:block w-16">
                                            <Slider value={volume} min={0} max={1} step={0.02} onChange={setVolume} label="volume" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div data-testid="player-progress" className="flex px-4 pb-3">
                                <ProgressBar current={currentTime} duration={duration} onSeek={handleSeek} />
                            </div>
                        </div>
                    </div>
                </>
            )}
        </PlayerContext.Provider>
    )
}
