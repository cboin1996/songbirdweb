import { useSyncExternalStore } from 'react'

// One media-query subscription for every page that switches between the phone and
// desktop layout. Read from the store, so a client-side navigation draws the desktop
// layout on its first render rather than after an effect has run. A full page load
// still draws the phone layout until hydration: the server cannot know the viewport.
const QUERY = '(min-width: 768px)'

function subscribe(cb: () => void) {
    const mq = window.matchMedia(QUERY)
    mq.addEventListener('change', cb)
    return () => mq.removeEventListener('change', cb)
}

export function useIsDesktop(): boolean {
    return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}
