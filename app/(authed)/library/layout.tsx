// Kept on purpose: with a layout segment of its own, the library route is prefetched
// from other pages, so "go to library" still works client-side once offline (e2e/offline.spec.ts).
export default function Layout({ children }: { children: React.ReactNode }) {
    return <>{children}</>
}
