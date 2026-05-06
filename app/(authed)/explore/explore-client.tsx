'use client'
import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import SearchInput from "../../components/search-input"
import { ExploreData, ExploreWindow, SongWithCount, RecentlyPlayedSong, RecentlySavedSong, fetchLibrary, toSongCard, toPlayableSong } from "../../lib/data"
import { queryKeys } from "../../lib/query-keys"
import { routes } from "../../lib/routes"
import { usePlayer } from "../../components/player"
import Song from "../../components/song"
import { timeAgo } from "../../lib/time"

const WINDOWS: { value: ExploreWindow; label: string }[] = [
    { value: 'day', label: 'today' },
    { value: 'week', label: 'week' },
    { value: 'all', label: 'all time' },
]

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

type ViewFilter = 'everyone' | 'you'
const VIEWS: { value: ViewFilter; label: string }[] = [
    { value: 'everyone', label: 'everyone' },
    { value: 'you', label: 'you' },
]

type SortBy = 'plays' | 'downloads' | 'saves' | 'recent' | 'recently_played'
const SORTS: { value: SortBy; label: string }[] = [
    { value: 'plays', label: 'most played' },
    { value: 'downloads', label: 'most downloaded' },
    { value: 'saves', label: 'most saved' },
    { value: 'recent', label: 'recently added' },
    { value: 'recently_played', label: 'recently played' },
]

type AnyItem = SongWithCount | RecentlyPlayedSong | RecentlySavedSong | ExploreData['recently_added'][0]

function matchesSearch(item: AnyItem, query: string): boolean {
    if (!query) return true
    const q = query.toLowerCase()
    const p = item.properties
    if (!p) return false
    return p.trackName.toLowerCase().includes(q) || p.artistName.toLowerCase().includes(q)
}

function itemStat(item: AnyItem, sortBy: SortBy): string | null {
    if ('count' in item && typeof item.count === 'number') {
        if (sortBy === 'saves') return `saved ${item.count}×`
        if (sortBy === 'downloads') return `downloaded ${item.count}×`
        return `played ${item.count}×`
    }
    if ('added_at' in item && typeof (item as { added_at: string }).added_at === 'string') {
        return `added ${timeAgo((item as { added_at: string }).added_at)}`
    }
    if ('last_played_at' in item && typeof (item as RecentlyPlayedSong).last_played_at === 'string') {
        return `played ${timeAgo((item as RecentlyPlayedSong).last_played_at)}`
    }
    return null
}

function exploreHref(window: ExploreWindow, sortBy: SortBy, viewFilter: ViewFilter, songUuid?: string): string {
    const params = new URLSearchParams({ window, sort: sortBy, view: viewFilter })
    if (songUuid) params.set('song', songUuid)
    return `${routes.explore}?${params.toString()}`
}

function SongGrid({ songs, libraryIds, sortBy, viewFilter, window, showSource }: {
    songs: AnyItem[]
    libraryIds: Set<string>
    sortBy: SortBy
    viewFilter: ViewFilter
    window: ExploreWindow
    showSource?: boolean
}) {
    const { play, current } = usePlayer()
    const isDesktop = useIsDesktop()
    if (songs.length === 0) return <p className="text-gray-400 text-sm py-4">no data yet</p>
    const baseCtx = { label: 'Explore', href: exploreHref(window, sortBy, viewFilter), id: 'explore' }
    const queue = songs.filter(s => s.properties).map(s => ({
        ...toPlayableSong(s, baseCtx),
        source: { ...baseCtx, href: exploreHref(window, sortBy, viewFilter, s.uuid) },
    }))
    return (
        <div className={isDesktop
            ? "grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2 md:gap-6"
            : "flex flex-col"
        }>
            {songs.map(s => {
                if (!s.properties) return null
                const song = toSongCard(s)
                const stat = itemStat(s, sortBy)
                const songCtx = { ...baseCtx, href: exploreHref(window, sortBy, viewFilter, s.uuid) }
                return (
                    <div key={s.uuid} data-song-id={s.uuid} className="flex flex-col gap-1">
                        <Song
                            song={song}
                            selected={current?.uuid === s.uuid}
                            onClick={() => play({ ...toPlayableSong(s, baseCtx), source: songCtx }, queue, baseCtx)}
                            inLibrary={libraryIds.has(s.uuid)}
                            showSource={showSource}
                            compact={!isDesktop}
                        />
                        {stat && <span className="text-xs text-gray-400 px-1">{stat}</span>}
                    </div>
                )
            })}
        </div>
    )
}

