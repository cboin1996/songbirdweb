'use client'
import { useEffect, useState } from 'react'
import { EVENTS } from './events'

export function useOnline(): boolean {
    const [online, setOnline] = useState(true)

    useEffect(() => {
        setOnline(navigator.onLine)
        const handleOnline = () => setOnline(true)
        const handleOffline = () => setOnline(false)
        const handleServerDown = () => setOnline(false)
        const handleServerUp = () => { if (navigator.onLine) setOnline(true) }
        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)
        window.addEventListener(EVENTS.serverUnreachable, handleServerDown)
        window.addEventListener(EVENTS.serverReachable, handleServerUp)
        return () => {
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
            window.removeEventListener(EVENTS.serverUnreachable, handleServerDown)
            window.removeEventListener(EVENTS.serverReachable, handleServerUp)
        }
    }, [])

    return online
}
