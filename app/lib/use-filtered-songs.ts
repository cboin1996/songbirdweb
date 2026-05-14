import { useMemo } from 'react'

export function filterSongs<T extends { properties?: { trackName: string; artistName: string } | null }>(
    songs: T[],
    query: string,
): T[] {
    const q = query.trim().toLowerCase()
    if (!q) return songs
    return songs.filter(s => {
        const p = s.properties
        if (!p) return false
        return p.trackName.toLowerCase().includes(q) || p.artistName.toLowerCase().includes(q)
    })
}

export function useFilteredSongs<T extends { properties?: { trackName: string; artistName: string } | null }>(
    songs: T[],
    query: string,
): T[] {
    return useMemo(() => filterSongs(songs, query), [songs, query])
}
