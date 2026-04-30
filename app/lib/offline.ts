import { DOWNLOAD_URL } from './data'

const AUDIO_DIR = 'audio'
const ARTWORK_CACHE_NAME = 'songbird-artwork-v1'
const IDB_DB_NAME = 'songbird-audio'
const IDB_STORE = 'files'
const IDB_VERSION = 1

// --- OPFS helpers ---

async function getAudioDir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory()
    return root.getDirectoryHandle(AUDIO_DIR, { create: true })
}

async function opfsAvailable(): Promise<boolean> {
    try {
        await navigator.storage.getDirectory()
        return true
    } catch {
        return false
    }
}

// --- IndexedDB fallback helpers ---

function openAudioDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION)
        req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

async function idbPut(songId: string, blob: Blob): Promise<void> {
    const db = await openAudioDb()
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite')
        tx.objectStore(IDB_STORE).put(blob, songId)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
    })
    db.close()
}

async function idbGet(songId: string): Promise<Blob | null> {
    const db = await openAudioDb()
    const result = await new Promise<Blob | undefined>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly')
        const req = tx.objectStore(IDB_STORE).get(songId)
        req.onsuccess = () => resolve(req.result as Blob | undefined)
        req.onerror = () => reject(req.error)
    })
    db.close()
    return result ?? null
}

async function idbDelete(songId: string): Promise<void> {
    const db = await openAudioDb()
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite')
        tx.objectStore(IDB_STORE).delete(songId)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
    })
    db.close()
}

async function idbGetAllKeys(): Promise<string[]> {
    const db = await openAudioDb()
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly')
        const req = tx.objectStore(IDB_STORE).getAllKeys()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
    db.close()
    return keys as string[]
}

async function idbClearAll(): Promise<void> {
    const db = await openAudioDb()
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite')
        tx.objectStore(IDB_STORE).clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
    })
    db.close()
}

// --- Public API ---

export async function getSongFile(songId: string): Promise<File | null> {
    if (await opfsAvailable()) {
        try {
            const dir = await getAudioDir()
            const handle = await dir.getFileHandle(`${songId}.mp3`, { create: false })
            const file = await handle.getFile()
            if (file.size > 0) return file
        } catch { /* fall through to IDB */ }
    }
    const blob = await idbGet(songId)
    if (!blob || blob.size === 0) return null
    return new File([blob], `${songId}.mp3`, { type: 'audio/mpeg' })
}

export async function getCachedSongIds(): Promise<Set<string>> {
    const ids = new Set<string>()

    if (await opfsAvailable()) {
        try {
            const dir = await getAudioDir()
            for await (const [name, handle] of (dir as any).entries()) {
                if (typeof name === 'string' && name.endsWith('.mp3')) {
                    try {
                        const file = await (handle as FileSystemFileHandle).getFile()
                        if (file.size > 0) ids.add(name.slice(0, -4))
                    } catch { /* skip */ }
                }
            }
        } catch { /* OPFS unavailable */ }
    }

    try {
        const keys = await idbGetAllKeys()
        for (const k of keys) ids.add(k)
    } catch { /* IDB unavailable */ }

    return ids
}

export async function cacheSong(
    songId: string,
    onProgress?: (pct: number) => void,
): Promise<void> {
    const res = await fetch(`${DOWNLOAD_URL}/${songId}`, { credentials: 'include' })
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`)

    const contentLength = parseInt(res.headers.get('content-length') ?? '0', 10)
    const reader = res.body!.getReader()
    const chunks: Uint8Array[] = []
    let received = 0

    while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.byteLength
        if (contentLength > 0 && onProgress) onProgress(received / contentLength)
    }

    const blob = new Blob(chunks, { type: 'audio/mpeg' })

    if (await opfsAvailable()) {
        try {
            const dir = await getAudioDir()
            const fileHandle = await dir.getFileHandle(`${songId}.mp3`, { create: true })
            const writable = await fileHandle.createWritable()
            try {
                await writable.write(blob)
                await writable.close()
                if (onProgress) onProgress(1)
                return
            } catch (err) {
                await writable.abort()
                // fall through to IDB
            }
        } catch { /* fall through to IDB */ }
    }

    await idbPut(songId, blob)
    if (onProgress) onProgress(1)
}

export async function uncacheSong(songId: string): Promise<void> {
    if (await opfsAvailable()) {
        try {
            const dir = await getAudioDir()
            await dir.removeEntry(`${songId}.mp3`)
        } catch { /* already gone */ }
    }
    try { await idbDelete(songId) } catch { /* already gone */ }
}

export async function clearOfflineCache(): Promise<void> {
    if (await opfsAvailable()) {
        try {
            const root = await navigator.storage.getDirectory()
            await root.removeEntry(AUDIO_DIR, { recursive: true })
        } catch { /* nothing to clear */ }
    }
    try { await idbClearAll() } catch { /* nothing to clear */ }
    try {
        if ('caches' in self) await caches.delete(ARTWORK_CACHE_NAME)
    } catch { /* nothing to clear */ }
}

export interface StorageEstimate {
    used: number
    quota: number
}

export async function getStorageEstimate(): Promise<StorageEstimate> {
    const est = await navigator.storage.estimate()
    return { used: est.usage ?? 0, quota: est.quota ?? 0 }
}

export async function cacheArtworkUrls(urls: string[]): Promise<void> {
    if (!('caches' in self)) return
    try {
        const cache = await caches.open(ARTWORK_CACHE_NAME)
        await Promise.allSettled(urls.map(async url => {
            if (await cache.match(url)) return
            // Local paths are same-origin — fetch directly
            // External URLs route through Next.js image proxy to avoid CORS
            const fetchUrl = url.startsWith('/') ? url : `/_next/image?url=${encodeURIComponent(url)}&w=384&q=75`
            const res = await fetch(fetchUrl)
            if (res.ok) await cache.put(url, res)
        }))
    } catch { /* non-fatal */ }
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
