// Sorting and grouping of the library for each view, as pure functions. One
// locale collator does every comparison; building it once is much cheaper than
// calling localeCompare (which makes a collator per call) across a long list.
import type { LibrarySong } from './data'

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('')

export interface LibraryAlbum {
    collectionId: string
    collectionName: string
    artistName: string
    artworkUrl100: string | undefined
    songs: LibrarySong[]
}

const collator = new Intl.Collator(undefined)
// Trimmed, to agree with letterKey: a title with leading spaces sorts by its first letter.
const compare = (a: string, b: string) => collator.compare(a.trim(), b.trim())

export function letterKey(str: string): string {
    const first = str?.trim()[0]?.toUpperCase() ?? '#'
    return /[A-Z]/.test(first) ? first : '#'
}

// '#' sorts after every letter.
function byLetterThen(ka: string, kb: string): number {
    if (ka === '#' && kb !== '#') return 1
    if (kb === '#' && ka !== '#') return -1
    return 0
}

/** Songs (by title) or artists (by artist, then title) grouped under their first letter. */
export function groupSongsByLetter(songs: LibrarySong[], mode: 'songs' | 'artists'): Map<string, LibrarySong[]> {
    const nameOf = (s: LibrarySong) => mode === 'songs' ? s.properties!.trackName : s.properties!.artistName
    const sorted = songs.filter(s => s.properties).sort((a, b) => {
        const pa = a.properties!, pb = b.properties!
        const k = byLetterThen(letterKey(nameOf(a)), letterKey(nameOf(b)))
        if (k) return k
        if (mode === 'songs') return compare(pa.trackName, pb.trackName)
        return compare(pa.artistName, pb.artistName) || compare(pa.trackName, pb.trackName)
    })
    const map = new Map<string, LibrarySong[]>()
    for (const song of sorted) {
        const key = letterKey(nameOf(song))
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(song)
    }
    return map
}

/** Songs grouped by full genre name, genre then title; 'Unknown' last. */
export function groupSongsByGenre(songs: LibrarySong[]): Map<string, LibrarySong[]> {
    const genreOf = (s: LibrarySong) => s.properties?.primaryGenreName?.trim() || 'Unknown'
    const sorted = songs.filter(s => s.properties).sort((a, b) => {
        const ga = genreOf(a), gb = genreOf(b)
        if (ga === 'Unknown' && gb !== 'Unknown') return 1
        if (gb === 'Unknown' && ga !== 'Unknown') return -1
        return compare(ga, gb) || compare(a.properties!.trackName, b.properties!.trackName)
    })
    const map = new Map<string, LibrarySong[]>()
    for (const song of sorted) {
        const genre = genreOf(song)
        if (!map.has(genre)) map.set(genre, [])
        map.get(genre)!.push(song)
    }
    return map
}

/** Albums by name under their first letter; tracks in disc and track order. */
export function groupAlbumsByLetter(songs: LibrarySong[]): Map<string, LibraryAlbum[]> {
    const albumMap = new Map<string, LibraryAlbum>()
    for (const song of songs) {
        const p = song.properties
        if (!p) continue
        const artist = p.collectionArtistName || p.artistName || ''
        // Fall back to name+artist when collectionId is missing (raw imports lack iTunes IDs).
        const key = p.collectionId || `${p.collectionName ?? ''}::${artist}`
        if (!albumMap.has(key)) {
            albumMap.set(key, {
                collectionId: p.collectionId || key,
                collectionName: p.collectionName,
                artistName: artist,
                artworkUrl100: p.artworkUrl100,
                songs: [],
            })
        }
        albumMap.get(key)!.songs.push(song)
    }
    for (const album of albumMap.values()) {
        album.songs.sort((a, b) => (a.properties?.discNumber ?? 1) - (b.properties?.discNumber ?? 1) || (a.properties?.trackNumber ?? 0) - (b.properties?.trackNumber ?? 0))
        const bestProps = album.songs.find(s => s.properties?.collectionArtistName || s.properties?.artistName)?.properties
        if (bestProps) album.artistName = bestProps.collectionArtistName || bestProps.artistName || ''
    }
    const albums = [...albumMap.values()].sort((a, b) =>
        byLetterThen(letterKey(a.collectionName), letterKey(b.collectionName)) || compare(a.collectionName, b.collectionName))
    const grouped = new Map<string, LibraryAlbum[]>()
    for (const album of albums) {
        const key = letterKey(album.collectionName)
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key)!.push(album)
    }
    return grouped
}
