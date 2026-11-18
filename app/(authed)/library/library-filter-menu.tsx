'use client'

import { useEffect, useRef, useState } from 'react'
import { FaCheck, FaFilter } from 'react-icons/fa'

type Props = {
    savedOnly: boolean
    onSavedOnlyChange: (next: boolean) => void
    savedCount: number
    total: number
}

// The menu spans the nearest positioned parent (filter + search), so it fits the screen.
// One button for every library filter, with how many are on, so filters don't each
// take a pill in the toolbar. New filters join the menu.
export default function LibraryFilterMenu({ savedOnly, onSavedOnlyChange, savedCount, total }: Props) {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)
    const active = savedOnly ? 1 : 0

    useEffect(() => {
        if (!open) return
        function handleClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
        }
        function handleKey(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', handleClick)
        document.addEventListener('keydown', handleKey)
        return () => {
            document.removeEventListener('mousedown', handleClick)
            document.removeEventListener('keydown', handleKey)
        }
    }, [open])

    return (
        <div ref={ref}>
            <button
                data-testid="library-filter"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={active ? `filter (${active} on)` : 'filter'}
                title={active ? `filter (${active} on)` : 'filter'}
                onClick={() => setOpen(v => !v)}
                className={`relative flex items-center justify-center w-8 h-8 rounded-full transition-colors ${active ? 'text-sky-500' : 'text-gray-400 hover:text-sky-500'}`}
            >
                <FaFilter size={13} aria-hidden />
                {active > 0 && (
                    <span data-testid="library-filter-count" aria-hidden className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-sky-500 text-white text-[10px] leading-4 text-center tabular-nums">
                        {active}
                    </span>
                )}
            </button>
            {open && (
                <div role="menu" className="absolute top-full left-0 right-0 mt-1 z-50 bg-surface border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden py-1">
                    <button
                        role="menuitemcheckbox"
                        aria-checked={savedOnly}
                        data-testid="filter-saved"
                        onClick={() => onSavedOnlyChange(!savedOnly)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                        <span className="w-3 shrink-0 text-sky-500">{savedOnly && <FaCheck size={10} aria-hidden />}</span>
                        <span className="flex-1 min-w-0 truncate">saved offline</span>
                        <span className="shrink-0 text-xs text-gray-400 tabular-nums">{savedCount} of {total}</span>
                    </button>
                </div>
            )}
        </div>
    )
}
