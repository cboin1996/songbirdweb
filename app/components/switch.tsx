'use client'

type SwitchProps = {
    checked: boolean
    onChange: (next: boolean) => void
    /** Names the switch for screen readers; the visible label sits beside it. */
    label: string
    'data-testid'?: string
}

/** An on/off switch: a `role="switch"` button that slides between the two states. */
export function Switch({ checked, onChange, label, 'data-testid': testId }: SwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            data-testid={testId}
            onClick={() => onChange(!checked)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 ${
                checked ? 'bg-sky-500' : 'bg-gray-300 dark:bg-gray-700'
            }`}
        >
            <span
                className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    checked ? 'translate-x-5' : 'translate-x-0.5'
                }`}
            />
        </button>
    )
}
