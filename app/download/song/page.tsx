import { fetchPropertiesFromItunes, DownloadedSong, fetchPropertiesFromIndex } from "../../lib/data"
import React from "react"
import SongsSelector from "../../components/songs"

export default async function Page(props: {
    searchParams?: Promise<{
        query?: string,
        mode?: string,
        lookup?: boolean,
        limit?: number,
    }>;
}) {
    const searchParams = await props.searchParams
    const query = searchParams?.query || ''
    const lookup = searchParams?.lookup || false
    const limit = searchParams?.limit || 10

    async function getSongProperties(query: string) {
        if (query === '') return []
        const properties = await fetchPropertiesFromIndex(query)
        if (properties === undefined) return
        const itunesProperties = await fetchPropertiesFromItunes(query, lookup, limit)
        if (itunesProperties === undefined) return
        properties.push(...itunesProperties)
        return properties
    }

    const searchMatches = await getSongProperties(query)

    return (
        <main>
            {searchMatches !== undefined
                ? <SongsSelector key={query} songs={searchMatches} />
                : <p>cannot fetch songs, error occured.</p>}
        </main>
    )
}
