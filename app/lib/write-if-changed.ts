// Remembers a fingerprint of the last value written under a key, so an identical
// value is not written again. Per session (module memory); the first write of a
// session always goes through. The fingerprint is recorded only once the write
// has finished, and a forget during a write wins over that write.
const lastWritten = new Map<string, string>()
let generation = 0

/** Writes `data` unless it equals what this session last wrote under `key`. */
export async function writeIfChanged(
    key: string,
    data: unknown,
    write: (key: string, data: unknown) => Promise<void>,
): Promise<void> {
    const fingerprint = JSON.stringify(data)
    if (lastWritten.get(key) === fingerprint) return
    const startedIn = generation
    try {
        await write(key, data)
        if (startedIn === generation) lastWritten.set(key, fingerprint)
    } catch {
        lastWritten.delete(key)
    }
}

export function forgetLastWritten(key?: string): void {
    if (key) lastWritten.delete(key)
    else { lastWritten.clear(); generation++ }
}
