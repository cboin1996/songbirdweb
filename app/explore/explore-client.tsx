'use client'
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ExploreData, ExploreWindow, SongWithCount, RecentlyPlayedSong, fetchLibrary } from "../lib/data"
import { routes } from "../lib/routes"
import { usePlayer } from "../components/player"
import Song from "../components/song"

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

type AnyItem = SongWithCount | RecentlyPlayedSong | { uuid: string; url: string; properties: ExploreData['recently_added'][0]['properties'] }

function SongGrid({ songs, libraryIds }: {
    songs: AnyItem[]
    libraryIds: Set<string>
}) {
    const { play, current } = usePlayer()
    if (songs.length === 0) return <p className="text-gray-400 text-sm py-4">no data yet</p>
    const queue = songs.filter(s => s.properties).map(s => ({ uuid: s.uuid, properties: s.properties! }))
    return (
        <div className="grid 2xl:grid-cols-4 xl:grid-cols-3 lg:grid-cols-2 gap-2 md:gap-8 rounded-2xl justify-items-stretch">
            {songs.map(s => {
                if (!s.properties) return null
                const song = { songId: s.uuid, properties: s.properties }
                return (
                    <Song
                        key={s.uuid}
                        song={song}
                        selected={current?.uuid === s.uuid}
                        onClick={() => play({ uuid: s.uuid, properties: s.properties! }, queue, { label: 'Explore', href: routes.explore })}
                        inLibrary={libraryIds.has(s.uuid)}
                    />
                )
            })}
        </div>
    )
}

export default function ExploreClient({ data, window }: { data: ExploreData | undefined; window: ExploreWindow }) {
    const router = useRouter()
    const [sortBy, setSortBy] = useState<SortBy>('plays')
    const [libraryIds, setLibraryIds] = useState<Set<string>>(new Set())

    useEffect(() => {
        fetchLibrary().then(entries => setLibraryIds(new Set(entries.map(e => e.song_id))))
    }, [])

    function setWindow(w: ExploreWindow) {
        router.push(`/explore?window=${w}`)
    }

    const recentSelected = sortBy === 'recent' || sortBy === 'recently_played'

    const mainList: AnyItem[] = data
        ? sortBy === 'plays' ? data.most_played
        : sortBy === 'downloads' ? data.most_downloaded
        : sortBy === 'saves' ? data.most_libraryed
        : sortBy === 'recently_played' ? data.your_recently_played
        : data.recently_added
        : []

    const windowLabel = WINDOWS.find(w => w.value === window)?.label
    const sortLabel = SORTS.find(s => s.value === sortBy)?.label

    return (
        <div className="flex flex-col gap-6">
            <div className="sticky top-11 z-40 bg-white/90 dark:bg-gray-950/90 backdrop-blur-md py-3 flex flex-wrap gap-3 items-center justify-between border-b border-gray-100 dark:border-gray-800">
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
                            onClick={() => setSortBy(s.value)}
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
            ) : (
                <div className="flex flex-col gap-10">
                    <div>
                        <h2 className="text-sm font-medium text-gray-400 mb-4">
                            {sortLabel}
                            {!recentSelected && <span className="ml-1 text-gray-300 dark:text-gray-600">· {windowLabel}</span>}
                        </h2>
                        <SongGrid songs={mainList} libraryIds={libraryIds} />
                    </div>

                    {!recentSelected && (
                        <div>
                            <h2 className="text-sm font-medium text-gray-400 mb-4">
                                your stats
                                <span className="ml-1 text-gray-300 dark:text-gray-600">· {windowLabel}</span>
                            </h2>
                            <SongGrid songs={data.your_most_played} libraryIds={libraryIds} />
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
