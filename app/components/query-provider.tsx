'use client'
import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { createAppQueryClient } from '../lib/library-cache'
import { EVENTS } from '../lib/events'
import { queryKeys } from '../lib/query-keys'
import { isOffline } from '../lib/offline-signal'

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

    // Offline copies cleared (on the settings page): the library's list may have been the device's
    // copy. Mark it stale; a mounted library asks again now unless the device is offline.
    useEffect(() => {
        const cleared = () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.librarySongs, refetchType: isOffline() ? 'none' : 'active' })
        }
        window.addEventListener(EVENTS.offlineCleared, cleared)
        return () => window.removeEventListener(EVENTS.offlineCleared, cleared)
    }, [queryClient])

    // A draft saved or discarded while the library is not on screen (the editor is its own page)
    // still has to show when the library comes back: its cached drafts are marked stale here,
    // so the next mount asks again, and a mounted list asks now.
    useEffect(() => {
        const changed = (e: Event) => {
            // A discard announces itself twice: the delete (no detail), then the list's optimistic
            // removal (with detail). One refetch is enough.
            if ((e as CustomEvent).detail?.deleted) return
            void queryClient.invalidateQueries({ queryKey: queryKeys.drafts })
        }
        window.addEventListener(EVENTS.draftChanged, changed)
        return () => window.removeEventListener(EVENTS.draftChanged, changed)
    }, [queryClient])

    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    )
}
