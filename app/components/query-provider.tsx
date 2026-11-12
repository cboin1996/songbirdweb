'use client'
import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { createAppQueryClient } from '../lib/library-cache'
import { EVENTS } from '../lib/events'
import { queryKeys } from '../lib/query-keys'

export default function QueryProvider({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(createAppQueryClient)

    // While the server could not be reached the lists held the device's copy, marked fresh
    // for five minutes. Once it answers again, ask for the real ones. Only after an unreachable
    // spell: every answer raises serverReachable, and refetching on each would never end.
    useEffect(() => {
        let wasDown = false
        const down = () => { wasDown = true }
        const back = () => {
            if (!wasDown) return
            wasDown = false
            void queryClient.invalidateQueries({ queryKey: queryKeys.librarySongs })
            void queryClient.invalidateQueries({ queryKey: queryKeys.library })
            void queryClient.invalidateQueries({ queryKey: queryKeys.playlists })
        }
        window.addEventListener(EVENTS.serverUnreachable, down)
        window.addEventListener('offline', down)
        window.addEventListener(EVENTS.serverReachable, back)
        window.addEventListener('online', back)
        return () => {
            window.removeEventListener(EVENTS.serverUnreachable, down)
            window.removeEventListener('offline', down)
            window.removeEventListener(EVENTS.serverReachable, back)
            window.removeEventListener('online', back)
        }
    }, [queryClient])

    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    )
}
