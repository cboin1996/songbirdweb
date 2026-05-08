'use client'
import { createContext, useCallback, useContext, useRef, useState } from 'react'

interface ToastContextValue {
    showToast: (msg: string, error?: boolean) => void
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} })

export function useToast() {
    return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const showToast = useCallback((msg: string, error?: boolean) => {
        if (timerRef.current) clearTimeout(timerRef.current)
        setToast({ msg, error })
        timerRef.current = setTimeout(() => setToast(null), 2500)
    }, [])

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {toast && (
                <div data-testid={toast.error ? 'toast-error' : 'toast'} className={`fixed bottom-48 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-full text-xs font-medium shadow-lg pointer-events-none whitespace-nowrap ${toast.error ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' : 'bg-gray-100 text-gray-900 dark:bg-gray-900 dark:text-white'}`}>
                    {toast.msg}
                </div>
            )}
        </ToastContext.Provider>
    )
}