export default function ExploreClient({ data, window: timeWindow }: { data: ExploreData | undefined; window: ExploreWindow }) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const initialSort = (searchParams.get('sort') as SortBy | null) ?? 'plays'
    const initialView = (searchParams.get('view') as ViewFilter | null) ?? 'everyone'
    const [sortBy, setSortBy] = useState<SortBy>(initialSort)
    const [viewFilter, setViewFilter] = useState<ViewFilter>(initialView)
    const [search, setSearch] = useState(searchParams.get('q') ?? '')

    const { data: libraryEntries = [] } = useQuery({
        queryKey: queryKeys.library,
        queryFn: fetchLibrary,
    })
    const libraryIds = useMemo(() => new Set(libraryEntries.map(e => e.song_id)), [libraryEntries])

    function changeViewFilter(v: ViewFilter) {
        setViewFilter(v)
        const params = new URLSearchParams(searchParams.toString())
        params.set('view', v)
        router.replace(`${routes.explore}?${params.toString()}`)
    }

    // scroll to and highlight a specific song when ?song=<uuid> appears in URL
    useEffect(() => {
        const songId = searchParams.get('song')
        if (!songId) return
        let cleanupScrollend: (() => void) | null = null
        const id = setTimeout(() => {
            const el = document.querySelector<HTMLElement>(`[data-song-id="${songId}"]`)
            if (!el) return
            const flash = () => {
                el.style.animation = 'none'
                void el.offsetWidth
                el.style.animation = 'song-highlight 1.5s ease-out forwards'
                el.addEventListener('animationend', () => { el.style.animation = '' }, { once: true })
            }
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            if ('onscrollend' in window) {
                const onScrollEnd = () => { flash(); window.removeEventListener('scrollend', onScrollEnd) }
                window.addEventListener('scrollend', onScrollEnd, { once: true })
                cleanupScrollend = () => window.removeEventListener('scrollend', onScrollEnd)
            } else {
                flash()
            }
        }, 300)
        return () => { clearTimeout(id); cleanupScrollend?.() }
    }, [searchParams, viewFilter, sortBy, timeWindow])

    function setWindow(w: ExploreWindow) {
        router.push(`${routes.explore}?window=${w}&sort=${sortBy}&view=${viewFilter}`)
    }

    function changeSortBy(s: SortBy) {
        setSortBy(s)
        const params = new URLSearchParams(searchParams.toString())
        params.set('sort', s)
        router.replace(`${routes.explore}?${params.toString()}`)
    }

    function changeSearch(q: string) {
        setSearch(q)
        const params = new URLSearchParams(searchParams.toString())
        if (q) {
            params.set('q', q)
        } else {
            params.delete('q')
        }
        router.replace(`${routes.explore}?${params.toString()}`)
    }

    const rawList: AnyItem[] = data
        ? viewFilter === 'you'
            ? sortBy === 'plays' ? data.your_most_played
            : sortBy === 'downloads' ? data.your_most_downloaded
            : sortBy === 'recently_played' ? data.your_recently_played
            : data.your_recently_saved
        : sortBy === 'plays' ? data.most_played
        : sortBy === 'downloads' ? data.most_downloaded
        : sortBy === 'saves' ? data.most_libraryed
        : sortBy === 'recently_played' ? data.your_recently_played
        : data.recently_added
        : []

    const mainList = rawList.filter(s => matchesSearch(s, search))

    const windowLabel = WINDOWS.find(w => w.value === timeWindow)?.label
    const sortLabel = SORTS.find(s => s.value === sortBy)?.label

    return (
        <div className="flex flex-col gap-6">
            <div className="sticky top-11 z-40 bg-[var(--background)]/90 backdrop-blur-md py-3 flex flex-col md:flex-row gap-2 border-b border-gray-100 dark:border-gray-800 -mt-px">
                <div className="flex gap-2 items-center">
                    <SearchInput
                        value={search}
                        onChange={changeSearch}
                        placeholder="search…"
                        className="flex-1 md:max-w-xs"
                    />
                    <select
                        value={sortBy}
                        onChange={e => changeSortBy(e.target.value as SortBy)}
                        className="px-3 py-1 rounded-full text-sm bg-transparent text-gray-400 hover:text-sky-500 cursor-pointer focus:outline-none"
                    >
                        {SORTS.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                    </select>
                </div>
                <div className="flex flex-1 flex-wrap gap-2 items-center">
                    {VIEWS.map(v => (
                        <button
                            key={v.value}
                            onClick={() => changeViewFilter(v.value)}
                            className={`px-3 py-1 rounded-full text-sm transition-colors ${
                                viewFilter === v.value
                                    ? 'bg-sky-500 text-white'
                                    : 'text-gray-400 hover:text-sky-500'
                            }`}
                        >
                            {v.label}
                        </button>
                    ))}
                    <div className="self-stretch w-px bg-gray-200 dark:bg-gray-700 mx-1" />
                    {WINDOWS.map(w => (
                        <button
                            key={w.value}
                            onClick={() => setWindow(w.value)}
                            className={`px-3 py-1 rounded-full text-sm transition-colors ${
                                timeWindow === w.value
                                    ? 'bg-sky-500 text-white'
                                    : 'text-gray-400 hover:text-sky-500'
                            }`}
                        >
                            {w.label}
                        </button>
                    ))}
                </div>
            </div>

            {!data ? (
                <p className="text-gray-400 text-sm">failed to load</p>
            ) : mainList.length === 0 && search ? (
                <p className="text-gray-400 text-sm">no results for &lsquo;{search}&rsquo;</p>
            ) : (
                <div>
                    <h2 className="text-sm font-medium text-gray-400 mb-4">
                        {viewFilter === 'you' ? `your ${sortLabel}` : sortLabel}
                        <span className="ml-1 text-gray-300 dark:text-gray-600">· {windowLabel}</span>
                    </h2>
                    <SongGrid songs={mainList} libraryIds={libraryIds} sortBy={sortBy} viewFilter={viewFilter} window={timeWindow} showSource={viewFilter === 'everyone'} />
                </div>
            )}
        </div>
    )
}
