// Who owns the object URL the audio element is playing.
//
// Making a URL and assigning it are two steps with an await's worth of room
// around them, and two loads can overlap. If making one revoked the last, the
// slower load would hand the element a URL the faster had already killed. So a
// URL is revoked only when the element lets go of it, which is when the next
// source is assigned, and not when a competing load merely makes its own.
export function createBlobSlot() {
    let owned: string | null = null
    return {
        // `url` is now the element's source. Whatever blob it replaces is released.
        adopt(url: string) {
            if (owned && owned !== url) URL.revokeObjectURL(owned)
            owned = url.startsWith('blob:') ? url : null
        },
    }
}
