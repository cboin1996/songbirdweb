function SongCardSkeleton() {
    return (
        <div className="flex flex-col gap-1 p-2">
            <div className="w-full aspect-square rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
            <div className="h-3 w-3/4 rounded bg-gray-100 dark:bg-gray-800 animate-pulse mt-1" />
            <div className="h-2.5 w-1/2 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
        </div>
    )
}

function SectionSkeleton({ label, count = 4 }: { label: string; count?: number }) {
    return (
        <div className="flex flex-col gap-4">
            <div className="h-3 w-24 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-8">
                {Array.from({ length: count }).map((_, i) => <SongCardSkeleton key={i} />)}
            </div>
        </div>
    )
}

export default function Loading() {
    return (
        <main className="p-4">
            {/* toolbar skeleton */}
            <div className="sticky top-11 z-40 bg-white/90 dark:bg-gray-950/90 py-3 flex flex-col gap-3 border-b border-gray-100 dark:border-gray-800 mb-6">
                <div className="h-8 w-full md:w-80 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
                <div className="flex gap-2 flex-wrap">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="h-7 w-20 rounded-full bg-gray-100 dark:bg-gray-800 animate-pulse" />
                    ))}
                </div>
            </div>

            <div className="flex flex-col gap-10">
                <SectionSkeleton label="most played" count={4} />
                <SectionSkeleton label="recently added" count={4} />
                <SectionSkeleton label="your most played" count={4} />
            </div>
        </main>
    )
}
