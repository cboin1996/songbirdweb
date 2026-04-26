import Link from 'next/link'
import { routes } from '../lib/routes'

export default async function Page() {
    const options = [
        { href: routes.downloadSong, label: 'Song', desc: 'search iTunes and download a single track' },
        { href: routes.downloadAlbum, label: 'Album', desc: 'download all tracks in an album' },
        { href: routes.downloadUrl, label: 'URL', desc: 'download from a direct audio URL' },
    ]
    return (
        <main className="flex flex-col items-center gap-6 p-6 max-w-lg mx-auto">
            <h1 className="text-lg font-semibold self-start">Download</h1>
            <div className="w-full flex flex-col gap-3">
                {options.map(o => (
                    <Link
                        key={o.href}
                        href={o.href}
                        className="flex flex-col gap-0.5 px-4 py-3 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800 hover:border-sky-500 transition-colors"
                    >
                        <span className="font-medium text-sm">{o.label}</span>
                        <span className="text-xs text-gray-400">{o.desc}</span>
                    </Link>
                ))}
            </div>
        </main>
    )
}
