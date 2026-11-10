// Who owns the object URL on the audio element. A URL is revoked when the
// element lets go of it, never when a competing load merely asks for its own.
import { createBlobSlot } from '../app/lib/blob-slot'

let revoked: string[]

beforeEach(() => {
    revoked = []
    URL.revokeObjectURL = jest.fn((u: string) => { revoked.push(u) })
})

describe('createBlobSlot', () => {
    it('revokes the previous blob when a new one is adopted', () => {
        const slot = createBlobSlot()
        slot.adopt('blob:a')
        slot.adopt('blob:b')
        expect(revoked).toEqual(['blob:a'])
    })

    it('revokes the blob when a stream source replaces it', () => {
        const slot = createBlobSlot()
        slot.adopt('blob:a')
        slot.adopt('http://api/v1/download/x')
        expect(revoked).toEqual(['blob:a'])
    })

    it('has nothing to revoke when a stream replaces a stream', () => {
        const slot = createBlobSlot()
        slot.adopt('http://api/v1/download/x')
        slot.adopt('http://api/v1/download/y')
        expect(revoked).toEqual([])
    })

    it('does not revoke a blob that is adopted again', () => {
        const slot = createBlobSlot()
        slot.adopt('blob:a')
        slot.adopt('blob:a')
        expect(revoked).toEqual([])
    })
})
