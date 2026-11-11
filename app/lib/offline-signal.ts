// The one definition of "offline", for the player and the pages alike.
//
// Offline is the browser saying so, or the last request to the API finding the
// server unreachable. The second is the dead zone: a phone between towers still
// reports a connection, and every request fails. It ends when the server answers
// something fresh (fetchData raises serverReachable for those, and never for a
// copy the service worker served from its cache), or the browser reports a
// connection coming back.
import { EVENTS } from './events'

let serverUnreachable = false
const listeners = new Set<() => void>()

function notify() {
    for (const l of listeners) l()
}

function setServerUnreachable(value: boolean) {
    if (serverUnreachable === value) return
    serverUnreachable = value
    notify()
}

if (typeof window !== 'undefined') {
    window.addEventListener(EVENTS.serverUnreachable, () => setServerUnreachable(true))
    window.addEventListener(EVENTS.serverReachable, () => setServerUnreachable(false))
    window.addEventListener('online', () => {
        serverUnreachable = false
        notify()
    })
    window.addEventListener('offline', notify)
}

export function isOffline(): boolean {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return true
    return serverUnreachable
}

export function subscribeOffline(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}
