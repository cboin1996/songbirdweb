import { BROWSE_ARTWORK_CACHE, OFFLINE_ARTWORK_CACHE, optimizerWidth } from './artwork'
import {
    DOWNLOAD_URL, AuthExpiredError, RefreshUnavailableError,
    addServerOfflineSong, ensureFreshToken, redirectToLogin, tryRefresh,
} from './data'

const AUDIO_DIR = 'audio'
const IDB_DB_NAME = 'songbird-audio'
const IDB_STORE = 'files'
const IDB_VERSION = 1

// --- OPFS helpers ---

// Always re-resolve the dir handle. Chromium's OPFS handles can go stale —
// a handle obtained before a write doesn't always see the new file via
// getFileHandle / entries(). Resolving fresh each call costs ~1ms and
// guarantees we see current contents.
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

// With `verify`, a key whose blob is empty is left out, as an empty OPFS file is.
async function idbGetAllKeys(verify = false): Promise<string[]> {
    const db = await openAudioDb()
    const { keys, blobs } = await new Promise<{ keys: IDBValidKey[]; blobs: (Blob | undefined)[] }>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly')
        const store = tx.objectStore(IDB_STORE)
        const keysReq = store.getAllKeys()
        const blobsReq = verify ? store.getAll() : null
        const out = { keys: [] as IDBValidKey[], blobs: [] as (Blob | undefined)[] }
        keysReq.onsuccess = () => {
            out.keys = keysReq.result
            if (!blobsReq) resolve(out)
        }
        if (blobsReq) {
            blobsReq.onsuccess = () => {
                out.blobs = blobsReq.result as (Blob | undefined)[]
                resolve(out)
            }
            blobsReq.onerror = () => reject(blobsReq.error)
        }
        keysReq.onerror = () => reject(keysReq.error)
    })
    db.close()
    return (keys as string[]).filter((_, i) => !verify || (blobs[i]?.size ?? 0) > 0)
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

// A file that is not there, or not a file, is the answer "no copy in this format".
// Any other error (a read that failed, storage that was interrupted) says nothing
// about whether the copy exists, so it is the caller's to see: treating it as
// "missing" would drop a saved song that is still on the device.
function isAbsent(err: unknown): boolean {
    const name = (err as { name?: string } | null)?.name
    return name === 'NotFoundError' || name === 'TypeMismatchError'
}

export async function getSongFile(songId: string): Promise<File | null> {
    if (await opfsAvailable()) {
        const dir = await getAudioDir()
        for (const ext of ['m4a', 'mp3']) {
            try {
                const handle = await dir.getFileHandle(`${songId}.${ext}`, { create: false })
                const file = await handle.getFile()
                if (file.size > 0) return file
            } catch (err) {
                if (!isAbsent(err)) throw err
            }
        }
    }
    const blob = await idbGet(songId)
    if (!blob || blob.size === 0) return null
    return new File([blob], `${songId}`, { type: blob.type || 'audio/mpeg' })
}

