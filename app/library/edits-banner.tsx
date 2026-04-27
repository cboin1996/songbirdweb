'use client'
import { useEffect, useState } from 'react'
import { DraftSummary, fetchDrafts } from '../lib/data'
import { FaChevronDown, FaChevronUp } from 'react-icons/fa'

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
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    fetchDrafts().then(setDrafts)
  }, [])

  if (drafts.length === 0) return null

  const urgentCount = drafts.filter(d => daysLeft(d.updated_at) <= 7).length

  return (
    <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm text-left"
      >
        <span className="flex items-center gap-2">
          <span className={urgentCount > 0 ? 'text-orange-400 font-medium' : 'text-amber-400 font-medium'}>
            {drafts.length} edit{drafts.length !== 1 ? 's' : ''} in progress
          </span>
          {urgentCount > 0 && (
            <span className="text-xs bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded-full">
              {urgentCount} expiring soon
            </span>
          )}
        </span>
        {expanded ? <FaChevronUp size={10} className="text-gray-400" /> : <FaChevronDown size={10} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="border-t border-amber-500/20 divide-y divide-amber-500/10">
          {drafts.map(d => {
            const days = daysLeft(d.updated_at)
            const exp = expiryDate(d.updated_at)
            const urgent = days <= 7
            return (
              <div key={d.song_id} className="flex items-center justify-between px-3 py-2 gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{d.properties?.trackName ?? d.song_id}</p>
                  <p className="text-xs text-gray-400 truncate">{d.properties?.artistName}</p>
                </div>
                <div className={`text-xs shrink-0 tabular-nums ${urgent ? 'text-orange-400' : 'text-gray-400'}`}>
                  expires {exp.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  <span className="ml-1 opacity-70">({days > 0 ? `${days}d` : 'today'})</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
