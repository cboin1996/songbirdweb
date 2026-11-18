// The small count on a library toolbar icon (filters on, drafts, songs to publish...).
export default function CountBadge({ n, className = 'bg-sky-500', testId }: { n: number; className?: string; testId?: string }) {
    if (n <= 0) return null
    return (
        <span
            data-testid={testId}
            aria-hidden
            className={`absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full text-white text-[10px] leading-4 text-center tabular-nums ${className}`}
        >
            {n > 99 ? '99+' : n}
        </span>
    )
}

// Shared look for the toolbar's icon buttons.
export const iconButtonClass = 'relative flex items-center justify-center w-8 h-8 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
