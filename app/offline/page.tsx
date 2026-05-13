export default function OfflinePage() {
    return (
        <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
            <div className="text-center">
                <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">you&rsquo;re offline</p>
                <p className="text-gray-400 text-sm mb-6">songs saved for offline will still play from the library.</p>
                <div className="flex gap-4 justify-center">
                    <a
                        href="/library"
                        className="px-4 py-1.5 bg-sky-500 hover:bg-sky-400 text-white rounded-full text-sm font-medium transition-colors"
                    >
                        go to library
                    </a>
                    <a
                        href="/settings"
                        className="px-4 py-1.5 bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-sm font-medium transition-colors"
                    >
                        settings
                    </a>
                </div>
            </div>
        </main>
    )
}
