'use client'
import { useSyncExternalStore } from 'react'
import { isOffline, subscribeOffline } from './offline-signal'

// Before hydration there is no browser to ask, so the first render is "online",
// as it always was.
export function useOnline(): boolean {
    return useSyncExternalStore(subscribeOffline, () => !isOffline(), () => true)
}
