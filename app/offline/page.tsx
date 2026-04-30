export default function OfflinePage() {
    return (
        <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
            <div className="text-center">
                <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">you're offline</p>
                <p className="text-gray-400 text-sm">songs saved for offline will still play from the library.</p>
            </div>
        </main>
    )
}
