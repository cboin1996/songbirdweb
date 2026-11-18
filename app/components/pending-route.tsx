'use client'
import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { routes } from '../lib/routes'
import { holdSkeletonHandoff, releaseSkeletonHandoff } from '../lib/skeleton-timing'
import LibraryLoading from '../(authed)/library/library-skeleton'
import ExploreLoading from '../(authed)/explore/explore-skeleton'
import AdminLoading from '../(authed)/admin/admin-skeleton'
import InfoLoading from '../(authed)/info/info-skeleton'

// Why not loading.tsx: a route-level loading.tsx is a Suspense fallback, and React keeps a
// fallback on screen for 300 ms before it reveals content that is already there, so every
// first click into a route waited 300 ms. Here the old page stays while the new one loads (a
// plain transition, which React does not throttle), and only a navigation still running after
// SHOW_AFTER_MS swaps in the new route's skeleton.
export const SHOW_AFTER_MS = 200

const SKELETONS: Record<string, () => ReactNode> = {
    [routes.library]: () => <LibraryLoading />,
    [routes.explore]: () => <ExploreLoading />,
    [routes.admin]: () => <AdminLoading />,
    [routes.info]: () => <InfoLoading />,
}

function onRoute(pathname: string, href: string) {
    return pathname === href || pathname.startsWith(href + '/')
}

const PendingContext = createContext<(href: string) => void>(() => {})

export function NavPendingProvider({ children }: { children: ReactNode }) {
    const pathname = usePathname()
    // A navigation that has been under way for SHOW_AFTER_MS: where it goes, and the page it left.
    // Set only from the timer: Next calls onNavigate inside the navigation's transition, and a
    // state update made there would wait for that same transition, i.e. never show.
    const [pending, setPending] = useState<{ to: string; from: string } | null>(null)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const held = useRef(false)
    // Any route change ends it, back and forward included: otherwise returning to `from` later
    // would match again and bring a stale skeleton back.
    const [seenPath, setSeenPath] = useState(pathname)
    if (seenPath !== pathname) { setSeenPath(pathname); setPending(null) }

    const begin = (href: string) => {
        if (onRoute(pathname, href)) return
        if (timer.current) clearTimeout(timer.current)
        const from = pathname
        timer.current = setTimeout(() => {
            timer.current = null
            held.current = true
            holdSkeletonHandoff()
            setPending({ to: href, from })
        }, SHOW_AFTER_MS)
    }

    // The new route committed.
    useEffect(() => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null }
        if (held.current) { held.current = false; releaseSkeletonHandoff() }
    }, [pathname])

    const active = pending && pending.from === pathname ? pending.to : null
    const skeleton = active ? SKELETONS[active] : undefined
    return (
        <PendingContext.Provider value={begin}>
            <PendingSlot.Provider value={skeleton ?? null}>{children}</PendingSlot.Provider>
        </PendingContext.Provider>
    )
}

const PendingSlot = createContext<(() => ReactNode) | null>(null)

// Renders the page, or the loading route's skeleton while a slow navigation is under way.
export function PendingRoute({ children }: { children: ReactNode }) {
    const skeleton = useContext(PendingSlot)
    if (!skeleton) return <>{children}</>
    return <div data-testid="route-skeleton" className="skeleton-fade">{skeleton()}</div>
}

// A Link that reports its navigation, so a slow one can show the route's skeleton.
export function PendingLink({ onNavigate, ...props }: ComponentProps<typeof Link>) {
    const begin = useContext(PendingContext)
    return <Link {...props} onNavigate={e => { onNavigate?.(e); begin(String(props.href)) }} />
}
