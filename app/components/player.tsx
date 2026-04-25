'use client'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import Image from "next/image"
import { FaPause, FaPlay, FaStepBackward, FaStepForward, FaRandom, FaRedo } from "react-icons/fa"
import { BASE_URL, PlayableSong, fetchLibrarySongs, recordPlay, updatePosition } from "../lib/data"

export type RepeatMode = 'off' | 'one' | 'all'

interface PlayerContextValue {
    current: PlayableSong | null
    isPlaying: boolean
    queue: PlayableSong[]
    shuffle: boolean
    repeat: RepeatMode
    play: (song: PlayableSong, queue?: PlayableSong[]) => void
    pause: () => void
    resume: () => void
    skipNext: () => void
    skipPrev: () => void
    toggleShuffle: () => void
    toggleRepeat: () => void
}

const PlayerContext = createContext<PlayerContextValue>({
    current: null,
    isPlaying: false,
    queue: [],
    shuffle: false,
    repeat: 'off',
    play: () => {},
    pause: () => {},
    resume: () => {},
    skipNext: () => {},
    skipPrev: () => {},
    toggleShuffle: () => {},
    toggleRepeat: () => {},
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

    function posFromEvent(e: MouseEvent | React.MouseEvent) {
        const rect = barRef.current!.getBoundingClientRect()
        return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * (duration || 0)
    }

    function onMouseDown(e: React.MouseEvent) {
        dragging.current = true
        onSeek(posFromEvent(e))
        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mouseup', onMouseUp)
    }

    function onMouseMove(e: MouseEvent) {
        if (dragging.current) onSeek(posFromEvent(e))
    }

    function onMouseUp(e: MouseEvent) {
        if (dragging.current) {
            onSeek(posFromEvent(e))
            dragging.current = false
        }
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
    }

    const pct = duration ? (current / duration) * 100 : 0

    return (
        <div className="flex items-center gap-3 flex-1">
            <span className="text-xs text-gray-400 tabular-nums w-8 text-right shrink-0">{fmt(current)}</span>
            <div
                ref={barRef}
                onMouseDown={onMouseDown}
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

    const pendingPosition = useRef<number>(0)
    // refs mirror state so stable callbacks always see latest values
    const queueRef = useRef<PlayableSong[]>([])
    const queueIndexRef = useRef(-1)
    const shuffleRef = useRef(false)
    const repeatRef = useRef<RepeatMode>('off')

    const savePosition = useCallback((song: PlayableSong, time: number) => {
        updatePosition(song.uuid, time)
    }, [])

    function loadSong(song: PlayableSong) {
        const audio = audioRef.current
        if (!audio) return
        pendingPosition.current = song.last_position ?? 0
        audio.src = `${BASE_URL}/download/${song.uuid}`
        audio.load()
        setCurrent(song)
        setIsPlaying(true)
    }

    function play(song: PlayableSong, newQueue?: PlayableSong[]) {
        const q = newQueue ?? [song]
        const idx = Math.max(0, q.findIndex(s => s.uuid === song.uuid))
        queueRef.current = q
        queueIndexRef.current = idx
        setQueue(q)
        loadSong(song)
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
        loadSong(q[nextIdx])
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
        loadSong(queueRef.current[prevIdx])
    }, [])

    function toggleShuffle() {
        setShuffle(prev => { shuffleRef.current = !prev; return !prev })
    }

    function toggleRepeat() {
        setRepeat(prev => {
            const next: RepeatMode = prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'
            repeatRef.current = next
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

        audio.addEventListener('canplay', onCanPlay)
        audio.addEventListener('timeupdate', onTimeUpdate)
        audio.addEventListener('durationchange', onDurationChange)
        audio.addEventListener('ended', onEnded)
        return () => {
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
        fetchLibrarySongs().then(songs => {
            const last = songs
                .filter(s => s.last_played_at && s.properties)
                .sort((a, b) => new Date(b.last_played_at!).getTime() - new Date(a.last_played_at!).getTime())[0]
            if (last?.properties) {
                const song = { uuid: last.uuid, properties: last.properties, last_position: last.last_position, last_played_at: last.last_played_at }
                setCurrent(song)
                queueRef.current = [song]
                queueIndexRef.current = 0
                setQueue([song])
            }
        })
    }, [])

    const p = current?.properties
    const hasQueue = queue.length > 1
    const activeClass = 'text-sky-500'
    const idleClass = 'text-gray-400 hover:text-sky-500 transition-colors'

    return (
        <PlayerContext.Provider value={{ current, isPlaying, queue, shuffle, repeat, play, pause, resume, skipNext, skipPrev, toggleShuffle, toggleRepeat }}>
            <audio ref={audioRef} />
            {children}
            {current && p && (
                <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/90 dark:bg-gray-950/90 backdrop-blur-md border-t border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-3 px-4 py-3">
                        {p.artworkUrl100 && (
                            <Image src={p.artworkUrl100} alt="" width={36} height={36} className="rounded shrink-0" />
                        )}
                        <div className="flex flex-col min-w-0 w-28 shrink-0">
                            <span className="text-xs font-medium truncate">{p.trackName}</span>
                            <span className="text-xs text-sky-500 truncate">{p.artistName}</span>
                        </div>
                        <button onClick={skipPrev} disabled={!hasQueue} className={`shrink-0 hidden sm:block disabled:opacity-30 ${idleClass}`}>
                            <FaStepBackward size={12} />
                        </button>
                        <ProgressBar current={currentTime} duration={duration} onSeek={handleSeek} />
                        <button onClick={skipNext} disabled={!hasQueue} className={`shrink-0 hidden sm:block disabled:opacity-30 ${idleClass}`}>
                            <FaStepForward size={12} />
                        </button>
                        <button onClick={isPlaying ? pause : resume} className={`shrink-0 ${idleClass}`}>
                            {isPlaying ? <FaPause size={14} /> : <FaPlay size={14} />}
                        </button>
                        <button onClick={toggleShuffle} className={`shrink-0 hidden sm:block ${shuffle ? activeClass : idleClass}`}>
                            <FaRandom size={12} />
                        </button>
                        <button
                            onClick={toggleRepeat}
                            className={`shrink-0 hidden sm:block relative ${repeat !== 'off' ? activeClass : idleClass}`}
                        >
                            <FaRedo size={12} />
                            {repeat === 'one' && (
                                <span className="absolute -top-1.5 -right-1.5 text-[8px] font-bold leading-none">1</span>
                            )}
                        </button>
                    </div>
                </div>
            )}
        </PlayerContext.Provider>
    )
}
