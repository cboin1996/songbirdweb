'use client'
import { FaWifi } from 'react-icons/fa'
import { useOnline } from '../lib/use-online'
import { routes } from '../lib/routes'

export default function OfflineGuard({ feature, children }: { feature: string; children: React.ReactNode }) {
    const online = useOnline()
    if (online) return <>{children}</>
    return (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center gap-3">
            <FaWifi size={28} className="text-gray-400" />
            <p className="text-sm font-medium">you&rsquo;re offline</p>
            <p className="text-sm text-gray-400 max-w-xs">{feature} needs internet. your saved songs are still available.</p>
            <a
                href={routes.library}
                className="mt-2 px-4 py-1.5 bg-sky-500 hover:bg-sky-400 text-white rounded-full text-sm font-medium transition-colors"
            >
                go to library
            </a>
        </div>
    )
}
