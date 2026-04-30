export default function Loading() {
    return (
        <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
            <div className="flex flex-col items-center gap-6 max-w-sm w-full">
                {/* artwork */}
                <div className="w-60 h-60 rounded-2xl bg-gray-100 dark:bg-gray-800 animate-pulse shadow-xl" />
                {/* title + artist */}
                <div className="flex flex-col items-center gap-2 w-full">
                    <div className="h-5 w-48 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
                    <div className="h-4 w-32 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
                    <div className="h-3 w-24 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
                </div>
                {/* play button */}
                <div className="h-10 w-32 rounded-full bg-gray-100 dark:bg-gray-800 animate-pulse" />
            </div>
        </main>
    )
}
