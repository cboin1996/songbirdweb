'use client'
import { useOnline } from '../lib/use-online'

export default function OfflineBanner() {
    const online = useOnline()
    if (online) return null
    return (
        <div data-testid="offline-banner" className="fixed top-0 left-0 right-0 z-[9999] bg-sky-500/10 border-b border-sky-500/20 text-sky-500 text-center text-xs py-1 px-4">
            offline
        </div>
    )
}
