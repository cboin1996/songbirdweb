'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DraftSummary, deleteEditDraft, fetchDrafts } from '../lib/data'
import { FaChevronDown, FaTimes } from 'react-icons/fa'

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
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    fetchDrafts().then(setDrafts)
    function onDraftChanged() { fetchDrafts().then(setDrafts) }
    window.addEventListener('songbird:draft-changed', onDraftChanged)
    return () => window.removeEventListener('songbird:draft-changed', onDraftChanged)
  }, [])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (drafts.length === 0) return null

  const urgentCount = drafts.filter(d => daysLeft(d.updated_at) <= 7).length

  async function handleDelete(songId: string) {
    await deleteEditDraft(songId)
    setDrafts(prev => prev.filter(d => d.song_id !== songId))
  }

  function handleOpen(songId: string) {
    setOpen(false)
    router.push(`/songs/${songId}/edit`)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors border ${
          urgentCount > 0
            ? 'text-orange-400 border-orange-500/40 hover:border-orange-400'
            : 'text-amber-400 border-amber-500/40 hover:border-amber-400'
        }`}
      >
        {drafts.length} in progress
        {urgentCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />}
        <FaChevronDown size={9} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden">
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
                  className="shrink-0 text-gray-300 hover:text-red-400 dark:text-gray-600 dark:hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
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
