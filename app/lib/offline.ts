import { BROWSE_ARTWORK_CACHE, OFFLINE_ARTWORK_CACHE, ARTWORK_SMALL_PX, ARTWORK_LARGE_PX, optimizerWidth, parseArtworkPath, completeResponse } from './artwork'
import {
    DOWNLOAD_URL, AuthExpiredError, RefreshUnavailableError,
    addServerOfflineSong, ensureFreshToken, redirectToLogin, tryRefresh, songArtworkUrl,
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
    const chunks: BlobPart[] = []
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
        if ('caches' in globalThis) {
            await caches.delete(BROWSE_ARTWORK_CACHE)
            await caches.delete(OFFLINE_ARTWORK_CACHE)
            forgetIndex()
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

// Which stored copy answers for a song and size, whatever its version. Listing a cache's
// keys costs O(entries), so it is done once per cache and kept; the page's own stores and
// deletes keep it current. A copy stored by the service worker after the index was built
// is missing from it, so a miss rebuilds the index, at most once per REINDEX_MS: a list of
// songs with no art then costs one scan, not one per song. A key trimmed away is dropped
// when it is found dead. Mirrored in public/sw.template.js.
const REINDEX_MS = 5000
interface StemIndex { built: number; stems: Map<string, string> }
const stemIndex = new Map<string, StemIndex>()

async function buildIndex(cacheName: string): Promise<StemIndex> {
    const stems = new Map<string, string>()
    const cache = await caches.open(cacheName)
    // keys() lists oldest first, so a later key of the same stem is the newer version.
    for (const request of await cache.keys()) {
        const parsed = parseArtworkPath(new URL(request.url).pathname)
        if (parsed) stems.set(parsed.stem, request.url)
    }
    const index = { built: Date.now(), stems }
    stemIndex.set(cacheName, index)
    return index
}

async function indexedCopy(cacheName: string, stem: string): Promise<string | undefined> {
    let index = stemIndex.get(cacheName) ?? await buildIndex(cacheName)
    const hit = index.stems.get(stem)
    if (hit) return hit
    if (Date.now() - index.built < REINDEX_MS) return undefined
    index = await buildIndex(cacheName)
    return index.stems.get(stem)
}

function noteStored(cacheName: string, url: string): void {
    const parsed = parseArtworkPath(url)
    if (!parsed) return
    stemIndex.get(cacheName)?.stems.set(parsed.stem, url)
}

export function forgetIndex(cacheName?: string): void {
    if (cacheName) stemIndex.delete(cacheName)
    else stemIndex.clear()
}

/** Drops every stored artwork copy of one song (all sizes and versions). */
export async function dropStoredArtwork(songId: string): Promise<void> {
    if (!('caches' in globalThis)) return
    try {
        for (const name of [BROWSE_ARTWORK_CACHE, OFFLINE_ARTWORK_CACHE]) {
            const cache = await caches.open(name)
            const stored = await cache.keys()
            await Promise.all(stored
                .filter(r => new URL(r.url).pathname.startsWith(`/v1/songs/${songId}/artwork/`))
                .map(r => cache.delete(r)))
            forgetIndex(name)
        }
    } catch { /* non-fatal */ }
}

/** Whole pictures only: a partial or empty answer stored would show a white square offline. */
async function isWholePicture(res: Response): Promise<boolean> {
    return completeResponse(res) && (await res.clone().blob()).size > 0
}

export async function cacheArtworkUrls(urls: string[]): Promise<void> {
    if (!('caches' in globalThis)) return
    try {
        const cache = await caches.open(OFFLINE_ARTWORK_CACHE)
        await Promise.allSettled(urls.map(async url => {
            if (await cache.match(url)) return
            // Local paths are same-origin — fetch directly
            // External URLs route through Next.js image proxy to avoid CORS
            const fetchUrl = url.startsWith('/') ? url : `/_next/image?url=${encodeURIComponent(url)}&w=${optimizerWidth(url)}&q=75`
            const res = await fetch(fetchUrl)
            if (await isWholePicture(res)) {
                await cache.put(url, res)
                noteStored(OFFLINE_ARTWORK_CACHE, url)
            }
        }))
    } catch { /* non-fatal */ }
}

type ArtSong = { uuid: string; artwork_cached?: boolean; artwork_updated_at?: number | null; properties?: { artworkUrl100?: string } | null }

/**
 * Stores the large artwork of a song that is about to play (or is playing), while online,
 * so the expanded player and the lock screen still have it offline. Browsing stores only
 * the thumbnail; without this the large image exists only for songs saved on purpose.
 * Goes to the capped browse cache, not the saved one. Failures are ignored.
 */
export async function warmLargeArtwork(song: ArtSong): Promise<void> {
    if (!('caches' in globalThis) || (typeof navigator !== 'undefined' && !navigator.onLine)) return
    try {
        const url = songArtworkUrl(song.uuid, song.artwork_cached, song.properties?.artworkUrl100, ARTWORK_LARGE_PX, song.artwork_updated_at)
        if (!url) return
        // This exact url only: an older version stored is not this song's current art.
        if (completeResponse(await caches.match(url))) return
        // Local art: the service worker stores it on a good answer. Remote art goes through the optimizer, stored under its raw url.
        const res = await fetch(url.startsWith('/') ? url : `/_next/image?url=${encodeURIComponent(url)}&w=${optimizerWidth(url)}&q=75`)
        if (!url.startsWith('/') && await isWholePicture(res)) {
            await (await caches.open(BROWSE_ARTWORK_CACHE)).put(url, res)
            noteStored(BROWSE_ARTWORK_CACHE, url)
        }
    } catch { /* non-fatal */ }
}

/** A stored copy of the art at this url, or of the same song and size at any version (older saves have none). */
export async function findStoredArtwork(url: string): Promise<Response | undefined> {
    if (!('caches' in globalThis)) return undefined
    const exact = await caches.match(url)
    if (completeResponse(exact)) return exact
    const stem = parseArtworkPath(url)?.stem
    if (!stem) return undefined
    for (const name of [OFFLINE_ARTWORK_CACHE, BROWSE_ARTWORK_CACHE]) {
        const copy = await indexedCopy(name, stem)
        if (!copy) continue
        const found = await (await caches.open(name)).match(copy)
        if (completeResponse(found)) return found
        stemIndex.get(name)?.stems.delete(stem) // trimmed or replaced since it was indexed
    }
    return undefined
}

/** The two sizes a saved song keeps, at the url the library reports for it (none when it has no art at all). */
function wantedSavedArtwork(song: ArtSong): string[] {
    return [ARTWORK_SMALL_PX, ARTWORK_LARGE_PX]
        .map(px => songArtworkUrl(song.uuid, !!song.artwork_cached, song.properties?.artworkUrl100, px, song.artwork_updated_at))
        .filter((u): u is string => !!u)
}

async function hasAll(cache: Cache, urls: string[]): Promise<boolean> {
    for (const url of urls) if (!(await cache.match(url))) return false
    return true
}

/**
 * Saved songs missing a stored copy of their art at the current url, either size.
 * Offline-safe: reads the cache only. Null when the answer is unknown: this connection
 * has no Cache API (plain http), or reading it failed. That is not the same as "none".
 */
export async function songsMissingSavedArtwork(songs: ArtSong[], savedIds: ReadonlySet<string>): Promise<string[] | null> {
    if (!('caches' in globalThis)) return null
    try {
        const cache = await caches.open(OFFLINE_ARTWORK_CACHE)
        const missing: string[] = []
        for (const song of songs) {
            if (!savedIds.has(song.uuid)) continue
            if (!(await hasAll(cache, wantedSavedArtwork(song)))) missing.push(song.uuid)
        }
        return missing
    } catch { return null }
}

/**
 * Keeps the saved art of saved songs at the version the library reports. Art saved before
 * versions existed (no version in its url), before a replace, or never stored (a save that
 * lost its art fetch) is stored again at the current url, and only then are the older copies
 * of that song and size dropped, so a failed fetch never leaves a saved song with nothing.
 * Songs with remote (iTunes) art are covered too. Needs the network; offline it does
 * nothing and the service worker answers with whichever version is stored.
 */
export async function refreshSavedArtwork(songs: ArtSong[], savedIds: ReadonlySet<string>): Promise<void> {
    if (!('caches' in globalThis)) return
    try {
        const cache = await caches.open(OFFLINE_ARTWORK_CACHE)
        const stored = (await cache.keys()).map(request => ({ request, path: new URL(request.url).pathname }))
        for (const song of songs) {
            if (!savedIds.has(song.uuid)) continue
            const wanted = wantedSavedArtwork(song)
            if (await hasAll(cache, wanted)) continue
            await cacheArtworkUrls(wanted)
            if (!song.artwork_cached) continue
            for (const url of wanted) {
                if (!(await cache.match(url))) continue
                const stem = parseArtworkPath(url)?.stem
                for (const old of stored) {
                    if (old.path === url) continue
                    if (old.path === stem || old.path.startsWith(`${stem}/`)) await cache.delete(old.request)
                }
            }
        }
        forgetIndex(OFFLINE_ARTWORK_CACHE)
    } catch { /* non-fatal */ }
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
