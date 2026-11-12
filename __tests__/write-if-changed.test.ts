import { forgetLastWritten, writeIfChanged } from '../app/lib/write-if-changed'

beforeEach(() => forgetLastWritten())

function recorder() {
    const writes: [string, unknown][] = []
    return { writes, write: async (k: string, d: unknown) => { writes.push([k, d]) } }
}

describe('writeIfChanged', () => {
    it('lets the first value through', async () => {
        const r = recorder()
        await writeIfChanged('k', [1, 2], r.write)
        expect(r.writes).toEqual([['k', [1, 2]]])
    })
    it('stops an identical value', async () => {
        const r = recorder()
        await writeIfChanged('k', [1, 2], r.write)
        await writeIfChanged('k', [1, 2], r.write)
        expect(r.writes).toHaveLength(1)
    })
    it('lets a changed value through, then stops its repeat', async () => {
        const r = recorder()
        await writeIfChanged('k', [1, 2], r.write)
        await writeIfChanged('k', [1, 3], r.write)
        await writeIfChanged('k', [1, 3], r.write)
        expect(r.writes.map(w => w[1])).toEqual([[1, 2], [1, 3]])
    })
    it('keeps keys apart', async () => {
        const r = recorder()
        await writeIfChanged('a', [1], r.write)
        await writeIfChanged('b', [1], r.write)
        expect(r.writes).toHaveLength(2)
    })
    it('forget lets the same value through again (after the stored copy is cleared)', async () => {
        const r = recorder()
        await writeIfChanged('k', [1], r.write)
        forgetLastWritten('k')
        await writeIfChanged('k', [1], r.write)
        expect(r.writes).toHaveLength(2)
    })
    it('a write that fails is tried again next time', async () => {
        const r = recorder()
        await writeIfChanged('k', [1], async () => { throw new Error('quota') })
        await writeIfChanged('k', [1], r.write)
        expect(r.writes).toHaveLength(1)
    })
    it('does not record a value before its write finishes', async () => {
        const r = recorder()
        let release!: () => void
        const slow = writeIfChanged('k', [1], () => new Promise<void>(res => { release = res }))
        await writeIfChanged('k', [1], r.write) // not recorded yet: this goes through
        release()
        await slow
        expect(r.writes).toHaveLength(1)
    })
    it('a forget-all during a write wins over that write', async () => {
        const r = recorder()
        let release!: () => void
        const slow = writeIfChanged('k', [1], () => new Promise<void>(res => { release = res }))
        forgetLastWritten()
        release()
        await slow
        await writeIfChanged('k', [1], r.write)
        expect(r.writes).toHaveLength(1)
    })
})
