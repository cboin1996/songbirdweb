'use client'
import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import SearchInput from "../components/search-input"
import { ExploreData, ExploreWindow, SongWithCount, RecentlyPlayedSong, RecentlySavedSong, fetchLibrary, toSongCard, toPlayableSong } from "../lib/data"
import { routes } from "../lib/routes"
import { usePlayer } from "../components/player"
import Song from "../components/song"
import { useScrollRestoration } from "../lib/use-scroll-restoration"

const WINDOWS: { value: ExploreWindow; label: string }[] = [
    { value: 'day', label: 'today' },
    { value: 'week', label: 'this week' },
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
        return `added ${new Date((item as { added_at: string }).added_at).toLocaleDateString('en-US')}`
    }
    if ('last_played_at' in item && typeof (item as RecentlyPlayedSong).last_played_at === 'string') {
        return `played ${new Date((item as RecentlyPlayedSong).last_played_at).toLocaleDateString('en-US')}`
    }
    return null
}

function SongGrid({ songs, libraryIds, sortBy, showSource }: {
    songs: AnyItem[]
    libraryIds: Set<string>
    sortBy: SortBy
    showSource?: boolean
}) {
    const { play, current } = usePlayer()
    const isDesktop = useIsDesktop()
    if (songs.length === 0) return <p className="text-gray-400 text-sm py-4">no data yet</p>
    const exploreCtx = { label: 'Explore', href: routes.explore, id: 'explore' }
    const queue = songs.filter(s => s.properties).map(s => toPlayableSong(s, exploreCtx))
    return (
        <div className={isDesktop
            ? "grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2 md:gap-6"
            : "flex flex-col"
        }>
            {songs.map(s => {
                if (!s.properties) return null
                const song = toSongCard(s)
                const stat = itemStat(s, sortBy)
                return (
                    <div key={s.uuid} className="flex flex-col gap-1">
                        <Song
                            song={song}
                            selected={current?.uuid === s.uuid}
                            onClick={() => play(toPlayableSong(s, exploreCtx), queue, exploreCtx)}
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

export default function ExploreClient({ data, window }: { data: ExploreData | undefined; window: ExploreWindow }) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const initialSort = (searchParams.get('sort') as SortBy | null) ?? 'plays'
    const [sortBy, setSortBy] = useState<SortBy>(initialSort)
    const [viewFilter, setViewFilter] = useState<ViewFilter>('everyone')
    const [libraryIds, setLibraryIds] = useState<Set<string>>(new Set())
    const [search, setSearch] = useState(searchParams.get('q') ?? '')
    useScrollRestoration()

    useEffect(() => {
        fetchLibrary().then(entries => setLibraryIds(new Set(entries.map(e => e.song_id))))
    }, [])

    function setWindow(w: ExploreWindow) {
        router.push(`${routes.explore}?window=${w}&sort=${sortBy}`)
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

    const windowLabel = WINDOWS.find(w => w.value === window)?.label
    const sortLabel = SORTS.find(s => s.value === sortBy)?.label

    return (
        <div className="flex flex-col gap-6">
            <div className="sticky top-11 z-40 bg-white/90 dark:bg-gray-950/90 backdrop-blur-md py-3 flex flex-col gap-3 border-b border-gray-100 dark:border-gray-800">
                <SearchInput
                    value={search}
                    onChange={changeSearch}
                    placeholder="search by track or artist…"
                    className="w-full md:w-80"
                />
                <div className="flex flex-wrap gap-2">
                    {VIEWS.map(v => (
                        <button
                            key={v.value}
                            onClick={() => setViewFilter(v.value)}
                            className={`px-3 py-1 rounded-full text-sm transition-colors ${
                                viewFilter === v.value
                                    ? 'bg-sky-500 text-white'
                                    : 'text-gray-400 hover:text-sky-500'
                            }`}
                        >
                            {v.label}
                        </button>
                    ))}
                    <span className="text-gray-200 dark:text-gray-700 self-center px-1">·</span>
                    {WINDOWS.map(w => (
                        <button
                            key={w.value}
                            onClick={() => setWindow(w.value)}
                            className={`px-3 py-1 rounded-full text-sm transition-colors ${
                                window === w.value
                                    ? 'bg-sky-500 text-white'
                                    : 'text-gray-400 hover:text-sky-500'
                            }`}
                        >
                            {w.label}
                        </button>
                    ))}
                    <span className="text-gray-200 dark:text-gray-700 self-center px-1">·</span>
                    {SORTS.map(s => (
                        <button
                            key={s.value}
                            onClick={() => changeSortBy(s.value)}
                            className={`px-3 py-1 rounded-full text-sm transition-colors ${
                                sortBy === s.value ? 'bg-sky-500 text-white' : 'text-gray-400 hover:text-sky-500'
                            }`}
                        >
                            {s.label}
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
                    <SongGrid songs={mainList} libraryIds={libraryIds} sortBy={sortBy} showSource={viewFilter === 'everyone'} />
                </div>
            )}
        </div>
    )
}
