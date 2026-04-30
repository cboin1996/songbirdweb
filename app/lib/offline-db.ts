const DB_NAME = 'songbird-offline'
const DB_VERSION = 1
const STORE_NAME = 'library-cache'

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION)
        req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE_NAME)
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

export async function cacheLibraryData(key: string, data: unknown): Promise<void> {
    try {
        const db = await openDb()
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite')
            tx.objectStore(STORE_NAME).put(data, key)
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
        db.close()
    } catch {
        // non-fatal
    }
}

export async function getCachedData<T>(key: string): Promise<T | null> {
    try {
        const db = await openDb()
        const result = await new Promise<T | undefined>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly')
            const req = tx.objectStore(STORE_NAME).get(key)
            req.onsuccess = () => resolve(req.result as T | undefined)
            req.onerror = () => reject(req.error)
        })
        db.close()
        return result ?? null
    } catch {
        return null
    }
}

export async function clearLibraryCache(): Promise<void> {
    try {
        const db = await openDb()
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite')
            tx.objectStore(STORE_NAME).clear()
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
        db.close()
    } catch {
        // non-fatal
    }
}
