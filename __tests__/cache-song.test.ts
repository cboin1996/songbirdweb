// What cacheSong leaves behind when it does not finish. The offline scan treats
// any entry in the audio directory as a saved song, so an empty file left by a
// failed write is a song that is "saved" and cannot play. And what it leaves
// behind when it does: one copy, the new one.
import { cacheSong, getCachedSongIds, getSongFile } from '../app/lib/offline'

type Entries = Map<string, Uint8Array>

interface Opfs {
    entries: Entries
    removed: string[]
    failWrite: boolean
    // Reading the directory or one file fails with this error.
    failList?: Error
    failRead?: Error
}

function installOpfs(opfs: Opfs) {
    const dir = {
        async getFileHandle(name: string, opts?: { create?: boolean }) {
            if (!opfs.entries.has(name)) {
                if (!opts?.create) throw new DOMException('not found', 'NotFoundError')
                opfs.entries.set(name, new Uint8Array(0))
            }
            return fileHandle(name)
        },
        async removeEntry(name: string) {
            if (!opfs.entries.has(name)) throw new DOMException('not found', 'NotFoundError')
            opfs.removed.push(name)
            opfs.entries.delete(name)
        },
        async *entries() {
            if (opfs.failList) throw opfs.failList
            for (const name of [...opfs.entries.keys()]) yield [name, fileHandle(name)] as const
        },
    }
    function fileHandle(name: string) {
        return {
            async getFile() {
                if (opfs.failRead) throw opfs.failRead
                return { size: opfs.entries.get(name)?.length ?? 0 }
            },
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
    }
    Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: { getDirectory: async () => ({ getDirectoryHandle: async () => dir }) },
    })
}

