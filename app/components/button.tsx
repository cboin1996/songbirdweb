export default function Button({ text, onClick, disabled, variant = 'secondary', type = 'button' }: {
    text?: string
    onClick?: React.MouseEventHandler<HTMLButtonElement>
    disabled?: boolean
    variant?: 'primary' | 'secondary' | 'danger'
    type?: 'button' | 'submit' | 'reset'
}) {
    const styles = {
        primary: 'bg-sky-500 text-white hover:bg-sky-600',
        secondary: 'border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:text-sky-500 hover:border-sky-500',
        danger: 'bg-red-500 text-white hover:bg-red-600',
    }
    return (
        <button
            type={type}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]}`}
            disabled={disabled}
            onClick={onClick}
        >
            {text}
        </button>
    )
}
