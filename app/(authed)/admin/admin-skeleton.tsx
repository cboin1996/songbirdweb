import { skeletonClass } from "../../lib/skeleton-timing"
function StatPill() {
    return (
        <div className="flex flex-col gap-1">
            <div className="h-8 w-14 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
            <div className="h-3.5 w-16 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
        </div>
    )
}

function SectionLabel() {
    return <div className="h-3.5 w-24 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
}

function TableRowSkeleton({ cols }: { cols: number }) {
    return (
        <tr className="border-t border-gray-100 dark:border-gray-800">
            {Array.from({ length: cols }).map((_, i) => (
                <td key={i} className="py-2 pr-4">
                    <div className="h-3 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" style={{ width: `${60 + (i * 17) % 40}%` }} />
                </td>
            ))}
        </tr>
    )
}

export default function Loading() {
    return (
        <div className={`${skeletonClass()} p-4 flex flex-col gap-10`}>
            {/* overview */}
            <div className="flex flex-col gap-4">
                <SectionLabel />
                <div className="flex flex-wrap gap-6">
                    {Array.from({ length: 3 }).map((_, i) => <StatPill key={i} />)}
                </div>
            </div>

            {/* disk */}
            <div className="flex flex-col gap-4">
                <SectionLabel />
                <div className="flex flex-wrap gap-6">
                    {Array.from({ length: 3 }).map((_, i) => <StatPill key={i} />)}
                </div>
            </div>

            {/* disk bar */}
            <div className="-mt-6 w-full max-w-sm">
                <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 animate-pulse" />
            </div>

            {/* imports */}
            <div className="flex flex-col gap-4">
                <SectionLabel />
                <div className="flex flex-wrap gap-6">
                    {Array.from({ length: 4 }).map((_, i) => <StatPill key={i} />)}
                </div>
            </div>

            {/* edit jobs */}
            <div className="flex flex-col gap-4">
                <SectionLabel />
                <div className="flex flex-wrap gap-6">
                    {Array.from({ length: 2 }).map((_, i) => <StatPill key={i} />)}
                </div>
                <div className="overflow-x-auto">
                    <table className="text-sm w-full min-w-[560px]">
                        <thead>
                            <tr>
                                {['job id', 'created', 'user', 'status', 'error'].map(h => (
                                    <th key={h} className="pr-4 pb-2 text-left font-normal">
                                        <div className="h-2.5 w-12 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({ length: 5 }).map((_, i) => <TableRowSkeleton key={i} cols={5} />)}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* errors */}
            <div className="flex flex-col gap-4">
                <SectionLabel />
                <div className="h-9 w-full max-w-sm rounded-full bg-gray-100 dark:bg-gray-800 animate-pulse" />
                <div className="flex flex-col gap-2">
                    {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-5 w-full rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />)}
                </div>
            </div>

            {/* users */}
            <div className="flex flex-col gap-4">
                <SectionLabel />
                <div className="h-9 w-full max-w-sm rounded-full bg-gray-100 dark:bg-gray-800 animate-pulse" />
                <div className="overflow-x-auto">
                    <table className="text-sm w-full min-w-[560px]">
                        <thead>
                            <tr>
                                {['user', 'role', 'status', 'library', 'plays', 'downloads', 'last active', 'actions'].map(h => (
                                    <th key={h} className="pr-4 pb-2 text-left font-normal">
                                        <div className="h-2.5 w-12 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({ length: 4 }).map((_, i) => <TableRowSkeleton key={i} cols={8} />)}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
