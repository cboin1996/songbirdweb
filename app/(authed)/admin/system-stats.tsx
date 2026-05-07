'use client'

import { useState } from "react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { fetchAdminStats, fetchAdminEditJobs, fetchAdminErrors, fetchAdminImports } from "../../lib/data"
import { queryKeys } from "../../lib/query-keys"
import { useDebouncedValue } from "../../lib/use-debounce"
import SearchInput from "../../components/search-input"
import QueryError from "../../components/query-error"
import TableSkeleton from "../../components/table-skeleton"

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function fmt(ts: string) {
    return new Date(ts).toISOString().slice(0, 16).replace('T', ' ')
}

const ERROR_PAGE_SIZE = 10
const JOB_PAGE_SIZE = 10
const IMPORT_PAGE_SIZE = 10
const TOP_SONGS_PAGE_SIZE = 10


export default function SystemStats() {
    const { data: stats, error: statsError, refetch: refetchStats, isLoading: statsLoading } = useQuery({
        queryKey: queryKeys.adminStats,
        queryFn: fetchAdminStats,
        retry: false,
    })
    const [expandedError, setExpandedError] = useState<string | null>(null)
    const [errorFilter, setErrorFilter] = useState('')
    const [errorPage, setErrorPage] = useState(0)
    const [jobFilter, setJobFilter] = useState('')
    const [jobPage, setJobPage] = useState(0)
    const [topSongsFilter, setTopSongsFilter] = useState('')
    const [topSongsPage, setTopSongsPage] = useState(0)
    const [importFilter, setImportFilter] = useState('')
    const [importPage, setImportPage] = useState(0)
    const debouncedErrorFilter = useDebouncedValue(errorFilter)
    const debouncedJobFilter = useDebouncedValue(jobFilter)
    const debouncedImportFilter = useDebouncedValue(importFilter)

    const { data: errorData, error: errorsQueryError, refetch: refetchErrors, isLoading: errorsLoading, isFetching: errorsFetching } = useQuery({
        queryKey: ['admin-errors', debouncedErrorFilter, errorPage],
        queryFn: () => fetchAdminErrors(debouncedErrorFilter, ERROR_PAGE_SIZE, errorPage * ERROR_PAGE_SIZE),
        placeholderData: keepPreviousData,
    })
    const errors = errorData?.errors ?? []
    const errorTotal = errorData?.total ?? 0
    const errorSourceCounts = errorData?.source_counts ?? {}

    const { data: jobData, error: jobsQueryError, refetch: refetchJobs, isLoading: jobsLoading, isFetching: jobsFetching } = useQuery({
        queryKey: ['admin-edit-jobs', debouncedJobFilter, jobPage],
        queryFn: () => fetchAdminEditJobs(debouncedJobFilter, JOB_PAGE_SIZE, jobPage * JOB_PAGE_SIZE),
        placeholderData: keepPreviousData,
    })
    const editJobs = jobData?.jobs ?? []
    const jobTotal = jobData?.total ?? 0
    const jobCounts = jobData?.status_counts ?? {}

    const { data: importData, error: importsQueryError, refetch: refetchImports, isLoading: importsLoading, isFetching: importsFetching } = useQuery({
        queryKey: ['admin-imports', debouncedImportFilter, importPage],
        queryFn: () => fetchAdminImports(debouncedImportFilter, IMPORT_PAGE_SIZE, importPage * IMPORT_PAGE_SIZE),
        placeholderData: keepPreviousData,
    })
    const imports = importData?.jobs ?? []
    const importTotal = importData?.total ?? 0
    const importCounts = importData?.status_counts ?? {}

    if (statsLoading) return null

    const importSuccessCount = stats ? stats.import_count - stats.import_failed_count - stats.import_duplicate_count : 0
    const importErrorRate = stats && stats.import_count > 0
        ? Math.round((stats.import_failed_count / stats.import_count) * 100)
        : 0

    const jobTotalPages = Math.max(1, Math.ceil(jobTotal / JOB_PAGE_SIZE))
    const totalPages = Math.max(1, Math.ceil(errorTotal / ERROR_PAGE_SIZE))

    const importTotalPages = Math.max(1, Math.ceil(importTotal / IMPORT_PAGE_SIZE))

    function handleJobFilterChange(v: string) { setJobFilter(v); setJobPage(0) }
    function handleErrorFilterChange(v: string) { setErrorFilter(v); setErrorPage(0) }
    function handleImportFilterChange(v: string) { setImportFilter(v); setImportPage(0) }

    const filteredTopSongs = (stats?.top_songs ?? []).filter(s => {
        const q = topSongsFilter.toLowerCase()
        return !q || (s.title ?? '').toLowerCase().includes(q) || (s.artist ?? '').toLowerCase().includes(q)
    })
    const topSongsTotalPages = Math.ceil(filteredTopSongs.length / TOP_SONGS_PAGE_SIZE)
    const pagedTopSongs = filteredTopSongs.slice(topSongsPage * TOP_SONGS_PAGE_SIZE, (topSongsPage + 1) * TOP_SONGS_PAGE_SIZE)

    return (
        <div className="flex flex-col gap-10">

            {statsError && <QueryError error={statsError} retry={refetchStats} context="system stats" />}

            {stats && <>
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
                        <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
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
                                    <tr key={row.date} className="border-t border-gray-200 dark:border-gray-800">
                                        <td className="pr-4 py-1 font-mono text-xs">{row.date}</td>
                                        <td className="pr-4 py-1">{row.plays}</td>
                                        <td className="py-1">{row.downloads}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* ── Top Songs ── */}
            {(stats.top_songs ?? []).length > 0 && (
                <section className="flex flex-col gap-4">
                    <p className="text-gray-400 text-sm font-medium uppercase tracking-wide">top songs</p>
                    <SearchInput
                        value={topSongsFilter}
                        onChange={v => { setTopSongsFilter(v); setTopSongsPage(0) }}
                        placeholder="filter by title, artist…"
                        className="w-full max-w-sm"
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
                                    <tr key={song.song_id} className="border-t border-gray-200 dark:border-gray-800">
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
                                className="px-3 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-gray-900 dark:hover:text-white"
                            >
                                prev
                            </button>
                            <span className="text-gray-400">{topSongsPage + 1} / {topSongsTotalPages}</span>
                            <button
                                onClick={() => setTopSongsPage(p => Math.min(topSongsTotalPages - 1, p + 1))}
                                disabled={topSongsPage >= topSongsTotalPages - 1}
                                className="px-3 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-gray-900 dark:hover:text-white"
                            >
                                next
                            </button>
                            <span className="text-gray-500 text-xs">{filteredTopSongs.length} total</span>
                        </div>
                    )}
                </section>
            )}

            </>}

            {/* ── Imports ── */}
            <section className="flex flex-col gap-4">
                <p className="text-gray-400 text-sm font-medium uppercase tracking-wide">imports</p>
                {stats && (
                    <div className="flex flex-wrap gap-6">
                        <Stat value={stats.import_count} label="total" />
                        <Stat value={importSuccessCount} label="succeeded" color="text-green-500" />
                        <Stat value={stats.import_failed_count} label="failed" color={stats.import_failed_count > 0 ? 'text-red-500' : undefined} />
                        <Stat value={stats.import_duplicate_count} label="duplicates" color={stats.import_duplicate_count > 0 ? 'text-amber-500' : undefined} />
                        {stats.import_count > 0 && (
                            <Stat value={`${importErrorRate}%`} label="error rate" color={importErrorRate > 0 ? 'text-red-400' : 'text-green-500'} />
                        )}
                    </div>
                )}
                {importsLoading ? <TableSkeleton rows={5} cols={5} /> : (
                    <div className={`flex flex-col gap-2 transition-opacity ${importsFetching ? 'opacity-50' : ''}`}>
                        {importsQueryError && <QueryError error={importsQueryError} retry={refetchImports} context="imports" />}
                        <div className="flex flex-wrap items-center gap-2">
                            <SearchInput
                                value={importFilter}
                                onChange={handleImportFilterChange}
                                placeholder="filter by name, user, status, filename…"
                                className="w-full max-w-sm"
                            />
                            {(importCounts.done ?? 0) > 0 && (
                                <span className="text-xs px-2 py-0.5 rounded-full border bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-900">
                                    {importCounts.done} done
                                </span>
                            )}
                            {(importCounts.duplicate ?? 0) > 0 && (
                                <span className="text-xs px-2 py-0.5 rounded-full border bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900">
                                    {importCounts.duplicate} duplicate
                                </span>
                            )}
                            {(importCounts.failed ?? 0) > 0 && (
                                <span className="text-xs px-2 py-0.5 rounded-full border bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-900">
                                    {importCounts.failed} failed
                                </span>
                            )}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="text-sm w-full">
                                <thead>
                                    <tr className="text-gray-400 text-left">
                                        <th className="pr-4 font-normal pb-1">date</th>
                                        <th className="pr-4 font-normal pb-1">user</th>
                                        <th className="pr-4 font-normal pb-1">song</th>
                                        <th className="pr-4 font-normal pb-1">status</th>
                                        <th className="font-normal pb-1">info</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {imports.length === 0 ? (
                                        <tr><td colSpan={5} className="py-2 text-gray-500">no results</td></tr>
                                    ) : imports.map(job => (
                                        <tr key={job.job_id} className="border-t border-gray-200 dark:border-gray-800">
                                            <td className="pr-4 py-1 font-mono text-xs text-gray-500">
                                                {job.created_at ? fmt(job.created_at) : '—'}
                                            </td>
                                            <td className="pr-4 py-1 text-xs text-gray-400">{job.username}</td>
                                            <td className="pr-4 py-1 max-w-xs">
                                                <div className="truncate">{job.track_name ?? <span className="text-gray-400">—</span>}</div>
                                                {job.filename && <div className="truncate text-xs text-gray-400">{job.filename}</div>}
                                            </td>
                                            <td className="pr-4 py-1">
                                                <span className={
                                                    job.status === 'done' ? 'text-green-500' :
                                                    job.status === 'failed' ? 'text-red-500' :
                                                    job.status === 'duplicate' ? 'text-amber-500' :
                                                    job.status === 'processing' ? 'text-sky-500' :
                                                    'text-gray-400'
                                                }>{job.status}</span>
                                            </td>
                                            <td className="py-1 text-xs text-gray-400 truncate max-w-xs">
                                                {job.status === 'failed' && job.error ? <span className="text-red-400">{job.error}</span> : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {importTotalPages > 1 && (
                            <div className="flex items-center gap-3 text-sm">
                                <button
                                    onClick={() => setImportPage(Math.max(0, importPage - 1))}
                                    disabled={importPage === 0}
                                    className="px-3 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-gray-900 dark:hover:text-white"
                                >
                                    prev
                                </button>
                                <span className="text-gray-400">{importPage + 1} / {importTotalPages}</span>
                                <button
                                    onClick={() => setImportPage(Math.min(importTotalPages - 1, importPage + 1))}
                                    disabled={importPage >= importTotalPages - 1}
                                    className="px-3 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-gray-900 dark:hover:text-white"
                                >
                                    next
                                </button>
                                <span className="text-gray-500 text-xs">{importTotal} total</span>
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* ── Edit Jobs ── */}
            <section className="flex flex-col gap-4">
                <p className="text-gray-400 text-sm font-medium uppercase tracking-wide">edit jobs</p>
                {stats && (
                    <div className="flex flex-wrap gap-6">
                        <Stat value={stats.edit_job_count} label="total" />
                        <Stat value={stats.failed_job_count} label="failed" color={stats.failed_job_count > 0 ? 'text-red-500' : undefined} />
                    </div>
                )}

                {jobsLoading ? <TableSkeleton rows={5} cols={5} /> : (
                    <div className={`flex flex-col gap-2 transition-opacity ${jobsFetching ? 'opacity-50' : ''}`}>
                        {jobsQueryError && <QueryError error={jobsQueryError} retry={refetchJobs} context="edit jobs" />}
                        <div className="flex flex-wrap items-center gap-2">
                            <SearchInput
                                value={jobFilter}
                                onChange={handleJobFilterChange}
                                placeholder="filter by status, id, user, error, date…"
                                className="w-full max-w-sm"
                            />
                            {Object.entries(jobCounts).map(([status, count]) => (
                                <span key={status} className={`text-xs px-2 py-0.5 rounded-full border ${
                                    status === 'done' ? 'bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 border-green-200 dark:border-green-900' :
                                    status === 'failed' ? 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-900' :
                                    status === 'processing' ? 'bg-sky-50 dark:bg-sky-950/30 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-900' :
                                    'bg-gray-50 dark:bg-gray-950/30 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-900'
                                }`}>
                                    {count} {status}
                                </span>
                            ))}
                        </div>
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
                                    {editJobs.length === 0 ? (
                                        <tr><td colSpan={5} className="py-2 text-gray-500">no results</td></tr>
                                    ) : editJobs.map(job => (
                                        <tr key={job.job_id} className="border-t border-gray-200 dark:border-gray-800">
                                            <td className="pr-4 py-1 font-mono text-xs text-gray-500">{job.job_id}</td>
                                            <td className="pr-4 py-1 font-mono text-xs">{fmt(job.created_at)}</td>
                                            <td className="pr-4 py-1 font-mono text-xs text-gray-400">{job.user_id}</td>
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
                                    onClick={() => setJobPage(Math.max(0, jobPage - 1))}
                                    disabled={jobPage === 0}
                                    className="px-3 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-gray-900 dark:hover:text-white"
                                >
                                    prev
                                </button>
                                <span className="text-gray-400">{jobPage + 1} / {jobTotalPages}</span>
                                <button
                                    onClick={() => setJobPage(Math.min(jobTotalPages - 1, jobPage + 1))}
                                    disabled={jobPage >= jobTotalPages - 1}
                                    className="px-3 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-gray-900 dark:hover:text-white"
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
            <section className="flex flex-col gap-4">
                <p className="text-gray-400 text-sm font-medium uppercase tracking-wide">errors</p>
                {stats && (
                    <div className="flex flex-wrap gap-6">
                        <Stat value={stats.error_log_count + stats.failed_job_count} label="total" color={(stats.error_log_count + stats.failed_job_count) > 0 ? 'text-red-500' : undefined} />
                        <Stat value={stats.error_log_count} label="error logs" />
                        <Stat value={stats.failed_job_count} label="failed edit jobs" />
                    </div>
                )}
                {errorsLoading ? <TableSkeleton rows={5} cols={3} /> : (
                    <div className={`flex flex-col gap-2 transition-opacity ${errorsFetching ? 'opacity-50' : ''}`}>
                        {errorsQueryError && <QueryError error={errorsQueryError} retry={refetchErrors} context="errors" />}
                        <div className="flex flex-wrap items-center gap-2">
                            <SearchInput
                                value={errorFilter}
                                onChange={handleErrorFilterChange}
                                placeholder="filter by message, path, method, status, user, date…"
                                className="w-full max-w-sm"
                            />
                            {(errorSourceCounts.error_log ?? 0) > 0 && (
                                <span className="text-xs px-2 py-0.5 rounded-full border bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-900">
                                    {errorSourceCounts.error_log} error logs
                                </span>
                            )}
                            {(errorSourceCounts.failed_edit_job ?? 0) > 0 && (
                                <span className="text-xs px-2 py-0.5 rounded-full border bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900">
                                    {errorSourceCounts.failed_edit_job} failed edit jobs
                                </span>
                            )}
                        </div>
                        <div className="flex flex-col gap-1">
                            {errors.length === 0 ? (
                                <p className="text-gray-500 text-sm">no results</p>
                            ) : errors.map(e => (
                                <div key={e.id} className="rounded-lg border border-gray-200 dark:border-gray-800 text-sm">
                                    <button
                                        className="w-full flex items-center gap-4 p-2 text-left hover:bg-gray-100 dark:hover:bg-gray-900 rounded-lg"
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
                                        <div className="border-t border-gray-200 dark:border-gray-800 p-2 flex flex-col gap-1">
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
                                    onClick={() => setErrorPage(Math.max(0, errorPage - 1))}
                                    disabled={errorPage === 0}
                                    className="px-3 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-gray-900 dark:hover:text-white"
                                >
                                    prev
                                </button>
                                <span className="text-gray-400">{errorPage + 1} / {totalPages}</span>
                                <button
                                    onClick={() => setErrorPage(Math.min(totalPages - 1, errorPage + 1))}
                                    disabled={errorPage >= totalPages - 1}
                                    className="px-3 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-gray-400 disabled:opacity-30 hover:border-sky-500 hover:text-gray-900 dark:hover:text-white"
                                >
                                    next
                                </button>
                                <span className="text-gray-500 text-xs">{errorTotal} total</span>
                            </div>
                        )}
                    </div>
                )}
            </section>
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
