'use client'

export default function QueryError({ error, retry }: { error: Error; retry?: () => void }) {
    return (
        <div className="flex items-center gap-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-4 py-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error.message || 'something went wrong'}</p>
            {retry && (
                <button
                    onClick={() => retry()}
                    className="shrink-0 px-3 py-1 rounded-full bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-200 dark:hover:bg-red-900 transition-colors"
                >
                    retry
                </button>
            )}
        </div>
    )
}
