'use client'
import { useRef, useState } from "react"
import { importSong } from "../lib/data"
import Spinner from "./spinner"

export default function ImportFile() {
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
    const [trackName, setTrackName] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    async function handleFile(file: File) {
        setStatus('loading')
        setTrackName(null)
        const result = await importSong(file)
        if (!result) {
            setStatus('error')
            return
        }
        setTrackName(result.properties?.trackName ?? null)
        setStatus('success')
    }

    function onChange(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (file) handleFile(file)
    }

    return (
        <div className="flex flex-col gap-3 p-4 rounded-xl bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 w-full max-w-md">
            <p className="font-semibold text-sm">Import local file</p>
            <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-6 cursor-pointer hover:border-sky-500 transition-colors"
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                    e.preventDefault()
                    const file = e.dataTransfer.files?.[0]
                    if (file) handleFile(file)
                }}
            >
                <span className="text-xs text-gray-500">.mp3 or .m4a</span>
                <span className="text-xs text-gray-400">drag & drop or click to select</span>
                <input
                    ref={inputRef}
                    type="file"
                    accept=".mp3,.m4a"
                    className="hidden"
                    onChange={onChange}
                />
            </label>
            {status === 'loading' && (
                <div className="flex flex-row items-center gap-2 text-sm text-gray-500">
                    <Spinner />
                    <span>importing...</span>
                </div>
            )}
            {status === 'success' && (
                <p className="text-sm text-green-600 dark:text-green-400">
                    imported + added to library{trackName ? `: ${trackName}` : ''}
                </p>
            )}
            {status === 'error' && (
                <p className="text-sm text-red-500">import failed</p>
            )}
        </div>
    )
}
