import { fetchAlbumFromItunes, AlbumProps } from "../../lib/data"
import React from "react"
import Albums from "@/app/components/albums";

export default async function Page(props: {
    searchParams?: Promise<{
        query?: string,
        mode?: string,
    }>;
}) {
    const searchParams = await props.searchParams
    const query = searchParams?.query || ''

    async function getAlbumProperties(query: string) {
        if (query === '') return []
        return fetchAlbumFromItunes(query, false)
    }

    const searchMatches = await getAlbumProperties(query)

    return (
        <main>
            {searchMatches !== undefined
                ? <Albums albums={searchMatches} />
                : <p>cannot fetch albums, error occured.</p>}
        </main>
    )
}
