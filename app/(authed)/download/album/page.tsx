'use client'
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { fetchAlbumFromItunes } from "../../../lib/data"
import Albums from "@/app/components/albums"
import QueryError from "../../../components/query-error"

export default function Page() {
    const searchParams = useSearchParams()
    const query = searchParams.get('query') || ''

    const { data: albums, error, refetch, isLoading } = useQuery({
        queryKey: ['album-search', query],
        queryFn: () => fetchAlbumFromItunes(query, false),
        enabled: query !== '',
        retry: false,
    })

    if (!query) return null
    if (isLoading) return <main className="p-4"><p className="text-gray-400 text-sm">searching…</p></main>
    if (error) return <main className="p-4"><QueryError error={error} retry={refetch} context="search results" /></main>

    return (
        <main>
            <Albums albums={albums ?? []} />
        </main>
    )
}
