'use client'
import { useEffect } from 'react'

export default function PageError({ error, reset, context }: { error: Error & { digest?: string }; reset: () => void; context?: string }) {
    useEffect(() => { console.error(error) }, [error])
    return (
        <main className="flex flex-col items-center justify-center min-h-[40vh] gap-4 p-6">
            <p className="text-gray-400 text-sm">
                {context ? `couldn't load ${context}` : 'something went wrong'}
            </p>
            <p className="text-xs text-gray-500">the server may be unavailable</p>
            <button
                onClick={reset}
                className="px-4 py-1.5 rounded-full bg-sky-500 hover:bg-sky-400 text-white text-sm transition-colors"
            >
                try again
            </button>
        </main>
    )
}
