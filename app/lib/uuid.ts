// crypto.randomUUID() is gated to secure contexts (HTTPS or localhost). On
// iOS/Android over plain HTTP from a LAN IP it's undefined, breaking any code
// path that asks for a client-side ID. These IDs are just for local React keys
// and editor state — they don't need to be cryptographically random — so a
// timestamp+random fallback is fine.
export function makeLocalId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`
}