// `verify` opens every OPFS entry to check it is non-empty. The launch-time scan
// passes false: on a phone with a large offline library that is one file open per
// song, competing with the initial player-state fetch. The non-empty check still
// happens on the playback path, in getSongFile, where it belongs.
//
// A list that could not be read to the end is not a smaller list: it throws, so a
// caller never takes part of the saved songs for all of them. Only a browser with no
// OPFS or no IndexedDB at all is skipped, because there is nothing there to miss.
export async function getCachedSongIds(verify = true): Promise<Set<string>> {
    const ids = new Set<string>()

    if (await opfsAvailable()) {
        const dir = await getAudioDir()
        for await (const [name, handle] of (dir as FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
            if (typeof name === 'string' && (name.endsWith('.mp3') || name.endsWith('.m4a'))) {
                if (!verify) {
                    ids.add(name.replace(/\.(mp3|m4a)$/, ''))
                    continue
                }
                try {
                    const file = await (handle as FileSystemFileHandle).getFile()
                    if (file.size > 0) ids.add(name.replace(/\.(mp3|m4a)$/, ''))
                } catch { /* an entry that cannot be opened is not a song to list */ }
            }
        }
    }

    if (typeof indexedDB !== 'undefined') {
        for (const k of await idbGetAllKeys(verify)) ids.add(k)
    }

    return ids
}

// The download is the one request that never went through fetchData, so it was
// also the one request that never refreshed an expired access token. A save that
// runs longer than the token's fifteen minutes used to fail from that point on.
// The retry lives here rather than in the bulk loops so the row menu, the
// select-mode save and the settings page get it too, and because a download is a
// plain GET: asking again costs only the bytes already thrown away.
//
// A 401 that survives a successful refresh is as terminal as a refused refresh:
// every later song would be refused the same way, so it ends the batch instead of
// costing one failed request and one refresh per song.
async function fetchDownload(songId: string): Promise<Response> {
    const url = `${DOWNLOAD_URL}/${songId}`
    const res = await fetch(url, { credentials: 'include' })
    if (res.status !== 401) return res
    const refreshed = await tryRefresh()
    if (refreshed === 'rejected') throw new AuthExpiredError()
    if (refreshed === 'unavailable') throw new RefreshUnavailableError()
    const retry = await fetch(url, { credentials: 'include' })
    if (retry.status === 401) throw new AuthExpiredError()
    return retry
}

export async function cacheSong(
    songId: string,
    onProgress?: (pct: number) => void,
): Promise<void> {
    const res = await fetchDownload(songId)
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

    // A body that ends early is not a song, and the scan would count it as one.
    // Skipped when the body was encoded in transit: the declared length is then
    // the encoded size, which the decoded stream never matches.
    if (contentLength > 0 && received !== contentLength && !res.headers.get('content-encoding')) {
        throw new Error(`incomplete download: ${received} of ${contentLength} bytes`)
    }

    const contentType = res.headers.get('content-type') || 'audio/mpeg'
    const ext = contentType.includes('mp4') || contentType.includes('m4a') ? 'm4a' : 'mp3'
    const blob = new Blob(chunks, { type: contentType })

    // One copy per song. The old copies are removed only after the new one is
    // written: a save that fails leaves the song playing from what it had.
    const otherExt = ext === 'mp3' ? 'm4a' : 'mp3'

    if (await opfsAvailable()) {
        try {
            const dir = await getAudioDir()
            const name = `${songId}.${ext}`
            // Creating the handle creates the entry, before a byte is written. If
            // the write then fails, the empty file stays, and the scan reads any
            // entry as a saved song. Remove what this call made; an earlier good
            // copy is left alone, because a writable only replaces it on close().
            const existed = await dir.getFileHandle(name).then(() => true, () => false)
            const fileHandle = await dir.getFileHandle(name, { create: true })
            try {
                const writable = await fileHandle.createWritable()
                try {
                    await writable.write(blob)
                    await writable.close()
                    // The file is in place; the copies it replaces would only
                    // shadow it or take up room. The format getSongFile tries
                    // first is the m4a, so a leftover one would win over this mp3.
                    try { await dir.removeEntry(`${songId}.${otherExt}`) } catch { /* no old file */ }
                    try { await idbDelete(songId) } catch { /* no fallback copy */ }
                    if (onProgress) onProgress(1)
                    return
                } catch (err) {
                    await writable.abort().catch(() => {})
                    throw err
                }
            } catch {
                if (!existed) await dir.removeEntry(name).catch(() => {})
                // fall through to IDB
            }
        } catch { /* fall through to IDB */ }
    }

    await idbPut(songId, blob)
    // IndexedDB is read after OPFS, so a file left in either format would keep
    // playing instead of this copy. This point is reached when the OPFS write
    // failed, and an earlier copy in the same format is still there.
    if (await opfsAvailable()) {
        try {
            const dir = await getAudioDir()
            for (const old of [otherExt, ext]) {
                try { await dir.removeEntry(`${songId}.${old}`) } catch { /* no old file */ }
            }
        } catch { /* no OPFS directory */ }
    }
    if (onProgress) onProgress(1)
}

// How a batch save ended. `done`: every song was tried. `auth-expired`: the
// session is over, so no later song could succeed. `unavailable`: a refresh was
// needed and the server could not be reached, so the session may be fine but the
// rest cannot be fetched now.
export type SaveOutcome = 'done' | 'auth-expired' | 'unavailable'

export interface SaveResult {
    // Songs that did not end up saved, including the ones never tried because
    // the batch stopped. A retry of this set is a retry of exactly what is missing.
    failed: Set<string>
    outcome: SaveOutcome
}

// The one policy for saving a list of songs, shared by save-all, retry, the
// select-mode save and sync download: refresh the token as we go (a whole-library
// save outlives its fifteen minutes), and stop at the first sign that no later
// song can succeed instead of failing the rest one by one.
export async function saveSongsOffline(
    ids: string[],
    hooks: { onSaved?: (id: string) => void; onSettled?: (id: string) => void } = {},
): Promise<SaveResult> {
    const failed = new Set<string>()
    const stop = (from: number, outcome: SaveOutcome): SaveResult => {
        for (const id of ids.slice(from)) failed.add(id)
        return { failed, outcome }
    }
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i]
        const fresh = await ensureFreshToken()
        if (fresh !== 'ok') return stop(i, fresh === 'rejected' ? 'auth-expired' : 'unavailable')
        try {
            await cacheSong(id)
            try {
                await addServerOfflineSong(id)
            } catch {
                await uncacheSong(id).catch(() => {})
                failed.add(id)
                hooks.onSettled?.(id)
                continue
            }
            hooks.onSaved?.(id)
        } catch (err) {
            if (err instanceof AuthExpiredError) return stop(i, 'auth-expired')
            if (err instanceof RefreshUnavailableError) return stop(i, 'unavailable')
            failed.add(id)
        }
        hooks.onSettled?.(id)
    }
    return { failed, outcome: 'done' }
}

