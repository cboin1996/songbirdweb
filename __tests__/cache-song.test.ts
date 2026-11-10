// What cacheSong leaves behind when it does not finish. The offline scan treats
// any entry in the audio directory as a saved song, so an empty file left by a
// failed write is a song that is "saved" and cannot play.
import { cacheSong } from '../app/lib/offline'

type Entries = Map<string, Uint8Array>

interface Opfs {
    entries: Entries
    removed: string[]
    failWrite: boolean
}

function installOpfs(opfs: Opfs) {
    const dir = {
        async getFileHandle(name: string, opts?: { create?: boolean }) {
            if (!opfs.entries.has(name)) {
                if (!opts?.create) throw new DOMException('not found', 'NotFoundError')
                opfs.entries.set(name, new Uint8Array(0))
            }
            return {
                async createWritable() {
                    return {
                        async write() {
                            if (opfs.failWrite) throw new DOMException('quota', 'QuotaExceededError')
                            opfs.entries.set(name, new Uint8Array([1]))
                        },
                        async close() {},
                        async abort() {},
                    }
                },
            }
        },
        async removeEntry(name: string) {
            opfs.removed.push(name)
            opfs.entries.delete(name)
        },
    }
    Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: { getDirectory: async () => ({ getDirectoryHandle: async () => dir }) },
    })
}

// A minimal IndexedDB: enough for the fallback put to land somewhere visible.
function installIdb(store: Map<string, unknown>) {
    Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        value: {
            open() {
                const req: { onsuccess?: () => void; result?: unknown } = {}
                req.result = {
                    transaction: () => {
                        const tx: { oncomplete?: () => void } = {}
                        return Object.assign(tx, {
                            objectStore: () => ({
                                put: (blob: unknown, key: string) => {
                                    store.set(key, blob)
                                    Promise.resolve().then(() => tx.oncomplete?.())
                                },
                            }),
                        })
                    },
                    close: () => {},
                }
                Promise.resolve().then(() => req.onsuccess?.())
                return req
            },
        },
    })
}

function respondWith(bytes: number, declared: number | null, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { 'content-type': 'audio/mpeg', ...extra }
    if (declared !== null) headers['content-length'] = String(declared)
    let sent = false
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
        body: {
            getReader: () => ({
                read: async () => {
                    if (sent) return { done: true, value: undefined }
                    sent = true
                    return { done: false, value: new Uint8Array(bytes) }
                },
            }),
        },
    }) as unknown as typeof fetch
}

let opfs: Opfs
let idb: Map<string, unknown>

beforeEach(() => {
    opfs = { entries: new Map(), removed: [], failWrite: false }
    idb = new Map()
    installOpfs(opfs)
    installIdb(idb)
})

describe('cacheSong', () => {
    it('writes the song to OPFS and leaves no fallback copy', async () => {
        respondWith(10, 10)
        await cacheSong('a')
        expect([...opfs.entries.keys()]).toEqual(['a.mp3'])
        expect(opfs.removed).toEqual([])
        expect(idb.size).toBe(0)
    })

    it('removes the empty entry a failed OPFS write leaves, and saves to IndexedDB instead', async () => {
        respondWith(10, 10)
        opfs.failWrite = true
        await cacheSong('a')
        expect(opfs.entries.has('a.mp3')).toBe(false)
        expect(idb.has('a')).toBe(true)
    })

    it('keeps an earlier good copy when a re-save fails to write', async () => {
        opfs.entries.set('a.mp3', new Uint8Array([9, 9, 9]))
        respondWith(10, 10)
        opfs.failWrite = true
        await cacheSong('a')
        expect(opfs.entries.get('a.mp3')).toEqual(new Uint8Array([9, 9, 9]))
    })

    it('rejects a body shorter than its Content-Length and stores nothing', async () => {
        respondWith(6, 10)
        await expect(cacheSong('a')).rejects.toThrow(/incomplete/)
        expect(opfs.entries.size).toBe(0)
        expect(idb.size).toBe(0)
    })

    it('accepts a body when no Content-Length was declared', async () => {
        respondWith(6, null)
        await cacheSong('a')
        expect([...opfs.entries.keys()]).toEqual(['a.mp3'])
    })

    it('does not compare against Content-Length when the body was encoded in transit', async () => {
        // The declared length is the encoded size, which the decoded stream never matches.
        respondWith(30, 10, { 'content-encoding': 'gzip' })
        await cacheSong('a')
        expect([...opfs.entries.keys()]).toEqual(['a.mp3'])
    })
})
