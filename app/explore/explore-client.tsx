'use client'
import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ExploreData, ExploreWindow, SongWithCount, RecentlyPlayedSong, RecentlySavedSong, fetchLibrary } from "../lib/data"
import { routes } from "../lib/routes"
import { usePlayer } from "../components/player"
import Song from "../components/song"
import { useScrollRestoration } from "../lib/use-scroll-restoration"

const WINDOWS: { value: ExploreWindow; label: string }[] = [
    { value: 'day', label: 'today' },
    { value: 'week', label: 'this week' },
    { value: 'all', label: 'all time' },
]

type SortBy = 'plays' | 'downloads' | 'saves' | 'recent' | 'recently_played'
const SORTS: { value: SortBy; label: string }[] = [
    { value: 'plays', label: 'most played' },
    { value: 'downloads', label: 'most downloaded' },
    { value: 'saves', label: 'most saved' },
    { value: 'recent', label: 'recently added' },
    { value: 'recently_played', label: 'recently played' },
]

type AnyItem = SongWithCount | RecentlyPlayedSong | RecentlySavedSong | { uuid: string; url?: string; properties: ExploreData['recently_added'][0]['properties']; source?: string | null }

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
        return `added ${new Date((item as { added_at: string }).added_at).toLocaleDateString()}`
    }
    if ('last_played_at' in item && typeof (item as RecentlyPlayedSong).last_played_at === 'string') {
        return `played ${new Date((item as RecentlyPlayedSong).last_played_at).toLocaleDateString()}`
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
    if (songs.length === 0) return <p className="text-gray-400 text-sm py-4">no data yet</p>
    const queue = songs.filter(s => s.properties).map(s => ({ uuid: s.uuid, properties: s.properties! }))
    return (
        <div className="grid 2xl:grid-cols-4 xl:grid-cols-3 lg:grid-cols-2 gap-2 md:gap-8 rounded-2xl justify-items-stretch">
            {songs.map(s => {
                if (!s.properties) return null
                const song = { songId: s.uuid, properties: s.properties, source: ('source' in s ? s.source : undefined) ?? undefined }
                const stat = itemStat(s, sortBy)
                return (
                    <div key={s.uuid} className="flex flex-col gap-1">
                        <Song
                            song={song}
                            selected={current?.uuid === s.uuid}
                            onClick={() => play({ uuid: s.uuid, properties: s.properties! }, queue, { label: 'Explore', href: routes.explore })}
                            inLibrary={libraryIds.has(s.uuid)}
                            showSource={showSource}
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
    const [libraryIds, setLibraryIds] = useState<Set<string>>(new Set())
    const [search, setSearch] = useState(searchParams.get('q') ?? '')
    useScrollRestoration()

    useEffect(() => {
        fetchLibrary().then(entries => setLibraryIds(new Set(entries.map(e => e.song_id))))
    }, [])

    function setWindow(w: ExploreWindow) {
        router.push(`/explore?window=${w}&sort=${sortBy}`)
    }

    function changeSortBy(s: SortBy) {
        setSortBy(s)
        const params = new URLSearchParams(searchParams.toString())
        params.set('sort', s)
        router.replace(`/explore?${params.toString()}`)
    }

    function changeSearch(q: string) {
        setSearch(q)
        const params = new URLSearchParams(searchParams.toString())
        if (q) {
            params.set('q', q)
        } else {
            params.delete('q')
        }
        router.replace(`/explore?${params.toString()}`)
    }

    const recentSelected = sortBy === 'recent' || sortBy === 'recently_played'

    const rawMainList: AnyItem[] = data
        ? sortBy === 'plays' ? data.most_played
        : sortBy === 'downloads' ? data.most_downloaded
        : sortBy === 'saves' ? data.most_libraryed
        : sortBy === 'recently_played' ? data.your_recently_played
        : data.recently_added
        : []

    const mainList = rawMainList.filter(s => matchesSearch(s, search))

    const windowLabel = WINDOWS.find(w => w.value === window)?.label
    const sortLabel = SORTS.find(s => s.value === sortBy)?.label

    return (
        <div className="flex flex-col gap-6">
            <div className="sticky top-11 z-40 bg-white/90 dark:bg-gray-950/90 backdrop-blur-md py-3 flex flex-col gap-3 border-b border-gray-100 dark:border-gray-800">
                <input
                    type="text"
                    placeholder="search by track or artist…"
                    value={search}
                    onChange={e => changeSearch(e.target.value)}
                    className="w-full md:w-80 px-3 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-sky-500"
                />
                <div className="flex flex-wrap gap-3 items-center justify-between">
                    <div className="flex gap-1">
                        {WINDOWS.map(w => (
                            <button
                                key={w.value}
                                onClick={() => setWindow(w.value)}
                                disabled={recentSelected}
                                className={`px-3 py-1 rounded-full text-sm transition-colors disabled:opacity-30 ${
                                    window === w.value && !recentSelected
                                        ? 'bg-sky-500 text-white'
                                        : 'text-gray-400 hover:text-sky-500'
                                }`}
                            >
                                {w.label}
                            </button>
                        ))}
                    </div>
                    <div className="flex gap-1">
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
            </div>

            {!data ? (
                <p className="text-gray-400 text-sm">failed to load</p>
            ) : (() => {
                const rawYourList: AnyItem[] | null =
                    sortBy === 'plays' ? data.your_most_played :
                    sortBy === 'downloads' ? data.your_most_downloaded :
                    sortBy === 'saves' ? data.your_recently_saved :
                    sortBy === 'recent' ? data.your_recently_saved :
                    sortBy === 'recently_played' ? data.your_recently_played :
                    null
                const yourList = rawYourList ? rawYourList.filter(s => matchesSearch(s, search)) : null
                const showWindow = !recentSelected
                const noResults = search && mainList.length === 0 && (!yourList || yourList.length === 0)
                return (
                    <div className="flex flex-col gap-10">
                        {noResults ? (
                            <p className="text-gray-400 text-sm">no results for &lsquo;{search}&rsquo;</p>
                        ) : (
                            <>
                                <div>
                                    <h2 className="text-sm font-medium text-gray-400 mb-4">
                                        {sortLabel}
                                        {!recentSelected && <span className="ml-1 text-gray-300 dark:text-gray-600">· {windowLabel}</span>}
                                    </h2>
                                    <SongGrid songs={mainList} libraryIds={libraryIds} sortBy={sortBy} showSource={true} />
                                </div>
                                {yourList && (
                                    <div>
                                        <h2 className="text-sm font-medium text-gray-400 mb-4">
                                            your {sortLabel}
                                            {showWindow && <span className="ml-1 text-gray-300 dark:text-gray-600">· {windowLabel}</span>}
                                        </h2>
                                        <SongGrid songs={yourList} libraryIds={libraryIds} sortBy={sortBy} showSource={true} />
                                    </div>
                                )}
                                {data && data.community_popular.length > 0 && (
                                    <div>
                                        <h2 className="text-sm font-medium text-gray-400 mb-4">
                                            from the community
                                            {!recentSelected && <span className="ml-1 text-gray-300 dark:text-gray-600">· {windowLabel}</span>}
                                        </h2>
                                        <SongGrid songs={data.community_popular.filter(s => matchesSearch(s, search))} libraryIds={libraryIds} sortBy={sortBy} showSource={true} />
                                    </div>
                                )}
                                {data && data.community_recent.length > 0 && (
                                    <div>
                                        <h2 className="text-sm font-medium text-gray-400 mb-4">recently added by the community</h2>
                                        <SongGrid songs={data.community_recent.filter(s => matchesSearch(s, search))} libraryIds={libraryIds} sortBy={sortBy} showSource={true} />
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )
            })()}
        </div>
    )
}
