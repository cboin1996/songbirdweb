'use client'
import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { FaDove } from 'react-icons/fa6'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ImportJobResult, ImportJobsPage, listImportJobs, pollImportJob } from '../lib/data'
import { routes } from '../lib/routes'
import SearchInput from './search-input'
import Spinner from './spinner'

const PAGE_SIZE = 20
const POLL_INTERVAL_MS = 3000

export interface ImportJobsTableHandle {
  addJob: (job: ImportJobResult, replaceId?: string) => void
}

export default function ImportJobsTable({
  tableRef,
}: {
  tableRef?: React.RefObject<ImportJobsTableHandle | null>
}) {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set())
  const activeIdsRef = useRef<Set<string>>(new Set())
  const [sessionFinished, setSessionFinished] = useState(0)
  const inFlight = activeIds.size
  const hasInFlight = inFlight > 0

  const { data: pageData, isFetching } = useQuery({
    queryKey: ['import-jobs', page],
    queryFn: () => listImportJobs(PAGE_SIZE, page * PAGE_SIZE),
  })
  const jobs = pageData?.jobs ?? []
  const total = pageData?.total ?? 0
  const counts = pageData?.status_counts ?? {}

  const isPending = (s: string) => s === 'pending' || s === 'processing'

  function trackJob(job: ImportJobResult, replaceId?: string) {
    setActiveIds(prev => {
      const next = new Set(prev)
      let finishedDelta = 0
      if (replaceId) {
        if (next.delete(replaceId) && !isPending(job.status)) finishedDelta = 1
      }
      if (isPending(job.status)) {
        if (prev.size === 0 && next.size === 0) setSessionFinished(0)
        next.add(job.job_id)
      } else if (next.has(job.job_id)) {
        next.delete(job.job_id)
        finishedDelta = 1
      }
      if (finishedDelta) setSessionFinished(d => d + finishedDelta)
      activeIdsRef.current = next
      return next
    })
  }

  useImperativeHandle(tableRef, () => ({
    addJob(job: ImportJobResult, replaceId?: string) {
      trackJob(job, replaceId)
      queryClient.setQueryData<ImportJobsPage>(['import-jobs', page], prev => {
        const prevJobs = prev?.jobs ?? []
        if (replaceId) {
          const idx = prevJobs.findIndex(j => j.job_id === replaceId)
          if (idx !== -1) {
            const next = [...prevJobs]
            next[idx] = job
            return { ...prev!, jobs: next }
          }
        }
        if (prevJobs.some(j => j.job_id === job.job_id)) return prev!
        return { total: (prev?.total ?? 0) + 1, jobs: [job, ...prevJobs], status_counts: prev?.status_counts }
      })
    },
  }))

  useEffect(() => {
    if (!hasInFlight) return
    const tick = async () => {
      const data = await listImportJobs(PAGE_SIZE, 0)
      if (!data) return
      const byId = new Map((data.jobs ?? []).map(j => [j.job_id, j]))
      const missing = [...activeIdsRef.current].filter(id => !byId.has(id))
      if (missing.length > 0) {
        await Promise.all(missing.map(async id => {
          const job = await pollImportJob(id)
          if (job) byId.set(id, job)
        }))
      }
      setActiveIds(prev => {
        let finishedDelta = 0
        const next = new Set(prev)
        for (const id of prev) {
          const updated = byId.get(id)
          if (updated && !isPending(updated.status)) {
            next.delete(id)
            finishedDelta++
          }
        }
        if (finishedDelta) setSessionFinished(d => d + finishedDelta)
        activeIdsRef.current = next
        return next
      })
      queryClient.setQueryData<ImportJobsPage>(['import-jobs', page], prev => {
        if (!prev) return prev
        return {
          ...prev,
          jobs: prev.jobs.map(j => byId.get(j.job_id) ?? j),
          total: data.total ?? prev.total,
          status_counts: data.status_counts ?? prev.status_counts,
        }
      })
    }
    const interval = setInterval(tick, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInFlight, page])

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
        return (
          <span className="inline-flex items-center gap-1.5 text-sky-500">
            <Spinner size={12} />
            importing
          </span>
        )
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
          original added
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gray-400 text-sm font-medium uppercase tracking-wide">Import history</span>
          {(counts.done ?? 0) > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full border bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-900">
              {counts.done} done
            </span>
          )}
          {(counts.duplicate ?? 0) > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full border bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900">
              {counts.duplicate} duplicate
            </span>
          )}
          {(counts.failed ?? 0) > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full border bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-900">
              {counts.failed} failed
            </span>
          )}
        </div>
        <SearchInput
          value={filter}
          onChange={setFilter}
          placeholder="filter by name or status"
          className="w-48"
        />
      </div>

      {hasInFlight && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900 text-sm">
          <FaDove size={16} className="text-sky-500 animate-bounce" />
          <span className="text-sky-600 dark:text-sky-400 font-medium">
            {inFlight} importing
          </span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-500">{sessionFinished} finished</span>
        </div>
      )}

      {jobs.length === 0 && !isFetching && (
        <p className="text-gray-500 text-sm py-2">no file imports yet — drag & drop files above to import</p>
      )}

      {jobs.length > 0 && (
        <div className={`overflow-x-auto ${isFetching ? 'opacity-50' : ''}`}>
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
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0 || isFetching}
            className="px-3 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500"
          >
            prev
          </button>
          <span className="text-gray-400">{page + 1} / {totalPages}</span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1 || isFetching}
            className="px-3 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500"
          >
            next
          </button>
        </div>
      )}
    </div>
  )
}
