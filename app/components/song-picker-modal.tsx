'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { FaTimes, FaCheck, FaBars, FaMusic } from 'react-icons/fa'
import { Properties, artworkUrl, songArtworkUrl } from '../lib/data'
import { useMultiSelect } from '../lib/use-multi-select'
import { useVirtualList } from '../lib/use-virtual-list'

export interface PickerSong {
    uuid: string
    properties: Properties | null
    artwork_cached?: boolean
}

interface SongPickerModalProps {
    open: boolean
    onClose(): void
    title: string
    titleActions?: React.ReactNode
    songs: PickerSong[]
    // select
    selectable?: boolean
    initialSelected?: Set<string>
    actionLabel?: string
    actionLoading?: boolean
    onConfirm?(selectedIds: string[]): void
    // reorder
    reorderable?: boolean
    onReorder?(songs: PickerSong[]): void
    emptyState?: string
    // ineligible rows (uuid → list of missing field labels)
    disabledItems?: Record<string, string[]>
}

const ROW_H = 52

export default function SongPickerModal({
    open, onClose, title, titleActions, songs,
    selectable = false, initialSelected, actionLabel, actionLoading, onConfirm,
    reorderable = false, onReorder,
    emptyState = 'no songs',
    disabledItems,
}: SongPickerModalProps) {
    const allIds = songs.map(s => s.uuid)
    const { selected, toggle, selectAll, clearAll, setAll, startDrag, continueDrag, endDrag } = useMultiSelect(allIds)
    const [order, setOrder] = useState<PickerSong[]>(songs)
    const containerRef = useRef<HTMLDivElement>(null)
    const dragReorderRef = useRef<number | null>(null)
    const [dropTarget, setDropTarget] = useState<number | null>(null)
    const { start, end, totalHeight, offsetTop } = useVirtualList(containerRef, order.length, ROW_H, 3, open)

    // sync order when songs prop changes
    useEffect(() => { setOrder(songs) }, [songs])

    // apply initialSelected when modal opens
    useEffect(() => {
        if (open && initialSelected) setAll([...initialSelected])
        if (!open) clearAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    // ctrl+A
    useEffect(() => {
        if (!open || !selectable) return
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); selectAll() }
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, selectable])

    function handleConfirm() {
        onConfirm?.([...selected])
    }

    function onContainerPointerMove(e: React.PointerEvent) {
        const el = document.elementFromPoint(e.clientX, e.clientY)
        if (selectable) {
            const id = (el?.closest('[data-picker-id]') as HTMLElement | null)?.dataset.pickerId
            if (id) continueDrag(id)
        }
        if (reorderable && dragReorderRef.current !== null) {
            const idxStr = (el?.closest('[data-reorder-idx]') as HTMLElement | null)?.dataset.reorderIdx
            if (idxStr !== undefined) setDropTarget(parseInt(idxStr))
        }
    }

    function onContainerPointerUp() {
        endDrag()
        if (dragReorderRef.current !== null && dropTarget !== null && dragReorderRef.current !== dropTarget) {
            const next = [...order]
            const [moved] = next.splice(dragReorderRef.current, 1)
            next.splice(dropTarget, 0, moved)
            setOrder(next)
            onReorder?.(next)
        }
        dragReorderRef.current = null
        setDropTarget(null)
    }

    if (!open) return null

    const body = (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center">
            {/* backdrop */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
            <div className="relative z-10 w-full sm:w-[480px] max-h-[85vh] flex flex-col bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden">
                {/* header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
                    <span className="font-semibold text-sm flex-1 min-w-0 truncate">{title}</span>
                    <div className="flex items-center gap-3 shrink-0">
                        {titleActions}
                        {selectable && (
                            <button
                                onClick={selected.size === songs.length ? clearAll : selectAll}
                                className="text-xs text-sky-500 hover:text-sky-400 font-medium"
                            >
                                {selected.size === songs.length ? 'deselect all' : 'select all'}
                            </button>
                        )}
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">
                            <FaTimes size={14} />
                        </button>
                    </div>
                </div>

                {/* song count + selected count */}
                {selectable && (
                    <div className="px-4 py-1.5 border-b border-gray-100 dark:border-gray-800 shrink-0">
                        <span className="text-xs text-gray-400">
                            {selected.size > 0 ? `${selected.size} of ${songs.length} selected` : `${songs.length} song${songs.length !== 1 ? 's' : ''}`}
                        </span>
                    </div>
                )}

                {/* virtual list */}
                <div
                    ref={containerRef}
                    className="overflow-y-auto flex-1"
                    onPointerMove={onContainerPointerMove}
                    onPointerUp={onContainerPointerUp}
                    onPointerLeave={onContainerPointerUp}
                >
                    {order.length === 0
                        ? <p className="text-sm text-gray-400 text-center py-10">{emptyState}</p>
                        : (
                            <div style={{ height: totalHeight }}>
                                <div style={{ paddingTop: offsetTop }}>
                                    {order.slice(start, end).map((song, relIdx) => {
                                        const absIdx = start + relIdx
                                        const sp = song.properties
                                        const art = sp?.artworkUrl100
                                            ? artworkUrl(sp.artworkUrl100, 200)
                                            : song.artwork_cached
                                                ? songArtworkUrl(song.uuid, true, undefined, 200)
                                                : null
                                        const isSelected = selected.has(song.uuid)
                                        const isDropTarget = dropTarget === absIdx
                                        const missingFields = disabledItems?.[song.uuid]
                                        const isDisabled = missingFields !== undefined

                                        return (
                                            <div
                                                key={song.uuid}
                                                data-picker-id={isDisabled ? undefined : song.uuid}
                                                data-reorder-idx={absIdx}
                                                style={{ height: ROW_H }}
                                                className={`flex items-center gap-3 px-4 border-t-2 transition-colors ${
                                                    isDropTarget ? 'border-sky-500' : 'border-transparent'
                                                } ${isDisabled ? 'opacity-40' : isSelected ? 'bg-sky-50 dark:bg-sky-950/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
                                            >
                                                {/* reorder handle */}
                                                {reorderable && (
                                                    <span
                                                        className="text-gray-300 dark:text-gray-600 cursor-grab active:cursor-grabbing shrink-0 touch-none"
                                                        onPointerDown={(e) => { e.preventDefault(); dragReorderRef.current = absIdx }}
                                                    >
                                                        <FaBars size={11} />
                                                    </span>
                                                )}

                                                {/* checkbox */}
                                                {selectable && (
                                                    <div
                                                        className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center ${
                                                            isDisabled
                                                                ? 'border-gray-200 dark:border-gray-700 cursor-not-allowed'
                                                                : isSelected
                                                                    ? 'bg-sky-500 border-sky-500 cursor-pointer'
                                                                    : 'border-gray-300 dark:border-gray-600 hover:border-sky-400 cursor-pointer'
                                                        }`}
                                                        onPointerDown={isDisabled ? undefined : (e) => { e.preventDefault(); startDrag(song.uuid) }}
                                                        onClick={isDisabled ? undefined : (e) => toggle(song.uuid, e.shiftKey)}
                                                    >
                                                        {isSelected && !isDisabled && <FaCheck size={9} className="text-white" />}
                                                    </div>
                                                )}

                                                {/* artwork */}
                                                {art
                                                    ? <Image src={art} alt="" width={36} height={36} className="rounded shrink-0 object-cover" unoptimized={song.artwork_cached} />
                                                    : <div className="w-9 h-9 rounded shrink-0 bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                                                        <FaMusic size={11} className="text-gray-400" />
                                                    </div>
                                                }

                                                {/* text */}
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium truncate">{sp?.trackName ?? '—'}</p>
                                                    {isDisabled
                                                        ? <p className="text-xs text-amber-500 truncate">missing: {missingFields.join(', ')}</p>
                                                        : <p className="text-xs text-gray-400 truncate">{sp?.artistName ?? '—'}</p>
                                                    }
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )
                    }
                </div>

                {/* footer action */}
                {selectable && actionLabel && onConfirm && (
                    <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 shrink-0 flex justify-end gap-2">
                        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={selected.size === 0 || actionLoading}
                            className="px-4 py-2 text-sm font-medium bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                        >
                            {actionLoading ? 'working…' : `${actionLabel} (${selected.size})`}
                        </button>
                    </div>
                )}
            </div>
        </div>
    )

    return createPortal(body, document.body)
}
