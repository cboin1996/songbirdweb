function StatPill() {
    return (
        <div className="flex flex-col gap-1">
            <div className="h-7 w-12 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
            <div className="h-2.5 w-16 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
        </div>
    )
}

function SectionLabel() {
    return <div className="h-2.5 w-20 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
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
        <div className="p-4 flex flex-col gap-10">
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
                    <table className="text-sm w-full">
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

            {/* users */}
            <div className="flex flex-col gap-4">
                <SectionLabel />
                <div className="overflow-x-auto">
                    <table className="text-sm w-full">
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
