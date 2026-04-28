'use client'
import { RefObject, useEffect, useState } from 'react'

export function useVirtualList(
    containerRef: RefObject<HTMLElement | null>,
    itemCount: number,
    rowHeight: number,
    overscan = 3,
    active = true,
) {
    const [scrollTop, setScrollTop] = useState(0)
    const [containerHeight, setContainerHeight] = useState(0)

    useEffect(() => {
        if (!active) return
        const el = containerRef.current
        if (!el) return
        setScrollTop(0)
        setContainerHeight(el.clientHeight)
        const onScroll = () => setScrollTop(el.scrollTop)
        const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight))
        el.addEventListener('scroll', onScroll, { passive: true })
        ro.observe(el)
        return () => { el.removeEventListener('scroll', onScroll); ro.disconnect() }
    }, [containerRef, active])

    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
    const end = Math.min(itemCount, Math.ceil((scrollTop + containerHeight) / rowHeight) + overscan)

    return { start, end, totalHeight: itemCount * rowHeight, offsetTop: start * rowHeight }
}
