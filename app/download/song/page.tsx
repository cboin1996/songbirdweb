import { isValidUrl, fetchPropertiesViaUrl, fetchPropertiesFromItunes, DownloadedSong, fetchPropertiesFromIndex } from "../../lib/data"
import React from "react"
import SongsSelector from "../../components/songs"

export default async function Page(props: {
    searchParams?: Promise<{
        query?: string,
        apiKey?: string,
        mode?: string
    }>;
}) {
    const searchParams = await props.searchParams
    const apiKey = searchParams?.apiKey || ''
    const query = searchParams?.query || ''
    const mode = searchParams?.mode || 'song'
    async function getSongProperties(query: string, apiKey: string) {
        if (query === '') {
            return []
        }
        let properties: DownloadedSong[]
        if (isValidUrl(query)) {
            properties = await fetchPropertiesViaUrl(query, apiKey)
        } else {
            properties = await fetchPropertiesFromIndex(query, apiKey)
            let itunesProperties = await fetchPropertiesFromItunes(query, apiKey)
            properties.push(...itunesProperties)
        }
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
