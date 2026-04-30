'use client'
import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export function useScrollRestoration() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Restore scroll on mount
    useEffect(() => {
        const y = parseInt(searchParams.get('scroll') ?? '', 10)
        if (!isNaN(y) && y > 0) {
            const id = setTimeout(() => window.scrollTo(0, y), 100)
            return () => clearTimeout(id)
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Persist scroll on scroll events (debounced 300ms)
    useEffect(() => {
        function onScroll() {
            if (timerRef.current !== null) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => {
                const y = window.scrollY
                const params = new URLSearchParams(searchParams.toString())
                if (y > 0) {
                    params.set('scroll', String(y))
                } else {
                    params.delete('scroll')
                }
                const qs = params.toString()
                router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false })
            }, 300)
        }

        window.addEventListener('scroll', onScroll, { passive: true })
        return () => {
            window.removeEventListener('scroll', onScroll)
            if (timerRef.current !== null) clearTimeout(timerRef.current)
        }
    }, [router, searchParams])
}
