'use client'
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { fetchPropertiesFromItunes, DownloadedSong } from "../../../lib/data"
import SongsSelector from "../../../components/songs"
import QueryError from "../../../components/query-error"

export default function Page() {
    const searchParams = useSearchParams()
    const query = searchParams.get('query') || ''
    const lookup = searchParams.get('lookup') === 'true'
    const limit = Number(searchParams.get('limit')) || 10

    const { data: songs, error, refetch, isLoading } = useQuery({
        queryKey: ['itunes-search', query, lookup, limit],
        queryFn: () => fetchPropertiesFromItunes(query, lookup, limit),
        enabled: query !== '',
        retry: false,
    })

    if (!query) return null
    if (isLoading) return <main className="p-4"><p className="text-gray-400 text-sm">searching iTunes…</p></main>
    if (error) return <main className="p-4"><QueryError error={error} retry={refetch} context="search results" /></main>
    if (!songs || songs.length === 0) return <main className="p-4"><p className="text-gray-400 text-sm">no iTunes matches</p></main>

    return (
        <main>
            <SongsSelector songs={songs} />
        </main>
    )
}
