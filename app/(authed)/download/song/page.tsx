'use client'
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { fetchPropertiesFromItunes, fetchPropertiesFromIndex, DownloadedSong } from "../../../lib/data"
import SongsSelector from "../../../components/songs"
import QueryError from "../../../components/query-error"

async function searchSongs(query: string, lookup: boolean, limit: number): Promise<DownloadedSong[]> {
    const properties = await fetchPropertiesFromIndex(query)
    if (properties === undefined) return []
    const itunesProperties = await fetchPropertiesFromItunes(query, lookup, limit)
    if (itunesProperties === undefined) return properties
    return [...properties, ...itunesProperties]
}

export default function Page() {
    const searchParams = useSearchParams()
    const query = searchParams.get('query') || ''
    const lookup = searchParams.get('lookup') === 'true'
    const limit = Number(searchParams.get('limit')) || 10

    const { data: songs, error, refetch, isLoading } = useQuery({
        queryKey: ['song-search', query, lookup, limit],
        queryFn: () => searchSongs(query, lookup, limit),
        enabled: query !== '',
        retry: false,
    })

    if (!query) return null
    if (isLoading) return <main className="p-4"><p className="text-gray-400 text-sm">searching…</p></main>
    if (error) return <main className="p-4"><QueryError error={error} retry={refetch} context="search results" /></main>

    return (
        <main>
            <SongsSelector key={query} songs={songs ?? []} />
        </main>
    )
}
