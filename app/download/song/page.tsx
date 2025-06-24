import { isValidUrl, fetchPropertiesViaUrl, fetchPropertiesFromItunes, DownloadedSong, fetchPropertiesFromIndex } from "../../lib/data"
import React from "react"
import SongsSelector from "../../components/songs"

export default async function Page(props: {
    searchParams?: Promise<{
        query?: string,
        apiKey?: string,
        mode?: string
        lookup?: boolean
        limit?: number
    }>;
}) {
    const searchParams = await props.searchParams
    const apiKey = searchParams?.apiKey || ''
    const query = searchParams?.query || ''
    const lookup = searchParams?.lookup || false
    const limit = searchParams?.limit || 10
    async function getSongProperties(query: string, apiKey: string) {
        if (query === '') {
            return []
        }
        let properties: DownloadedSong[] = []
        // only search index if itunes direct lookup isn't used
        properties = await fetchPropertiesFromIndex(query, apiKey)
        let itunesProperties = await fetchPropertiesFromItunes(query, apiKey, lookup, limit)
        properties.push(...itunesProperties)
        if (properties.length === 0 || properties === undefined) {
            return []
        }
        return properties
    }
    const searchMatches = await getSongProperties(query, apiKey)

    return (
        <main>
            <SongsSelector songs={searchMatches}></SongsSelector>
        </main>
    )
}
