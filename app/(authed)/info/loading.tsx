export default function Loading() {
    return (
        <main className="p-4">
            <div className="flex flex-col gap-6 py-4">
                <div className="h-3 w-10 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
                <div className="flex flex-row flex-wrap gap-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="flex flex-col gap-2 p-4 rounded-lg border border-gray-100 dark:border-gray-800 w-56">
                            <div className="h-3.5 w-32 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
                            <div className="h-2.5 w-24 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
                        </div>
                    ))}
                </div>
            </div>
        </main>
    )
}
