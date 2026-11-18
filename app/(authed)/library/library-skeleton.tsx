import { skeletonClass } from "../../lib/skeleton-timing"
const ROWS = 12
const bone = 'bg-gray-100 dark:bg-gray-800 animate-pulse'

// Mirrors the real song row: a 48px thumbnail and two lines on a phone, a 96px one with
// three lines and an action column from md up.
function SongRowSkeleton({ wide }: { wide?: boolean }) {
    return (
        <div className="flex items-center gap-3 w-full p-3 md:p-2">
            <div className={`w-12 h-12 md:w-24 md:h-24 rounded shrink-0 ${bone}`} />
            <div className="flex flex-col gap-2 flex-1 min-w-0 md:px-1">
                <div className={`h-4 md:h-5 rounded ${bone} ${wide ? 'w-3/5 md:w-2/5' : 'w-1/2 md:w-1/3'}`} />
                <div className={`h-3.5 rounded ${bone} w-2/5 md:w-1/4`} />
                <div className={`hidden md:block h-3.5 rounded ${bone} w-1/6`} />
            </div>
            <div className={`w-5 h-5 rounded-full shrink-0 mr-1 ${bone}`} />
        </div>
    )
}

export default function Loading() {
    return (
        <div className={`${skeletonClass()} p-4`}>
            <div className="pr-7">
                {/* toolbar: sticky only from md up, like the real one */}
                <div className="md:sticky md:top-11 md:z-40 md:-mx-6 md:px-6 md:bg-[var(--background)]/90 md:border-b border-gray-100 dark:border-gray-800 md:pt-2">
                    <div className="flex flex-wrap gap-3 items-center mb-2 py-2">
                        <div className={`h-7 w-24 rounded-full ${bone}`} />
                        <div className={`hidden md:block h-7 w-16 rounded-full ${bone}`} />
                        <div className="flex gap-1 ml-auto justify-center md:justify-end w-full md:w-auto">
                            {['songs', 'artists', 'albums', 'genres', 'playlists'].map(v => (
                                <div key={v} className={`h-7 w-14 md:w-16 rounded-full ${bone}`} />
                            ))}
                        </div>
                    </div>
                </div>

                {/* letter divider */}
                <div className={`h-4 w-4 rounded mb-1 ml-1 ${bone}`} />

                <div className="flex flex-col md:grid md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 md:gap-6">
                    {Array.from({ length: ROWS }).map((_, i) => (
                        <SongRowSkeleton key={i} wide={i % 3 === 0} />
                    ))}
                </div>
            </div>
        </div>
    )
}
