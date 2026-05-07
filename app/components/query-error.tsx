'use client'

import { useState } from 'react'
import { FaCopy, FaCheck } from 'react-icons/fa'

export default function QueryError({ error, retry, context, message }: { error: Error; retry?: () => void; context?: string; message?: string }) {
    const [expanded, setExpanded] = useState(false)
    const [copied, setCopied] = useState(false)

    function copyError() {
        navigator.clipboard.writeText(error.message || 'unknown error')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div className="w-fit rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-4 py-3">
            <div className="flex items-center gap-3">
                <p className="text-sm text-red-600 dark:text-red-400 flex-1">
                    {message ?? (context ? `couldn't load ${context}` : 'something went wrong')}
                </p>
                {retry && (
                    <button
                        onClick={() => retry()}
                        className="shrink-0 px-3 py-1 rounded-full bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-200 dark:hover:bg-red-900 transition-colors"
                    >
                        retry
                    </button>
                )}
            </div>
            <details open={expanded} onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}>
                <summary className="mt-2 text-xs text-red-400 dark:text-red-500 cursor-pointer select-none">
                    details
                </summary>
                <div className="mt-1 flex items-start gap-2">
                    <code className="text-xs text-red-500 dark:text-red-400 bg-red-100 dark:bg-red-950/50 rounded px-2 py-1 break-all flex-1">
                        {error.message || 'unknown error'}
                    </code>
                    <button
                        onClick={copyError}
                        className="shrink-0 p-1 text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors"
                    >
                        {copied ? <FaCheck size={12} /> : <FaCopy size={12} />}
                    </button>
                </div>
            </details>
        </div>
    )
}
