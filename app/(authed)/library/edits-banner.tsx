'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DraftSummary, deleteEditDraft, fetchDrafts } from '../../lib/data'
import { queryKeys } from '../../lib/query-keys'
import { editSongRoute } from '../../lib/routes'
import { EVENTS } from '../../lib/events'
import { FaPen, FaTimes } from 'react-icons/fa'
import CountBadge, { iconButtonClass } from './count-badge'

const DRAFT_EXPIRY_DAYS = 30

function expiryDate(updatedAt: string): Date {
  const d = new Date(updatedAt)
  d.setDate(d.getDate() + DRAFT_EXPIRY_DAYS)
  return d
}

function daysLeft(updatedAt: string): number {
  return Math.ceil((expiryDate(updatedAt).getTime() - Date.now()) / 86400000)
}

export default function EditsBanner() {
  const queryClient = useQueryClient()
  const { data: drafts = [] } = useQuery({
    queryKey: queryKeys.drafts,
    queryFn: fetchDrafts,
  })
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const router = useRouter()

  useEffect(() => {
    function onDraftChanged() { queryClient.invalidateQueries({ queryKey: queryKeys.drafts }) }
    window.addEventListener(EVENTS.draftChanged, onDraftChanged)
    return () => window.removeEventListener(EVENTS.draftChanged, onDraftChanged)
  }, [queryClient])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Escape closes only this list, not select mode behind it.
      e.stopPropagation()
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  if (drafts.length === 0) return null

  const urgentCount = drafts.filter(d => daysLeft(d.updated_at) <= 7).length

  async function handleDelete(songId: string) {
    await deleteEditDraft(songId)
    queryClient.setQueryData<DraftSummary[]>(queryKeys.drafts, prev =>
      (prev ?? []).filter(d => d.song_id !== songId)
    )
    window.dispatchEvent(new CustomEvent(EVENTS.draftChanged, { detail: { deleted: songId } }))
  }

  function handleOpen(songId: string) {
    setOpen(false)
    router.push(editSongRoute(songId))
  }

  return (
    <div ref={ref} className="md:relative">
      <button
        ref={buttonRef}
        data-testid="edits-in-progress"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={`${drafts.length} edit${drafts.length !== 1 ? 's' : ''} in progress`}
        title={`${drafts.length} edit${drafts.length !== 1 ? 's' : ''} in progress${urgentCount > 0 ? `, ${urgentCount} expiring soon` : ''}`}
        className={`${iconButtonClass} ${urgentCount > 0 ? 'text-orange-400 hover:text-orange-300' : 'text-amber-400 hover:text-amber-300'}`}
      >
        <FaPen size={12} aria-hidden />
        <CountBadge n={drafts.length} className={urgentCount > 0 ? 'bg-orange-500' : 'bg-amber-500'} />
      </button>

      {open && (
        // Mobile: anchored to the icon group (pinned right), so the list stays on screen whatever icons sit beside it.
        <div data-testid="edits-list" className="absolute top-full right-0 md:right-auto md:left-0 mt-1 z-50 w-72 max-w-[calc(100vw-2rem)] bg-surface border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden">
          {drafts.map(d => {
            const days = daysLeft(d.updated_at)
            const exp = expiryDate(d.updated_at)
            const urgent = days <= 7
            return (
              <div key={d.song_id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 group">
                <button
                  onClick={() => handleOpen(d.song_id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <p className="text-sm font-medium truncate">{d.properties?.trackName ?? d.song_id}</p>
                  <p className={`text-xs tabular-nums ${urgent ? 'text-orange-400' : 'text-gray-400'}`}>
                    expires {exp.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    <span className="opacity-70 ml-1">({days > 0 ? `${days}d` : 'today'})</span>
                  </p>
                </button>
                <button
                  onClick={() => handleDelete(d.song_id)}
                  title="discard draft"
                  className="shrink-0 text-gray-300 hover:text-red-400 dark:text-gray-600 dark:hover:text-red-400 transition-colors md:opacity-0 md:group-hover:opacity-100 p-2 -m-1 touch-manipulation"
                >
                  <FaTimes size={11} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
