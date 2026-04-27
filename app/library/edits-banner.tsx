'use client'
import { useState } from 'react'
import { EDIT_EXPIRY_DAYS, LibrarySong } from '../lib/data'
import { FaChevronDown, FaChevronUp } from 'react-icons/fa'

function expiryDate(songCreatedAt: string): Date {
  const d = new Date(songCreatedAt)
  d.setDate(d.getDate() + EDIT_EXPIRY_DAYS)
  return d
}

function daysLeft(songCreatedAt: string): number {
  return Math.ceil((expiryDate(songCreatedAt).getTime() - Date.now()) / 86400000)
}

export default function EditsBanner({ songs }: { songs: LibrarySong[] }) {
  const [expanded, setExpanded] = useState(false)

  const edits = songs.filter(s => s.parent_song_id !== null && s.song_created_at)
  if (edits.length === 0) return null

  const urgentCount = edits.filter(s => daysLeft(s.song_created_at!) <= 7).length

  return (
    <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm text-left"
      >
        <span className="flex items-center gap-2">
          <span className={urgentCount > 0 ? 'text-orange-400 font-medium' : 'text-amber-400 font-medium'}>
            {edits.length} edit{edits.length !== 1 ? 's' : ''} in progress
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
          {edits.map(s => {
            const days = daysLeft(s.song_created_at!)
            const exp = expiryDate(s.song_created_at!)
            const urgent = days <= 7
            return (
              <div key={s.uuid} className="flex items-center justify-between px-3 py-2 gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{s.properties?.trackName ?? s.uuid}</p>
                  <p className="text-xs text-gray-400 truncate">{s.properties?.artistName}</p>
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
