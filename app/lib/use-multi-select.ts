'use client'
import { useCallback, useRef, useState } from 'react'

export function useMultiSelect(allIds: string[]) {
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const lastClickedRef = useRef<string | null>(null)
    const dragModeRef = useRef<'add' | 'remove' | null>(null)
    const dragVisitedRef = useRef<Set<string>>(new Set())
    const dragCandidateRef = useRef<string | null>(null)

    const toggle = useCallback((id: string, shiftHeld = false) => {
        if (shiftHeld && lastClickedRef.current) {
            const from = allIds.indexOf(lastClickedRef.current)
            const to = allIds.indexOf(id)
            if (from !== -1 && to !== -1) {
                const [lo, hi] = from < to ? [from, to] : [to, from]
                setSelected(prev => {
                    const next = new Set(prev)
                    allIds.slice(lo, hi + 1).forEach(rid => next.add(rid))
                    return next
                })
                lastClickedRef.current = id
                return
            }
        }
        setSelected(prev => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
        lastClickedRef.current = id
    }, [allIds])

    const selectAll = useCallback(() => setSelected(new Set(allIds)), [allIds])
    const clearAll = useCallback(() => setSelected(new Set()), [])
    const setAll = useCallback((ids: string[]) => setSelected(new Set(ids)), [])

    // Register drag candidate without toggling — drag activates lazily on first new item
    const startDrag = useCallback((id: string) => {
        dragCandidateRef.current = id
    }, [])

    const continueDrag = useCallback((id: string) => {
        // Activate drag mode when pointer reaches a second item
        if (dragCandidateRef.current !== null && dragModeRef.current === null && id !== dragCandidateRef.current) {
            const startId = dragCandidateRef.current
            setSelected(prev => {
                const mode: 'add' | 'remove' = prev.has(startId) ? 'remove' : 'add'
                dragModeRef.current = mode
                dragVisitedRef.current = new Set([startId])
                const next = new Set(prev)
                mode === 'add' ? next.add(startId) : next.delete(startId)
                return next
            })
        }
        if (!dragModeRef.current || dragVisitedRef.current.has(id)) return
        dragVisitedRef.current.add(id)
        setSelected(prev => {
            const next = new Set(prev)
            dragModeRef.current === 'add' ? next.add(id) : next.delete(id)
            return next
        })
    }, [])

    const endDrag = useCallback(() => {
        dragModeRef.current = null
        dragVisitedRef.current = new Set()
        dragCandidateRef.current = null
    }, [])

    return { selected, toggle, selectAll, clearAll, setAll, startDrag, continueDrag, endDrag }
}
