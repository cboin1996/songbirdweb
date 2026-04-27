const ROWS = 12

function SongRowSkeleton({ wide }: { wide?: boolean }) {
    return (
        <div className="flex items-center gap-3 w-full p-2">
            <div className="w-9 h-9 rounded shrink-0 bg-gray-100 dark:bg-gray-800 animate-pulse" />
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <div className={`h-3 rounded bg-gray-100 dark:bg-gray-800 animate-pulse ${wide ? 'w-2/5' : 'w-1/3'}`} />
                <div className="h-2.5 rounded bg-gray-100 dark:bg-gray-800 animate-pulse w-1/4" />
            </div>
        </div>
    )
}

export default function Loading() {
    return (
        <div className="p-4 pr-9">
            {/* toolbar skeleton */}
            <div className="sticky top-11 z-40 bg-white/90 dark:bg-gray-950/90 py-3 flex gap-3 items-center border-b border-gray-100 dark:border-gray-800 mb-2">
                <div className="h-7 w-20 rounded-full bg-gray-100 dark:bg-gray-800 animate-pulse" />
                <div className="h-7 w-28 rounded-full bg-gray-100 dark:bg-gray-800 animate-pulse" />
                <div className="flex gap-1 ml-auto">
                    {['songs', 'artists', 'albums', 'genres', 'playlists'].map(v => (
                        <div key={v} className="h-7 w-14 rounded-full bg-gray-100 dark:bg-gray-800 animate-pulse" />
                    ))}
                </div>
            </div>

            {/* letter divider */}
            <div className="h-4 w-4 rounded bg-gray-100 dark:bg-gray-800 animate-pulse mb-1" />

            {/* song rows */}
            <div className="flex flex-col">
                {Array.from({ length: ROWS }).map((_, i) => (
                    <SongRowSkeleton key={i} wide={i % 3 === 0} />
                ))}
            </div>
        </div>
    )
}
