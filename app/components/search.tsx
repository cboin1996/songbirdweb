'use client'
import { usePathname, useSearchParams, useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { FaSearch, FaTimes } from 'react-icons/fa'
import { routes } from '../lib/routes'

const MODES = ['song', 'album', 'url'] as const
type Mode = typeof MODES[number]
const MODE_ROUTES: Record<Mode, string> = { song: routes.downloadSong, album: routes.downloadAlbum, url: routes.downloadUrl }
function modeRoute(m: Mode) { return MODE_ROUTES[m] }

const PLACEHOLDERS: Record<Mode, string> = {
    song: 'search by song name…',
    album: 'search by album name…',
    url: 'paste a youtube, soundcloud, or vimeo url…',
}

export default function Search() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const { replace } = useRouter()
    const pathname = usePathname()
    const inputRef = useRef<HTMLInputElement>(null)

    const [text, setText] = useState(searchParams.get('query') ?? '')
    const [mode, setMode] = useState<Mode>((searchParams.get('mode') as Mode) ?? 'song')

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        const params = new URLSearchParams(searchParams)
        params.delete('lookup')
        if (text.trim()) {
            params.set('query', text.trim())
            params.set('mode', mode)
        } else {
            params.delete('query')
            params.delete('mode')
        }
        router.push(`${modeRoute(mode)}?${params.toString()}`)
    }

    function handleChange(v: string) {
        setText(v)
        if (!v) {
            const params = new URLSearchParams(searchParams)
            params.delete('query')
            params.delete('lookup')
            params.delete('limit')
            replace(`${pathname}?${params.toString()}`)
        }
    }

    function handleModeChange(m: Mode) {
        setMode(m)
        setText('')
        const params = new URLSearchParams(searchParams)
        params.delete('query')
        params.delete('lookup')
        params.delete('limit')
        params.set('mode', m)
        replace(`${modeRoute(m)}?${params.toString()}`)
    }

    return (
        <form onSubmit={handleSubmit}>
            <div className="flex flex-wrap gap-2 py-3 items-center">
                {MODES.map(m => (
                    <button
                        key={m}
                        type="button"
                        onClick={() => handleModeChange(m)}
                        className={`px-3 py-1 rounded-full text-sm transition-colors ${
                            mode === m ? 'bg-sky-500 text-white' : 'text-gray-400 hover:text-sky-500'
                        }`}
                    >
                        {m}
                    </button>
                ))}
                <span className="text-gray-200 dark:text-gray-700 self-center px-1">·</span>
                <div className="relative flex items-center flex-1 min-w-48 max-w-sm">
                    <FaSearch size={11} className="absolute left-3 text-gray-400 pointer-events-none" />
                    <input
                        ref={inputRef}
                        type={mode === 'url' ? 'url' : 'text'}
                        value={text}
                        onChange={e => handleChange(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Escape' && text) { handleChange(''); e.preventDefault() } }}
                        placeholder={PLACEHOLDERS[mode]}
                        className="w-full pl-8 pr-8 py-1.5 rounded-lg text-sm bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-sky-500 invalid:ring-2 invalid:ring-red-500"
                    />
                    {text && (
                        <button
                            type="button"
                            onClick={() => { handleChange(''); inputRef.current?.focus() }}
                            className="absolute right-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                        >
                            <FaTimes size={11} />
                        </button>
                    )}
                </div>
                <button
                    type="submit"
                    disabled={!text.trim()}
                    className="px-3 py-1.5 rounded-lg text-sm bg-sky-500 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-sky-600 transition-colors shrink-0"
                >
                    {mode === 'url' ? 'download' : 'search'}
                </button>
            </div>
        </form>
    )
}
