'use client'

import { useEffect, useState } from "react"
import { AdminStats, EditJobSummary, ErrorLogEntry, fetchAdminEditJobs, fetchAdminErrors } from "../lib/data"

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function fmt(ts: string) {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ')
}

const ERROR_PAGE_SIZE = 50
const JOB_PAGE_SIZE = 20
const TOP_SONGS_PAGE_SIZE = 10

export default function SystemStats({ stats }: { stats: AdminStats | undefined }) {
    const [expandedError, setExpandedError] = useState<string | null>(null)
    const [errorFilter, setErrorFilter] = useState('')
    const [errorPage, setErrorPage] = useState(0)
    const [errorTotal, setErrorTotal] = useState(0)
    const [errors, setErrors] = useState<ErrorLogEntry[]>([])
    const [jobFilter, setJobFilter] = useState('')
    const [jobPage, setJobPage] = useState(0)
    const [jobTotal, setJobTotal] = useState(0)
    const [editJobs, setEditJobs] = useState<EditJobSummary[]>([])
    const [topSongsFilter, setTopSongsFilter] = useState('')
    const [topSongsPage, setTopSongsPage] = useState(0)

    useEffect(() => {
        fetchAdminErrors(ERROR_PAGE_SIZE, 0).then(data => { setErrors(data.errors); setErrorTotal(data.total) })
        fetchAdminEditJobs(JOB_PAGE_SIZE, 0).then(data => { setEditJobs(data.jobs); setJobTotal(data.total) })
    }, [])

    if (!stats) return <p className="text-gray-400 text-sm">failed to load system stats</p>

    const importSuccessCount = stats.import_count - stats.import_failed_count - stats.import_duplicate_count
    const importErrorRate = stats.import_count > 0
        ? Math.round((stats.import_failed_count / stats.import_count) * 100)
        : 0

    const filteredJobs = editJobs.filter(j => {
        const q = jobFilter.toLowerCase()
        if (!q) return true
        return j.status.includes(q) || j.job_id.includes(q) || j.user_id.includes(q) ||
            (j.error ?? '').toLowerCase().includes(q) || fmt(j.created_at).includes(q)
    })
    const jobTotalPages = Math.max(1, Math.ceil(jobTotal / JOB_PAGE_SIZE))

    async function handleJobPageChange(p: number) {
        const data = await fetchAdminEditJobs(JOB_PAGE_SIZE, p * JOB_PAGE_SIZE)
        setEditJobs(data.jobs)
        setJobTotal(data.total)
        setJobPage(p)
    }

    const filteredErrors = errors.filter(e => {
        const q = errorFilter.toLowerCase()
        if (!q) return true
        return e.message.toLowerCase().includes(q) || (e.path ?? '').toLowerCase().includes(q) ||
            (e.method ?? '').toLowerCase().includes(q) || (e.level ?? '').toLowerCase().includes(q) ||
            String(e.status_code ?? '').includes(q) || (e.user_id ?? '').toLowerCase().includes(q) ||
            fmt(e.timestamp).includes(q)
    })
    const totalPages = Math.max(1, Math.ceil(errorTotal / ERROR_PAGE_SIZE))

    async function handleErrorPageChange(p: number) {
        const data = await fetchAdminErrors(ERROR_PAGE_SIZE, p * ERROR_PAGE_SIZE)
        setErrors(data.errors)
        setErrorTotal(data.total)
        setErrorPage(p)
    }

    const filteredTopSongs = (stats.top_songs ?? []).filter(s => {
        const q = topSongsFilter.toLowerCase()
        return !q || (s.title ?? '').toLowerCase().includes(q) || (s.artist ?? '').toLowerCase().includes(q)
    })
    const topSongsTotalPages = Math.ceil(filteredTopSongs.length / TOP_SONGS_PAGE_SIZE)
    const pagedTopSongs = filteredTopSongs.slice(topSongsPage * TOP_SONGS_PAGE_SIZE, (topSongsPage + 1) * TOP_SONGS_PAGE_SIZE)

    return (
        <div className="flex flex-col gap-10">

            {/* ── Overview ── */}
            <section className="flex flex-col gap-4">
                <p className="text-gray-400 text-sm font-medium uppercase tracking-wide">overview</p>
                <div className="flex flex-wrap gap-6">
                    <Stat value={stats.song_count} label="songs" />
                    <Stat value={stats.user_count} label="users" />
                    <Stat value={stats.active_share_tokens} label="active share tokens" />
                </div>
            </section>

            {/* ── Disk ── */}
            <section className="flex flex-col gap-4">
                <p className="text-gray-400 text-sm font-medium uppercase tracking-wide">disk</p>
                <div className="flex flex-wrap gap-6">
                    <Stat value={formatBytes(stats.disk_bytes)} label="used" />
                    <Stat value={formatBytes(stats.disk_free)} label="free" />
                    <Stat value={formatBytes(stats.disk_total)} label="total" />
                </div>
                {stats.disk_total > 0 && (
                    <div className="w-full max-w-sm">
                        <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-sky-500"
                                style={{ width: `${Math.round((stats.disk_bytes / stats.disk_total) * 100)}%` }}
                            />
                        </div>
                        <p className="text-gray-500 text-xs mt-1">
                            {Math.round((stats.disk_bytes / stats.disk_total) * 100)}% used
                        </p>
                    </div>
                )}
            </section>

            {/* ── Imports ── */}
            <section className="flex flex-col gap-4">
                <p className="text-gray-400 text-sm font-medium uppercase tracking-wide">imports</p>
                <div className="flex flex-wrap gap-6">
                    <Stat value={stats.import_count} label="total" />
                    <Stat value={importSuccessCount} label="succeeded" color="text-green-500" />
                    <Stat value={stats.import_failed_count} label="failed" color={stats.import_failed_count > 0 ? 'text-red-500' : undefined} />
                    <Stat value={stats.import_duplicate_count} label="duplicates skipped" color={stats.import_duplicate_count > 0 ? 'text-amber-500' : undefined} />
                    {stats.import_count > 0 && (
                        <Stat value={`${importErrorRate}%`} label="error rate" color={importErrorRate > 0 ? 'text-red-400' : 'text-green-500'} />
                    )}
                </div>
            </section>

            {/* ── Activity (last 7 days) ── */}
            {stats.plays_by_day.length > 0 && (
                <section className="flex flex-col gap-4">
                    <p className="text-gray-400 text-sm font-medium uppercase tracking-wide">activity (last 7 days)</p>
                    <div className="overflow-x-auto">
                        <table className="text-sm w-full max-w-sm">
                            <thead>
                                <tr className="text-gray-400 text-left">
                                    <th className="pr-4 font-normal pb-1">date</th>
                                    <th className="pr-4 font-normal pb-1">plays</th>
                                    <th className="font-normal pb-1">downloads</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.plays_by_day.map(row => (
                                    <tr key={row.date} className="border-t border-gray-800">
                                        <td className="pr-4 py-1 font-mono text-xs">{row.date}</td>
                                        <td className="pr-4 py-1">{row.plays}</td>
                                        <td className="py-1">{row.downloads}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-gray-500 text-xs">import totals are shown in the Imports section above</p>
                </section>
            )}

            {/* ── Top Songs ── */}
            {(stats.top_songs ?? []).length > 0 && (
                <section className="flex flex-col gap-4">
                    <p className="text-gray-400 text-sm font-medium uppercase tracking-wide">top songs</p>
                    <input
                        type="text"
                        placeholder="filter by title, artist…"
                        value={topSongsFilter}
                        onChange={e => { setTopSongsFilter(e.target.value); setTopSongsPage(0) }}
                        className="w-full max-w-sm rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-sky-500 focus:outline-none"
                    />
                    <div className="overflow-x-auto">
                        <table className="text-sm w-full">
                            <thead>
                                <tr className="text-gray-400 text-left">
                                    <th className="pr-4 font-normal pb-1">#</th>
                                    <th className="pr-4 font-normal pb-1">title</th>
                                    <th className="pr-4 font-normal pb-1">artist</th>
                                    <th className="font-normal pb-1">plays</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pagedTopSongs.length === 0 ? (
                                    <tr><td colSpan={4} className="py-2 text-gray-500">no results</td></tr>
                                ) : pagedTopSongs.map((song, i) => (
                                    <tr key={song.song_id} className="border-t border-gray-800">
                                        <td className="pr-4 py-1 text-gray-500">{topSongsPage * TOP_SONGS_PAGE_SIZE + i + 1}</td>
                                        <td className="pr-4 py-1">{song.title}</td>
                                        <td className="pr-4 py-1 text-gray-400">{song.artist}</td>
                                        <td className="py-1">{song.count}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {topSongsTotalPages > 1 && (
                        <div className="flex items-center gap-3 text-sm">
                            <button
                                onClick={() => setTopSongsPage(p => Math.max(0, p - 1))}
                                disabled={topSongsPage === 0}
                                className="px-3 py-1 rounded-md border border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-white"
                            >
                                prev
                            </button>
                            <span className="text-gray-400">{topSongsPage + 1} / {topSongsTotalPages}</span>
                            <button
                                onClick={() => setTopSongsPage(p => Math.min(topSongsTotalPages - 1, p + 1))}
                                disabled={topSongsPage >= topSongsTotalPages - 1}
                                className="px-3 py-1 rounded-md border border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-white"
                            >
                                next
                            </button>
                            <span className="text-gray-500 text-xs">{filteredTopSongs.length} total</span>
                        </div>
                    )}
                </section>
            )}

            {/* ── Edit Jobs ── */}
            <section className="flex flex-col gap-4">
                <p className="text-gray-400 text-sm font-medium uppercase tracking-wide">edit jobs</p>
                <div className="flex flex-wrap gap-6">
                    <Stat value={stats.failed_job_count} label="all-time failed" color={stats.failed_job_count > 0 ? 'text-red-500' : undefined} />
                </div>

                {jobTotal > 0 && (
                    <div className="flex flex-col gap-2">
                        <input
                            type="text"
                            placeholder="filter by status, id, user, error, date…"
                            value={jobFilter}
                            onChange={e => setJobFilter(e.target.value)}
                            className="w-full max-w-sm rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-sky-500 focus:outline-none"
                        />
                        <div className="overflow-x-auto">
                            <table className="text-sm w-full">
                                <thead>
                                    <tr className="text-gray-400 text-left">
                                        <th className="pr-4 font-normal pb-1">job id</th>
                                        <th className="pr-4 font-normal pb-1">created</th>
                                        <th className="pr-4 font-normal pb-1">user</th>
                                        <th className="pr-4 font-normal pb-1">status</th>
                                        <th className="font-normal pb-1">error</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredJobs.length === 0 ? (
                                        <tr><td colSpan={5} className="py-2 text-gray-500">no results</td></tr>
                                    ) : filteredJobs.map(job => (
                                        <tr key={job.job_id} className="border-t border-gray-800">
                                            <td className="pr-4 py-1 font-mono text-xs text-gray-500">{job.job_id.slice(0, 8)}…</td>
                                            <td className="pr-4 py-1 font-mono text-xs">{fmt(job.created_at)}</td>
                                            <td className="pr-4 py-1 font-mono text-xs text-gray-400">{job.user_id.slice(0, 8)}…</td>
                                            <td className="pr-4 py-1">
                                                <span className={
                                                    job.status === 'done' ? 'text-green-500' :
                                                    job.status === 'failed' ? 'text-red-500' :
                                                    job.status === 'processing' ? 'text-sky-500' :
                                                    'text-gray-400'
                                                }>{job.status}</span>
                                            </td>
                                            <td className="py-1 text-red-400 text-xs truncate max-w-xs">{job.error ?? '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {jobTotalPages > 1 && (
                            <div className="flex items-center gap-3 text-sm">
                                <button
                                    onClick={() => handleJobPageChange(Math.max(0, jobPage - 1))}
                                    disabled={jobPage === 0}
                                    className="px-3 py-1 rounded-md border border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-white"
                                >
                                    prev
                                </button>
                                <span className="text-gray-400">{jobPage + 1} / {jobTotalPages}</span>
                                <button
                                    onClick={() => handleJobPageChange(Math.min(jobTotalPages - 1, jobPage + 1))}
                                    disabled={jobPage >= jobTotalPages - 1}
                                    className="px-3 py-1 rounded-md border border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-white"
                                >
                                    next
                                </button>
                                <span className="text-gray-500 text-xs">{jobTotal} total</span>
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* ── Errors ── */}
            {errorTotal > 0 && (
                <section className="flex flex-col gap-4">
                    <p className="text-gray-400 text-sm font-medium uppercase tracking-wide">errors</p>
                    <input
                        type="text"
                        placeholder="filter by message, path, method, status, user, date…"
                        value={errorFilter}
                        onChange={e => setErrorFilter(e.target.value)}
                        className="w-full max-w-sm rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-sky-500 focus:outline-none"
                    />
                    <div className="flex flex-col gap-1">
                        {filteredErrors.length === 0 ? (
                            <p className="text-gray-500 text-sm">no results</p>
                        ) : filteredErrors.map(e => (
                            <div key={e.id} className="rounded-lg border border-gray-800 text-sm">
                                <button
                                    className="w-full flex items-center gap-4 p-2 text-left hover:bg-gray-900 rounded-lg"
                                    onClick={() => setExpandedError(expandedError === e.id ? null : e.id)}
                                >
                                    <span className="font-mono text-xs text-gray-500 shrink-0">{fmt(e.timestamp)}</span>
                                    {e.method && e.path && (
                                        <span className="text-gray-400 text-xs shrink-0">{e.method} {e.path}</span>
                                    )}
                                    {e.status_code != null && (
                                        <span className="text-red-500 text-xs shrink-0">{e.status_code}</span>
                                    )}
                                    <span className="truncate text-xs">{e.message}</span>
                                </button>
                                {expandedError === e.id && (
                                    <div className="border-t border-gray-800 p-2 flex flex-col gap-1">
                                        {e.user_id && (
                                            <p className="text-xs text-gray-400">user: <span className="font-mono">{e.user_id}</span></p>
                                        )}
                                        {e.detail && (
                                            <pre className="text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap break-all">{e.detail}</pre>
                                        )}
                                        {!e.detail && !e.user_id && (
                                            <p className="text-xs text-gray-500">no additional detail</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                    {totalPages > 1 && (
                        <div className="flex items-center gap-3 text-sm">
                            <button
                                onClick={() => handleErrorPageChange(Math.max(0, errorPage - 1))}
                                disabled={errorPage === 0}
                                className="px-3 py-1 rounded-md border border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-white"
                            >
                                prev
                            </button>
                            <span className="text-gray-400">{errorPage + 1} / {totalPages}</span>
                            <button
                                onClick={() => handleErrorPageChange(Math.min(totalPages - 1, errorPage + 1))}
                                disabled={errorPage >= totalPages - 1}
                                className="px-3 py-1 rounded-md border border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-white"
                            >
                                next
                            </button>
                            <span className="text-gray-500 text-xs">{errorTotal} total</span>
                        </div>
                    )}
                </section>
            )}
        </div>
    )
}

function Stat({ value, label, color }: { value: string | number; label: string; color?: string }) {
    return (
        <div className="flex flex-col">
            <span className={`text-2xl font-semibold ${color ?? ''}`}>{value}</span>
            <span className="text-gray-400 text-sm">{label}</span>
        </div>
    )
}
