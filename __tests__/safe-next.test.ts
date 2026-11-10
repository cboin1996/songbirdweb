import { safeNext } from '../app/lib/safe-next'

const ORIGIN = 'https://songbird.example'

describe('safeNext', () => {
    it('keeps a same-origin path with query and hash', () => {
        expect(safeNext('/library', ORIGIN)).toBe('/library')
        expect(safeNext('/library?sort=name#top', ORIGIN)).toBe('/library?sort=name#top')
    })

    it.each([
        ['absolute url', 'https://evil.example/x'],
        ['protocol-relative', '//evil.example/x'],
        ['backslash host', '/\\evil.example/x'],
        ['tab inside the slashes', '/\t/evil.example/x'],
        ['newline inside the slashes', '/\n/evil.example/x'],
        ['javascript scheme', 'javascript:alert(1)'],
        ['relative without a slash', 'library'],
        ['empty string', ''],
    ])('rejects %s', (_label, value) => {
        expect(safeNext(value, ORIGIN)).toBeNull()
    })

    it('rejects a missing value', () => {
        expect(safeNext(null, ORIGIN)).toBeNull()
    })
})
