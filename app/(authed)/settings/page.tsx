'use client'
import { useEffect, useRef, useState } from "react";
import { changePassword, fetchLibrarySongs } from "../../lib/data";
import { clearOfflineCache, getCachedSongIds, getStorageEstimate, formatBytes, getSongFile, uncacheSong, cacheSong } from "../../lib/offline";
import { clearServerOfflineSongs } from "../../lib/data";
import { EVENTS } from "../../lib/events";
import { useOfflineSave } from "../../lib/offline-save-context";
import Button from "../../components/button";
import Input from "../../components/input";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import { useSettings } from "../../lib/use-settings";
import type { AudioFormat } from "../../lib/data";

function PasswordField({ placeholder, value, onChange, inputRef }: {
    placeholder: string
    value: string
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
    inputRef?: React.Ref<HTMLInputElement>
}) {
    const [show, setShow] = useState(false)
    return (
        <div className="relative">
            <Input
                ref={inputRef}
                required
                type={show ? 'text' : 'password'}
                placeholder={placeholder}
                value={value}
                onChange={onChange}
                classAttrs="w-full pr-8"
            />
            <button
                type="button"
                tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                onClick={() => setShow(p => !p)}
            >
                {show ? <FaEyeSlash size={14} /> : <FaEye size={14} />}
            </button>
        </div>
    )
}

function OfflineStorage() {
    const [estimate, setEstimate] = useState<{ used: number; quota: number } | null>(null)
    const [cachedCount, setCachedCount] = useState(0)
    const [clearPhase, setClearPhase] = useState<'idle' | 'local' | 'server'>('idle')

    useEffect(() => {
        Promise.all([getStorageEstimate(), getCachedSongIds()]).then(([est, ids]) => {
            setEstimate(est)
            setCachedCount(ids.size)
        })
    }, [])

    async function handleClear() {
        setClearPhase('local')
        await clearOfflineCache()
        setClearPhase('server')
        await clearServerOfflineSongs()
        const est = await getStorageEstimate()
        setEstimate(est)
        setCachedCount(0)
        setClearPhase('idle')
        window.dispatchEvent(new CustomEvent(EVENTS.offlineCleared))
    }

    if (!estimate) return null

    const pct = estimate.quota > 0 ? (estimate.used / estimate.quota) * 100 : 0

    return (
        <div>
            <p className="text-gray-400 text-sm pb-2">offline storage</p>
            <div className="flex flex-col gap-3 w-full max-w-xs">
                <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs text-gray-400">
                        <span>{formatBytes(estimate.used)} used</span>
                        <span>{formatBytes(estimate.quota)} total</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full bg-sky-500 rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                </div>
                <p className="text-xs text-gray-400">{cachedCount} song{cachedCount !== 1 ? 's' : ''} cached offline</p>
                <Button
                    text={clearPhase === 'local' ? 'clearing local…' : clearPhase === 'server' ? 'clearing server…' : 'clear offline cache'}
                    disabled={clearPhase !== 'idle'}
                    onClick={handleClear}
                />
            </div>
        </div>
    )
}

interface AuditResult {
    total: number
    healthy: number
    corrupt: string[]
    orphaned: string[]
}

