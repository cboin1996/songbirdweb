import { skeletonClass } from "../lib/skeleton-timing"
// Placeholder rows shown while a list's data is on its way.

export function SongRowsSkeleton({ rows = 8, testId = 'skeleton-rows' }: { rows?: number; testId?: string }) {
    return (
        <div data-testid={testId} aria-busy="true" aria-label="loading" className={`${skeletonClass()} flex flex-col p-4`}>
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 w-full p-2">
                    <div className="w-12 h-12 rounded shrink-0 bg-gray-100 dark:bg-gray-800 animate-pulse" />
                    <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                        <div className={`h-3 rounded bg-gray-100 dark:bg-gray-800 animate-pulse ${i % 3 === 0 ? 'w-2/5' : 'w-1/3'}`} />
                        <div className="h-2.5 rounded bg-gray-100 dark:bg-gray-800 animate-pulse w-1/4" />
                    </div>
                </div>
            ))}
        </div>
    )
}
