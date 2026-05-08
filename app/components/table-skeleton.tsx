export default function TableSkeleton({ rows = 5, cols = 3 }: { rows?: number; cols?: number }) {
    return (
        <div className="flex flex-col gap-2 animate-pulse">
            {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="flex gap-4">
                    {Array.from({ length: cols }, (_, j) => (
                        <div key={j} className="h-4 bg-gray-200 dark:bg-gray-800 rounded flex-1" />
                    ))}
                </div>
            ))}
        </div>
    )
}