function CacheAudit() {
    const { refreshCachedIds } = useOfflineSave()
    const [running, setRunning] = useState(false)
    const [result, setResult] = useState<AuditResult | null>(null)
    const [fixing, setFixing] = useState(false)

    async function runAudit() {
        setRunning(true)
        setResult(null)
        try {
            const [cachedIds, librarySongs] = await Promise.all([getCachedSongIds(), fetchLibrarySongs()])
            const libraryIds = new Set(librarySongs.map(s => s.uuid))
            const corrupt: string[] = []
            const orphaned: string[] = []
            let healthy = 0

            for (const id of cachedIds) {
                if (!libraryIds.has(id)) {
                    orphaned.push(id)
                    continue
                }
                const file = await getSongFile(id)
                if (!file || file.size === 0) {
                    corrupt.push(id)
                } else {
                    healthy++
                }
            }
            setResult({ total: cachedIds.size, healthy, corrupt, orphaned })
        } catch {
            setResult({ total: 0, healthy: 0, corrupt: [], orphaned: [] })
        }
        setRunning(false)
    }

    const [fixProgress, setFixProgress] = useState('')

    async function fixIssues() {
        if (!result) return
        setFixing(true)
        for (const id of result.orphaned) {
            setFixProgress(`removing orphan…`)
            await uncacheSong(id)
        }
        for (let i = 0; i < result.corrupt.length; i++) {
            const id = result.corrupt[i]
            setFixProgress(`re-downloading ${i + 1}/${result.corrupt.length}…`)
            await uncacheSong(id)
            try {
                await cacheSong(id)
            } catch { /* will show as still corrupt on re-audit */ }
        }
        setFixProgress('')
        setFixing(false)
        await refreshCachedIds()
        await runAudit()
    }

    const issues = result ? result.corrupt.length + result.orphaned.length : 0

    return (
        <div>
            <p className="text-gray-400 text-sm pb-2">cache audit</p>
            <div className="flex flex-col gap-3 w-full max-w-xs">
                <Button
                    text={running ? 'checking…' : 'check cache health'}
                    disabled={running || fixing}
                    onClick={runAudit}
                />
                {result && (
                    <div className="text-xs space-y-1">
                        <p className="text-gray-400">{result.total} cached, {result.healthy} healthy</p>
                        {result.corrupt.length > 0 && (
                            <p className="text-red-400">{result.corrupt.length} corrupt (empty/unreadable)</p>
                        )}
                        {result.orphaned.length > 0 && (
                            <p className="text-amber-400">{result.orphaned.length} orphaned (not in library)</p>
                        )}
                        {issues === 0 && <p className="text-green-500">all clear</p>}
                        {issues > 0 && (
                            <Button
                                text={fixing ? fixProgress || 'fixing…' : `fix ${issues} file${issues !== 1 ? 's' : ''}`}
                                disabled={fixing}
                                onClick={fixIssues}
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

function AudioFormatSetting() {
    const { settings, saveSettings } = useSettings()
    const [saving, setSaving] = useState(false)

    async function handleChange(format: AudioFormat) {
        if (format === settings.audio_format) return
        setSaving(true)
        await saveSettings({ audio_format: format })
        setSaving(false)
    }

    const options: AudioFormat[] = ['mp3', 'm4a']

    return (
        <div>
            <p className="text-gray-400 text-sm pb-2">audio format</p>
            <div className="flex gap-2 w-full max-w-xs">
                {options.map(fmt => (
                    <button
                        key={fmt}
                        disabled={saving}
                        onClick={() => handleChange(fmt)}
                        className={`flex-1 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                            settings.audio_format === fmt
                                ? 'bg-sky-500 text-white border-sky-500'
                                : 'border-gray-200 dark:border-gray-700 hover:border-sky-500 hover:text-sky-500'
                        }`}
                    >
                        {fmt.toUpperCase()}
                    </button>
                ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">format used when downloading new songs</p>
        </div>
    )
}

export default function Page() {
    const [currentPassword, setCurrentPassword] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [error, setError] = useState('')
    const [success, setSuccess] = useState(false)
    const confirmRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (!confirmRef.current) return
        confirmRef.current.setCustomValidity(
            confirmPassword && newPassword !== confirmPassword ? 'passwords do not match' : ''
        )
    }, [newPassword, confirmPassword])

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        setSuccess(false)

        try {
            await changePassword(currentPassword, newPassword)
            setSuccess(true)
            setCurrentPassword('')
            setNewPassword('')
            setConfirmPassword('')
        } catch (err: any) {
            const s = err?.status
            if (s === 0 || s === undefined || s >= 500) setError('server unavailable')
            else if (s === 401) setError('incorrect current password')
            else setError('password change failed')
            return
        }
    }

    return (
        <main className="p-4">
            <div className="flex flex-col gap-8 py-4">
                <AudioFormatSetting />
                <OfflineStorage />
                <CacheAudit />
                <div>
                    <p className="text-gray-400 text-sm pb-2">change password</p>
                    <form onSubmit={handleSubmit} className="flex flex-col gap-2 w-full max-w-xs">
                        <PasswordField
                            placeholder="current password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                        />
                        <PasswordField
                            placeholder="new password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                        />
                        <PasswordField
                            placeholder="confirm new password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            inputRef={confirmRef}
                        />
                        <Button
                            text="update password"
                            type="submit"
                            variant="primary"
                            disabled={!currentPassword || !newPassword || !confirmPassword}
                        />
                        {error && <p className="text-red-500 text-sm">{error}</p>}
                        {success && <p className="text-green-600 text-sm">password updated</p>}
                    </form>
                </div>
            </div>
        </main>
    )
}
