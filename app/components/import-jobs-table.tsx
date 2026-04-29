'use client'
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ImportJobResult, listImportJobs, pollImportJob } from '../lib/data'
import { routes } from '../lib/routes'
import SearchInput from './search-input'

const PAGE_SIZE = 20
const POLL_INTERVAL_MS = 3000

export interface ImportJobsTableHandle {
  addJob: (job: ImportJobResult, replaceId?: string) => void
}

export default function ImportJobsTable({
  initialJobs,
  total: initialTotal,
  tableRef,
}: {
  initialJobs: ImportJobResult[]
  total: number
  tableRef?: React.RefObject<ImportJobsTableHandle | null>
}) {
  const [jobs, setJobs] = useState<ImportJobResult[]>(initialJobs)
  const [total, setTotal] = useState(initialTotal)
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const intervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())

  useEffect(() => {
    setJobs(initialJobs)
    setTotal(initialTotal)
  }, [initialJobs, initialTotal])

  useImperativeHandle(tableRef, () => ({
    addJob(job: ImportJobResult, replaceId?: string) {
      if (replaceId) {
        const stale = intervalsRef.current.get(replaceId)
        if (stale) { clearInterval(stale); intervalsRef.current.delete(replaceId) }
      }
      setJobs(prev => {
        if (replaceId) {
          const idx = prev.findIndex(j => j.job_id === replaceId)
          if (idx !== -1) {
            const next = [...prev]
            next[idx] = job
            return next
          }
        }
        if (prev.some(j => j.job_id === job.job_id)) return prev
        return [job, ...prev]
      })
    },
  }))

  function startPolling(jobId: string) {
    if (intervalsRef.current.has(jobId)) return
    const interval = setInterval(async () => {
      const result = await pollImportJob(jobId)
      if (!result) return
      setJobs(prev => prev.map(j => j.job_id === jobId ? { ...j, ...result } : j))
      if (result.status !== 'pending' && result.status !== 'processing') {
        clearInterval(interval)
        intervalsRef.current.delete(jobId)
      }
    }, POLL_INTERVAL_MS)
    intervalsRef.current.set(jobId, interval)
  }

  useEffect(() => {
    for (const job of jobs) {
      if (job.status === 'pending' || job.status === 'processing') {
        startPolling(job.job_id)
      }
    }
  }, [jobs])

  useEffect(() => {
    return () => {
      for (const interval of intervalsRef.current.values()) clearInterval(interval)
    }
  }, [])

  async function goToPage(p: number) {
    setLoading(true)
    const data = await listImportJobs(PAGE_SIZE, p * PAGE_SIZE)
    setJobs(data.jobs)
    setTotal(data.total)
    setPage(p)
    setLoading(false)
  }

  const filtered = useMemo(() => {
    if (!filter.trim()) return jobs
    const q = filter.trim().toLowerCase()
    return jobs.filter(j =>
      (j.track_name ?? '').toLowerCase().includes(q) ||
      (j.filename ?? '').toLowerCase().includes(q) ||
      j.status.toLowerCase().includes(q)
    )
  }, [jobs, filter])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function statusBadge(job: ImportJobResult) {
    switch (job.status) {
      case 'done':
        return <span className="text-green-500">done</span>
      case 'failed':
        return <span className="text-red-500">failed</span>
      case 'duplicate':
        return <span className="text-amber-500">duplicate</span>
      case 'processing':
        return <span className="text-sky-500 animate-pulse">importing…</span>
      default:
        return <span className="text-gray-400">queued</span>
    }
  }

  function infoCell(job: ImportJobResult) {
    if (job.status === 'failed' && job.error)
      return <span className="text-red-400 text-xs">{job.error}</span>
    if (job.status === 'duplicate' && job.duplicate_of)
      return (
        <Link href={`${routes.library}?song=${job.duplicate_of}`} className="text-amber-500 text-xs hover:underline">
          view existing
        </Link>
      )
    if (job.status === 'done' && job.song_id)
      return (
        <Link href={`${routes.library}?song=${job.song_id}`} className="text-sky-500 text-xs hover:underline">
          view in library
        </Link>
      )
    return null
  }

  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-gray-400 text-sm font-medium uppercase tracking-wide">Import history</span>
        <SearchInput
          value={filter}
          onChange={setFilter}
          placeholder="filter by name or status"
          className="w-48"
        />
      </div>

      {jobs.length === 0 && (
        <p className="text-gray-500 text-sm py-2">no file imports yet — drag & drop files above to import</p>
      )}

      {jobs.length > 0 && (
        <div className={`overflow-x-auto ${loading ? 'opacity-50' : ''}`}>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="pb-2 pr-4 font-medium">date</th>
                <th className="pb-2 pr-4 font-medium">song</th>
                <th className="pb-2 pr-4 font-medium">status</th>
                <th className="pb-2 font-medium">info</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(job => (
                <tr key={job.job_id} className="border-b border-gray-100 dark:border-gray-800">
                  <td className="py-2 pr-4 text-gray-400 whitespace-nowrap text-xs">
                    {job.created_at ? new Date(job.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td className="py-2 pr-4 max-w-xs">
                    <div className="truncate">{job.track_name ?? <span className="text-gray-400">importing…</span>}</div>
                    {job.filename && <div className="truncate text-xs text-gray-400">{job.filename}</div>}
                  </td>
                  <td className="py-2 pr-4">{statusBadge(job)}</td>
                  <td className="py-2">{infoCell(job)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center gap-2 self-end text-sm">
          <button
            onClick={() => goToPage(Math.max(0, page - 1))}
            disabled={page === 0 || loading}
            className="px-3 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500"
          >
            prev
          </button>
          <span className="text-gray-400">{page + 1} / {totalPages}</span>
          <button
            onClick={() => goToPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1 || loading}
            className="px-3 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500"
          >
            next
          </button>
        </div>
      )}
    </div>
  )
}