// A minimal IndexedDB: enough for the fallback put to land somewhere visible, and
// for the scan and the cleanup to read and delete what is there.
function installIdb(store: Map<string, unknown>) {
    Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        value: {
            open() {
                const req: { onsuccess?: () => void; result?: unknown } = {}
                req.result = {
                    transaction: () => {
                        const tx: { oncomplete?: () => void; onerror?: () => void; error?: Error } = {}
                        const answer = (result: unknown) => {
                            const r: { onsuccess?: () => void; result?: unknown } = { result }
                            Promise.resolve().then(() => r.onsuccess?.())
                            return r
                        }
                        return Object.assign(tx, {
                            objectStore: () => ({
                                put: (blob: unknown, key: string) => {
                                    if (idbFailPut) {
                                        tx.error = new Error('quota')
                                        Promise.resolve().then(() => tx.onerror?.())
                                        return
                                    }
                                    store.set(key, blob)
                                    Promise.resolve().then(() => tx.oncomplete?.())
                                },
                                delete: (key: string) => {
                                    store.delete(key)
                                    Promise.resolve().then(() => tx.oncomplete?.())
                                },
                                get: (key: string) => answer(store.get(key)),
                                getAllKeys: () => answer([...store.keys()]),
                                getAll: () => answer([...store.values()]),
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
let idbFailPut = false

beforeEach(() => {
    opfs = { entries: new Map(), removed: [], failWrite: false }
    idb = new Map()
    idbFailPut = false
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

    it('keeps an earlier good copy when a re-save fails to write and IndexedDB fails too', async () => {
        opfs.entries.set('a.mp3', new Uint8Array([9, 9, 9]))
        respondWith(10, 10)
        opfs.failWrite = true
        idbFailPut = true
        await expect(cacheSong('a')).rejects.toThrow('quota')
        expect(opfs.entries.get('a.mp3')).toEqual(new Uint8Array([9, 9, 9]))
    })

    it('leaves one copy when a re-save fails to write and IndexedDB takes it: the new one', async () => {
        // OPFS is read first, so the earlier file in the same format would keep playing.
        opfs.entries.set('a.mp3', new Uint8Array([9, 9, 9]))
        respondWith(10, 10)
        opfs.failWrite = true
        await cacheSong('a')
        expect(idb.has('a')).toBe(true)
        expect(opfs.entries.has('a.mp3')).toBe(false)
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

    describe('one copy per song', () => {
        it('replaces an mp3 with an m4a', async () => {
            opfs.entries.set('a.mp3', new Uint8Array([9]))
            respondWith(10, 10, { 'content-type': 'audio/mp4' })
            await cacheSong('a')
            expect([...opfs.entries.keys()]).toEqual(['a.m4a'])
        })

        it('replaces an m4a with an mp3', async () => {
            opfs.entries.set('a.m4a', new Uint8Array([9]))
            respondWith(10, 10)
            await cacheSong('a')
            expect([...opfs.entries.keys()]).toEqual(['a.mp3'])
        })

        it('removes an earlier IndexedDB copy once the file is written', async () => {
            idb.set('a', new Blob([new Uint8Array([9])]))
            respondWith(10, 10)
            await cacheSong('a')
            expect(idb.has('a')).toBe(false)
            expect([...opfs.entries.keys()]).toEqual(['a.mp3'])
        })

        it('keeps the earlier copy when neither storage takes the new one', async () => {
            opfs.entries.set('a.mp3', new Uint8Array([9, 9, 9]))
            respondWith(10, 10, { 'content-type': 'audio/mp4' })
            opfs.failWrite = true
            idbFailPut = true
            await expect(cacheSong('a')).rejects.toThrow('quota')
            expect(opfs.entries.get('a.mp3')).toEqual(new Uint8Array([9, 9, 9]))
            expect(opfs.entries.has('a.m4a')).toBe(false)
        })

        it('removes the file in the other format when IndexedDB took the new copy', async () => {
            // OPFS reads first, so the old file would otherwise keep playing.
            opfs.entries.set('a.m4a', new Uint8Array([9, 9, 9]))
            respondWith(10, 10)
            opfs.failWrite = true
            await cacheSong('a')
            expect(idb.has('a')).toBe(true)
            expect(opfs.entries.has('a.m4a')).toBe(false)
        })
    })
})

describe('getCachedSongIds', () => {
    beforeEach(() => {
        opfs.entries.set('full.mp3', new Uint8Array([1]))
        opfs.entries.set('hollow.mp3', new Uint8Array(0))
        idb.set('held', new Blob([new Uint8Array([1])]))
        idb.set('empty', new Blob([]))
    })

    it('lists every name when it is not verifying, as the launch scan does', async () => {
        expect([...await getCachedSongIds(false)].sort()).toEqual(['empty', 'full', 'held', 'hollow'])
    })

    it('leaves out an empty file and an empty IndexedDB copy when verifying', async () => {
        expect([...await getCachedSongIds()].sort()).toEqual(['full', 'held'])
    })
})

describe('getCachedSongIds when the list cannot be read', () => {
    it('throws rather than return the part it had', async () => {
        opfs.entries.set('a.mp3', new Uint8Array([1]))
        opfs.failList = new DOMException('interrupted', 'InvalidStateError')
        await expect(getCachedSongIds(false)).rejects.toThrow('interrupted')
    })

    it('throws when IndexedDB cannot be read', async () => {
        Object.defineProperty(globalThis, 'indexedDB', {
            configurable: true,
            value: { open() { throw new DOMException('closed', 'InvalidStateError') } },
        })
        await expect(getCachedSongIds(false)).rejects.toThrow('closed')
    })

    it('lists what OPFS holds when the browser has no IndexedDB at all', async () => {
        opfs.entries.set('a.mp3', new Uint8Array([1]))
        Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined })
        expect([...await getCachedSongIds(false)]).toEqual(['a'])
    })
})

describe('getSongFile', () => {
    it('is null for a song that is not saved', async () => {
        expect(await getSongFile('a')).toBeNull()
    })

    it('finds a saved file', async () => {
        opfs.entries.set('a.mp3', new Uint8Array([1, 2]))
        expect((await getSongFile('a'))?.size).toBe(2)
    })

    it('lets a read that failed for any other reason be seen, not called "missing"', async () => {
        opfs.entries.set('a.mp3', new Uint8Array([1, 2]))
        opfs.failRead = new DOMException('read failed', 'NotReadableError')
        await expect(getSongFile('a')).rejects.toThrow('read failed')
    })

    it('treats a file that vanished between the lookup and the read as missing', async () => {
        opfs.entries.set('a.mp3', new Uint8Array([1, 2]))
        opfs.failRead = new DOMException('gone', 'NotFoundError')
        expect(await getSongFile('a')).toBeNull()
    })
})
