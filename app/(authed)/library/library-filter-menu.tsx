'use client'

import { useEffect, useRef, useState } from 'react'
import { FaCheck, FaChevronDown } from 'react-icons/fa'

type Props = {
    savedOnly: boolean
    onSavedOnlyChange: (next: boolean) => void
    savedCount: number
    total: number
}

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
        <div ref={ref} className="relative">
            <button
                data-testid="library-filter"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm transition-colors border ${active ? 'bg-sky-500 text-white border-sky-500' : 'text-gray-400 border-gray-200 dark:border-gray-800 hover:text-sky-500 hover:border-sky-500'}`}
            >
                {active ? `filter · ${active}` : 'filter'}
                <FaChevronDown size={9} aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div role="menu" className="absolute top-full left-0 mt-1 z-50 min-w-52 bg-surface border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden py-1">
                    <button
                        role="menuitemcheckbox"
                        aria-checked={savedOnly}
                        data-testid="filter-saved"
                        onClick={() => onSavedOnlyChange(!savedOnly)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                        <span className="w-3 shrink-0 text-sky-500">{savedOnly && <FaCheck size={10} aria-hidden />}</span>
                        <span className="flex-1">saved only</span>
                        <span className="text-xs text-gray-400 tabular-nums">{savedCount} of {total}</span>
                    </button>
                </div>
            )}
        </div>
    )
}
