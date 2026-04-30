'use client'
import { useEffect } from 'react'

export default function ServiceWorkerRegistrar() {
    useEffect(() => {
        if (process.env.NODE_ENV !== 'production') {
            // In dev, unregister any prior SW so stale chunks don't cause hydration errors.
            navigator.serviceWorker?.getRegistrations().then(rs => rs.forEach(r => r.unregister()))
            return
        }
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(err => console.error('[SW] registration failed:', err))
        }
    }, [])
    return null
}
