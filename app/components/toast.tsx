'use client'
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { FaCopy, FaCheck } from 'react-icons/fa'

interface ToastContextValue {
    showToast: (msg: string, error?: boolean, detail?: string) => void
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} })

export function useToast() {
    return useContext(ToastContext)
}

function copyText(text: string): Promise<void> {
    try {
        return navigator.clipboard.writeText(text)
    } catch {
        const el = document.createElement('input')
        el.value = text
        el.style.position = 'fixed'
        el.style.opacity = '0'
        document.body.appendChild(el)
        el.select()
        document.execCommand('copy')
        document.body.removeChild(el)
        return Promise.resolve()
    }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toast, setToast] = useState<{ msg: string; error?: boolean; detail?: string } | null>(null)
    const [copied, setCopied] = useState(false)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const showToast = useCallback((msg: string, error?: boolean, detail?: string) => {
        if (timerRef.current) clearTimeout(timerRef.current)
        setCopied(false)
        setToast({ msg, error, detail })
        if (error) console.error(detail ?? msg)
        timerRef.current = setTimeout(() => setToast(null), error ? 6000 : 2500)
    }, [])

    const dismiss = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current)
        setToast(null)
    }, [])

    const handleCopy = useCallback(async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!toast) return
        await copyText(toast.detail ?? toast.msg)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }, [toast])

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {toast && (
                <div onClick={dismiss} data-testid={toast.error ? 'toast-error' : 'toast'} className={`fixed bottom-48 left-1/2 -translate-x-1/2 z-[80] px-4 py-2 rounded-full text-xs font-medium shadow-lg cursor-pointer max-w-[90vw] flex items-center gap-2 ${toast.error ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' : 'bg-gray-100 text-gray-900 dark:bg-gray-900 dark:text-white'}`}>
                    <span className="truncate">{toast.msg}</span>
                    {toast.error && (
                        <button onClick={handleCopy} className="shrink-0 p-2 -m-1 hover:opacity-70 transition-opacity touch-manipulation" title="copy error">
                            {copied ? <FaCheck size={10} /> : <FaCopy size={10} />}
                        </button>
                    )}
                </div>
            )}
        </ToastContext.Provider>
    )
}
