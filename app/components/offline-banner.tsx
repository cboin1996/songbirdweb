'use client'
import { useOnline } from '../lib/use-online'

export default function OfflineBanner() {
    const online = useOnline()
    if (online) return null
    return (
        <div className="fixed top-0 left-0 right-0 z-[9999] bg-amber-400 text-amber-900 text-center text-sm font-medium py-1.5 px-4">
            You&apos;re offline. Playing from saved songs.
        </div>
    )
}
