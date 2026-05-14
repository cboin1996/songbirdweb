'use client'
import { useRef } from 'react'
import { FaSearch, FaTimes } from 'react-icons/fa'

interface SearchInputProps {
    value: string
    onChange(value: string): void
    placeholder?: string
    className?: string
    testId?: string
}

export default function SearchInput({ value, onChange, placeholder = 'search…', className = '', testId }: SearchInputProps) {
    const inputRef = useRef<HTMLInputElement>(null)

    return (
        <div className={`relative flex items-center ${className}`}>
            <FaSearch size={11} className="absolute left-3 text-gray-400 pointer-events-none" />
            <input
                ref={inputRef}
                data-testid={testId}
                type="text"
                value={value}
                onChange={e => onChange(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape' && value) { onChange(''); e.preventDefault() } }}
                placeholder={placeholder}
                className="w-full pl-8 pr-8 py-1.5 rounded-lg text-base md:text-sm bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-200 placeholder-gray-400 outline-none focus:ring-2 focus:ring-sky-500"
            />
            {value && (
                <button
                    type="button"
                    data-testid={testId ? `${testId}-clear` : undefined}
                    onClick={() => { onChange(''); inputRef.current?.focus() }}
                    className="absolute right-0 p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors touch-manipulation"
                    aria-label="Clear search"
                >
                    <FaTimes size={11} />
                </button>
            )}
        </div>
    )
}
