import { BASE_URL } from './data'

const AUDIO_DIR = 'audio'

async function getAudioDir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory()
    return root.getDirectoryHandle(AUDIO_DIR, { create: true })
}

export async function getSongFile(songId: string): Promise<File | null> {
    try {
        const dir = await getAudioDir()
        const handle = await dir.getFileHandle(`${songId}.mp3`, { create: false })
        return handle.getFile()
    } catch {
        return null
    }
}

export async function getCachedSongIds(): Promise<Set<string>> {
    try {
        const dir = await getAudioDir()
        const ids = new Set<string>()
        for await (const [name] of (dir as any).entries()) {
            if (typeof name === 'string' && name.endsWith('.mp3')) {
                ids.add(name.slice(0, -4))
            }
        }
        return ids
    } catch {
        return new Set()
    }
}

export async function cacheSong(
    songId: string,
    onProgress?: (pct: number) => void,
): Promise<void> {
    const dir = await getAudioDir()
    const fileHandle = await dir.getFileHandle(`${songId}.mp3`, { create: true })
    const writable = await fileHandle.createWritable()

    const res = await fetch(`${BASE_URL}/download/${songId}`, { credentials: 'include' })
    if (!res.ok) {
        await writable.close()
        throw new Error(`fetch failed: ${res.status}`)
    }

    const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10)
    const reader = res.body!.getReader()
    let received = 0

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            await writable.write(value)
            received += value.byteLength
            if (contentLength > 0 && onProgress) onProgress(received / contentLength)
        }
        await writable.close()
        if (onProgress) onProgress(1)
    } catch (err) {
        await writable.abort()
        throw err
    }
}

export async function uncacheSong(songId: string): Promise<void> {
    try {
        const dir = await getAudioDir()
        await dir.removeEntry(`${songId}.mp3`)
    } catch {
        // already gone
    }
}

export async function clearOfflineCache(): Promise<void> {
    try {
        const root = await navigator.storage.getDirectory()
        await root.removeEntry(AUDIO_DIR, { recursive: true })
    } catch {
        // nothing to clear
    }
}

export interface StorageEstimate {
    used: number
    quota: number
}

export async function getStorageEstimate(): Promise<StorageEstimate> {
    const est = await navigator.storage.estimate()
    return { used: est.usage ?? 0, quota: est.quota ?? 0 }
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
