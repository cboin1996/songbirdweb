const bone = 'bg-gray-100 dark:bg-gray-800 animate-pulse'

// Mirrors the real list: flat rows on a phone, a 2/3/4-column grid of larger cards from md up.
function ItemSkeleton() {
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 p-3 md:p-2">
                <div className={`w-12 h-12 md:w-24 md:h-24 rounded shrink-0 ${bone}`} />
                <div className="flex flex-col gap-2 flex-1 min-w-0 md:px-1">
                    <div className={`h-4 md:h-5 w-3/5 rounded ${bone}`} />
                    <div className={`h-3.5 w-2/5 rounded ${bone}`} />
                    <div className={`hidden md:block h-3.5 w-1/4 rounded ${bone}`} />
                </div>
                <div className={`w-5 h-5 rounded-full shrink-0 mr-1 ${bone}`} />
            </div>
            <div className={`h-3 w-16 rounded mx-1 ${bone}`} />
        </div>
    )
}

export default function Loading() {
    return (
        <div className="skeleton-delay p-4 flex flex-col gap-6">
            {/* toolbar: search and sort, then the filter chips; one row from md up */}
            <div className="sticky top-11 z-40 bg-[var(--background)]/90 py-3 flex flex-col md:flex-row gap-2 border-b border-gray-100 dark:border-gray-800 -mt-px">
                <div className="flex gap-2 items-center">
                    <div className={`h-9 flex-1 md:max-w-xs rounded-full ${bone}`} />
                    <div className={`h-7 w-20 rounded-full ${bone}`} />
                </div>
                <div className="flex flex-1 flex-wrap gap-2 items-center">
                    {Array.from({ length: 4 }).map((_, i) => <div key={i} className={`h-7 w-16 rounded-full ${bone}`} />)}
                    <div className="self-stretch w-px bg-gray-200 dark:bg-gray-700 mx-1" />
                    {Array.from({ length: 3 }).map((_, i) => <div key={i} className={`h-7 w-14 rounded-full ${bone}`} />)}
                </div>
            </div>

            <div>
                <div className={`h-4 w-40 rounded mb-4 ${bone}`} />
                <div className="flex flex-col md:grid md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 md:gap-6">
                    {Array.from({ length: 12 }).map((_, i) => <ItemSkeleton key={i} />)}
                </div>
            </div>
        </div>
    )
}
