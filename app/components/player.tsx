'use client'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { FaPause, FaPlay, FaStepBackward, FaStepForward, FaRandom, FaRedo, FaList, FaTimes } from "react-icons/fa"
import { BASE_URL, PlayableSong, artworkUrl, fetchLibrarySongs, fetchPlayerState, recordPlay, savePlayerState, updatePosition } from "../lib/data"

export type RepeatMode = 'off' | 'one' | 'all'
export type PlayContext = { label: string; href: string }

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
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-sky-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
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
    const pendingPosition = useRef<number>(0)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // refs mirror state so stable callbacks always see latest values
    const queueRef = useRef<PlayableSong[]>([])
    const queueIndexRef = useRef(-1)
    const shuffleRef = useRef(false)
    const repeatRef = useRef<RepeatMode>('off')

    const savePosition = useCallback((song: PlayableSong, time: number) => {
        updatePosition(song.uuid, time)
    }, [])

    function loadSong(song: PlayableSong, fromStart = false) {
        const audio = audioRef.current
        if (!audio) return
        pendingPosition.current = fromStart ? 0 : (song.last_position ?? 0)
        audio.src = `${BASE_URL}/download/${song.uuid}`
        audio.load()
        setCurrent(song)
        setIsPlaying(true)
    }

    function play(song: PlayableSong, newQueue?: PlayableSong[], context?: PlayContext) {
        const q = newQueue ?? [song]
        const idx = Math.max(0, q.findIndex(s => s.uuid === song.uuid))
        queueRef.current = q
        queueIndexRef.current = idx
        setQueue(q)
        loadSong(song)
        if (context !== undefined) setPlayContext(context)
        scheduleSave()
    }

    function insertNext(song: PlayableSong) {
        const q = [...queueRef.current]
        q.splice(queueIndexRef.current + 1, 0, song)
        queueRef.current = q
        setQueue([...q])
        scheduleSave()
    }

    function removeFromQueue(index: number) {
        const q = [...queueRef.current]
        const currentIdx = queueIndexRef.current
        q.splice(index, 1)
        queueRef.current = q
        if (index <= currentIdx) queueIndexRef.current = Math.max(-1, currentIdx - 1)
        setQueue([...q])
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
        audioRef.current?.play()
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
            const others = q.map((_, i) => i).filter(i => i !== idx)
            if (others.length === 0) return
            nextIdx = others[Math.floor(Math.random() * others.length)]
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
        if (idx <= 0) return
        const prevIdx = idx - 1
        queueIndexRef.current = prevIdx
        loadSong(queueRef.current[prevIdx], true)
        scheduleSave()
    }, [])

    function scheduleSave() {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
            savePlayerState({
                shuffle: shuffleRef.current,
                repeat: repeatRef.current,
                queue: queueRef.current.map(s => s.uuid),
                queue_index: queueIndexRef.current,
            })
        }, 2000)
    }

    function toggleShuffle() {
        setShuffle(prev => {
            const next = !prev
            shuffleRef.current = next
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

    useEffect(() => {
        const audio = audioRef.current
        if (!audio) return

        function onCanPlay() {
            if (pendingPosition.current > 0) {
                audio!.currentTime = pendingPosition.current
                pendingPosition.current = 0
            }
            audio!.play().catch(() => {})
        }
        function onPlay() { setIsPlaying(true) }
        function onPause() { setIsPlaying(false) }
        function onTimeUpdate() { setCurrentTime(audio!.currentTime) }
        function onDurationChange() { setDuration(audio!.duration) }
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

        audio.addEventListener('play', onPlay)
        audio.addEventListener('pause', onPause)
        audio.addEventListener('canplay', onCanPlay)
        audio.addEventListener('timeupdate', onTimeUpdate)
        audio.addEventListener('durationchange', onDurationChange)
        audio.addEventListener('ended', onEnded)
        return () => {
            audio.removeEventListener('play', onPlay)
            audio.removeEventListener('pause', onPause)
            audio.removeEventListener('canplay', onCanPlay)
            audio.removeEventListener('timeupdate', onTimeUpdate)
            audio.removeEventListener('durationchange', onDurationChange)
            audio.removeEventListener('ended', onEnded)
        }
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
        Promise.all([fetchPlayerState(), fetchLibrarySongs()]).then(([state, libSongs]) => {
            const libMap = new Map(libSongs.map(s => [s.uuid, s]))

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
                queueRef.current = restoredQueue
                queueIndexRef.current = safeIndex
                setQueue(restoredQueue)
                setCurrent(restoredQueue[safeIndex])
                const audio = audioRef.current
                if (audio) {
                    pendingPosition.current = restoredQueue[safeIndex].last_position ?? 0
                    audio.src = `${BASE_URL}/download/${restoredQueue[safeIndex].uuid}`
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
                        audio.src = `${BASE_URL}/download/${last.uuid}`
                    }
                }
            }
        })
    }, [])

    const p = current?.properties
    const hasQueue = queue.length > 1
    const activeClass = 'text-sky-500'
    const idleClass = 'text-gray-400 hover:text-sky-500 transition-colors'

    return (
        <PlayerContext.Provider value={{ current, isPlaying, queue, shuffle, repeat, playContext, play, pause, resume, skipNext, skipPrev, toggleShuffle, toggleRepeat, insertNext, removeFromQueue }}>
            <audio ref={audioRef} />
            {children}
            {current && p && (
                <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/90 dark:bg-gray-950/90 backdrop-blur-md border-t border-gray-100 dark:border-gray-800">
                    {showQueue && queue.length > 0 && (
                        <div className="border-b border-gray-100 dark:border-gray-800 max-h-56 overflow-y-auto">
                            {playContext && (
                                <div className="px-4 py-1.5 border-b border-gray-100 dark:border-gray-800">
                                    <Link href={playContext.href} className="text-xs text-gray-400 hover:text-sky-500 transition-colors">
                                        playing from {playContext.label}
                                    </Link>
                                </div>
                            )}
                            {queue.map((song, i) => {
                                const isActive = song.uuid === current.uuid
                                const sp = song.properties
                                return (
                                    <div
                                        key={`${song.uuid}-${i}`}
                                        className={`flex items-center gap-3 px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors ${isActive ? 'bg-gray-50 dark:bg-gray-900' : ''}`}
                                    >
                                        <button onClick={() => playAt(i)} className="flex items-center gap-3 flex-1 text-left min-w-0">
                                            {sp?.artworkUrl100 && (
                                                <Image src={artworkUrl(sp.artworkUrl100, 200)} alt="" width={28} height={28} className="rounded shrink-0" />
                                            )}
                                            <div className="flex flex-col min-w-0 flex-1">
                                                <span className={`text-xs font-medium truncate ${isActive ? 'text-sky-500' : ''}`}>{sp?.trackName}</span>
                                                <span className="text-xs text-gray-400 truncate">{sp?.artistName}</span>
                                            </div>
                                            {isActive && <FaPlay size={8} className="text-sky-500 shrink-0" />}
                                        </button>
                                        <button onClick={() => removeFromQueue(i)} className="shrink-0 text-gray-300 dark:text-gray-600 hover:text-red-400 transition-colors">
                                            <FaTimes size={10} />
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    <div className="flex flex-col">
                        <div className="flex items-center gap-3 px-4 pt-3 pb-1.5">
                            {p.artworkUrl100 && (
                                <Image src={artworkUrl(p.artworkUrl100, 200)} alt="" width={36} height={36} className="rounded shrink-0" />
                            )}
                            {playContext ? (
                                <Link href={playContext.href} className="flex flex-col min-w-0 flex-1 group">
                                    <span className="text-xs font-medium truncate group-hover:text-sky-500 transition-colors">{p.trackName}</span>
                                    <span className="text-xs text-sky-500 truncate">{p.artistName}</span>
                                    <span className="text-xs text-gray-400 truncate">from {playContext.label}</span>
                                </Link>
                            ) : (
                                <div className="flex flex-col min-w-0 flex-1">
                                    <span className="text-xs font-medium truncate">{p.trackName}</span>
                                    <span className="text-xs text-sky-500 truncate">{p.artistName}</span>
                                </div>
                            )}
                            <div className="flex items-center gap-3 shrink-0">
                                <button onClick={toggleShuffle} className={`shrink-0 ${shuffle ? activeClass : idleClass}`}>
                                    <FaRandom size={12} />
                                </button>
                                <button onClick={skipPrev} disabled={!hasQueue} className={`shrink-0 disabled:opacity-30 ${idleClass}`}>
                                    <FaStepBackward size={12} />
                                </button>
                                <button onClick={isPlaying ? pause : resume} className={`shrink-0 ${idleClass}`}>
                                    {isPlaying ? <FaPause size={14} /> : <FaPlay size={14} />}
                                </button>
                                <button onClick={skipNext} disabled={!hasQueue} className={`shrink-0 disabled:opacity-30 ${idleClass}`}>
                                    <FaStepForward size={12} />
                                </button>
                                <button onClick={toggleRepeat} className={`shrink-0 relative ${repeat !== 'off' ? activeClass : idleClass}`}>
                                    <FaRedo size={12} />
                                    {repeat === 'one' && (
                                        <span className="absolute -top-1.5 -right-1.5 text-[8px] font-bold leading-none">1</span>
                                    )}
                                </button>
                                <button onClick={() => setShowQueue(v => !v)} className={`shrink-0 ${showQueue ? activeClass : idleClass}`}>
                                    <FaList size={12} />
                                </button>
                            </div>
                        </div>
                        <div className="flex px-4 pb-3">
                            <ProgressBar current={currentTime} duration={duration} onSeek={handleSeek} />
                        </div>
                    </div>
                </div>
            )}
        </PlayerContext.Provider>
    )
}