// What to tell the user when a save ends, so every caller says the same thing.
// An expired session sends them to sign in; when that redirect cannot happen
// (offline, or already on the login page) the batch would otherwise end in
// silence, so it says so.
export function reportSaveResult(
    { failed, outcome }: SaveResult,
    showToast: (message: string, error?: boolean) => void,
): void {
    if (outcome === 'auth-expired') {
        if (!redirectToLogin()) showToast('session expired — sign in to finish saving', true)
    } else if (outcome === 'unavailable') {
        showToast('saving paused — connection problem, retry the failed songs', true)
    } else if (failed.size > 0) {
        showToast(`${failed.size} song${failed.size > 1 ? 's' : ''} failed to save offline`, true)
    }
}

export async function uncacheSong(songId: string): Promise<void> {
    if (await opfsAvailable()) {
        const dir = await getAudioDir()
        for (const ext of ['mp3', 'm4a']) {
            try { await dir.removeEntry(`${songId}.${ext}`) } catch { /* already gone */ }
        }
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
        if ('caches' in self) {
            await caches.delete(BROWSE_ARTWORK_CACHE)
            await caches.delete(OFFLINE_ARTWORK_CACHE)
        }
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

/** Drops every stored artwork copy of one song (all sizes and versions). */
export async function dropStoredArtwork(songId: string): Promise<void> {
    if (!('caches' in self)) return
    try {
        for (const name of [BROWSE_ARTWORK_CACHE, OFFLINE_ARTWORK_CACHE]) {
            const cache = await caches.open(name)
            const stored = await cache.keys()
            await Promise.all(stored
                .filter(r => new URL(r.url).pathname.startsWith(`/v1/songs/${songId}/artwork/`))
                .map(r => cache.delete(r)))
        }
    } catch { /* non-fatal */ }
}

export async function cacheArtworkUrls(urls: string[]): Promise<void> {
    if (!('caches' in self)) return
    try {
        const cache = await caches.open(OFFLINE_ARTWORK_CACHE)
        await Promise.allSettled(urls.map(async url => {
            if (await cache.match(url)) return
            // Local paths are same-origin — fetch directly
            // External URLs route through Next.js image proxy to avoid CORS
            const fetchUrl = url.startsWith('/') ? url : `/_next/image?url=${encodeURIComponent(url)}&w=${optimizerWidth(url)}&q=75`
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
