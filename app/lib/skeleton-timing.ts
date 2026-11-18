// A skeleton normally waits 200 ms before it fades in (.skeleton-delay), so a load that is fast
// shows none. When a navigation skeleton is already on screen and the page that replaces it
// starts with its own skeleton, that one must not start invisible again: it would blink.
let handoffUntil = 0

export function holdSkeletonHandoff() { handoffUntil = Infinity }
export function releaseSkeletonHandoff() { handoffUntil = performance.now() + 500 }

export function skeletonClass(): string {
    if (typeof performance !== 'undefined' && performance.now() < handoffUntil) return 'skeleton-now'
    return 'skeleton-delay'
}
