'use client'

import { useState } from "react"
import { AdminStats, ErrorLogEntry } from "../lib/data"

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function SystemStats({ stats, errors }: { stats: AdminStats | undefined; errors: ErrorLogEntry[] }) {
    const [expandedError, setExpandedError] = useState<string | null>(null)

    if (!stats) return <p className="text-gray-400 text-sm">failed to load system stats</p>

    const doneJobs = stats.recent_jobs.filter(j => j.status === 'done').length
    const totalJobs = stats.recent_jobs.length
    const successRate = totalJobs > 0 ? Math.round((doneJobs / totalJobs) * 100) : null

    return (
        <div className="flex flex-col gap-8">
            <p className="text-gray-400 text-sm">system</p>

            <div className="flex flex-wrap gap-6">
                <div className="flex flex-col">
                    <span className="text-2xl font-semibold">{stats.song_count}</span>
                    <span className="text-gray-400 text-sm">songs</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-2xl font-semibold">{stats.user_count}</span>
                    <span className="text-gray-400 text-sm">users</span>
                </div>
                <div className="flex flex-col">
                    <span className="text-2xl font-semibold">{stats.active_share_tokens}</span>
                    <span className="text-gray-400 text-sm">active share tokens</span>
                </div>
            </div>

            <div>
                <p className="text-gray-400 text-sm pb-2">disk</p>
                <div className="flex flex-wrap gap-6">
                    <div className="flex flex-col">
                        <span className="text-2xl font-semibold">{formatBytes(stats.disk_bytes)}</span>
                        <span className="text-gray-400 text-sm">used</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-2xl font-semibold">{formatBytes(stats.disk_free)}</span>
                        <span className="text-gray-400 text-sm">free</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-2xl font-semibold">{formatBytes(stats.disk_total)}</span>
                        <span className="text-gray-400 text-sm">total</span>
                    </div>
                </div>
            </div>

            {totalJobs > 0 && (
                <div>
                    <p className="text-gray-400 text-sm pb-2">edit job success rate (last 10)</p>
                    <div className="flex gap-6">
                        <div className="flex flex-col">
                            <span className="text-2xl font-semibold">{successRate}%</span>
                            <span className="text-gray-400 text-sm">{doneJobs}/{totalJobs} done</span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-2xl font-semibold text-red-500">{stats.failed_job_count}</span>
                            <span className="text-gray-400 text-sm">all-time failed</span>
                        </div>
                    </div>
                </div>
            )}

            {stats.plays_by_day.length > 0 && (
                <div>
                    <p className="text-gray-400 text-sm pb-2">activity (last 7 days)</p>
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
            )}

            {stats.top_songs.length > 0 && (
                <div>
                    <p className="text-gray-400 text-sm pb-2">top 5 songs by plays</p>
                    <ol className="flex flex-col gap-1">
                        {stats.top_songs.map((s, i) => (
                            <li key={s.song_id} className="flex items-center gap-3 text-sm">
                                <span className="text-gray-500 w-4">{i + 1}.</span>
                                <span className="flex-1 truncate">
                                    {s.title ?? <span className="text-gray-500 font-mono text-xs">{s.song_id.slice(0, 8)}…</span>}
                                    {s.artist && <span className="text-gray-400"> — {s.artist}</span>}
                                </span>
                                <span className="text-gray-400 text-xs">{s.count} plays</span>
                            </li>
                        ))}
                    </ol>
                </div>
            )}

            {stats.per_user.length > 0 && (
                <div>
                    <p className="text-gray-400 text-sm pb-2">per user</p>
                    <div className="overflow-x-auto">
                        <table className="text-sm w-full">
                            <thead>
                                <tr className="text-gray-400 text-left">
                                    <th className="pr-4 font-normal pb-1">user</th>
                                    <th className="pr-4 font-normal pb-1">library</th>
                                    <th className="pr-4 font-normal pb-1">plays</th>
                                    <th className="pr-4 font-normal pb-1">downloads</th>
                                    <th className="font-normal pb-1">last active</th>
                                </tr>
                            </thead>
                            <tbody>
                                {stats.per_user.map(u => (
                                    <tr key={u.user_id} className="border-t border-gray-800">
                                        <td className="pr-4 py-1">{u.username}</td>
                                        <td className="pr-4 py-1">{u.song_count}</td>
                                        <td className="pr-4 py-1">{u.play_count}</td>
                                        <td className="pr-4 py-1">{u.download_count}</td>
                                        <td className="py-1 text-gray-400 text-xs">
                                            {u.last_active ? new Date(u.last_active).toLocaleDateString() : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {stats.recent_jobs.length > 0 && (
                <div>
                    <p className="text-gray-400 text-sm pb-2">recent edit jobs</p>
                    <div className="flex flex-col gap-1">
                        {stats.recent_jobs.map(job => (
                            <div key={job.job_id} className="flex flex-row items-center justify-between gap-4 rounded-md p-2 hover:bg-gray-100 dark:hover:bg-gray-900 text-sm">
                                <div className="flex flex-col">
                                    <span className="font-mono text-xs text-gray-500">{job.job_id.slice(0, 8)}…</span>
                                    <span className="text-gray-400 text-xs">{new Date(job.created_at).toLocaleString()}</span>
                                </div>
                                <span className={`px-2 py-0.5 rounded text-xs ${
                                    job.status === 'done' ? 'text-green-600' :
                                    job.status === 'failed' ? 'text-red-500' :
                                    job.status === 'processing' ? 'text-sky-500' :
                                    'text-gray-400'
                                }`}>
                                    {job.status}
                                </span>
                                {job.error && <span className="text-red-400 text-xs truncate max-w-xs">{job.error}</span>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {errors.length > 0 && (
                <div>
                    <p className="text-gray-400 text-sm pb-2">recent errors</p>
                    <div className="flex flex-col gap-1">
                        {errors.map(e => (
                            <div key={e.id} className="rounded-md border border-gray-800 text-sm">
                                <button
                                    className="w-full flex items-center gap-4 p-2 text-left hover:bg-gray-900"
                                    onClick={() => setExpandedError(expandedError === e.id ? null : e.id)}
                                >
                                    <span className="font-mono text-xs text-gray-500 shrink-0">{new Date(e.timestamp).toLocaleString()}</span>
                                    {e.method && e.path && (
                                        <span className="text-gray-400 text-xs shrink-0">{e.method} {e.path}</span>
                                    )}
                                    {e.status_code && (
                                        <span className="text-red-500 text-xs shrink-0">{e.status_code}</span>
                                    )}
                                    <span className="truncate text-xs">{e.message}</span>
                                </button>
                                {expandedError === e.id && e.detail && (
                                    <pre className="p-2 text-xs text-gray-400 overflow-x-auto border-t border-gray-800 whitespace-pre-wrap break-all">
                                        {e.detail}
                                    </pre>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
