'use client'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <html>
            <body className="bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
                <main className="flex flex-col items-center justify-center min-h-screen gap-4 p-6">
                    <p className="text-gray-400 text-sm">something went wrong</p>
                    <p className="text-xs text-gray-500 font-mono max-w-md text-center">{error.message}</p>
                    <button
                        onClick={reset}
                        className="px-4 py-1.5 rounded-full bg-sky-500 hover:bg-sky-400 text-white text-sm transition-colors"
                    >
                        try again
                    </button>
                </main>
            </body>
        </html>
    )
}
