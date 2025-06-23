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
    const mode = searchParams?.mode || 'album'
    async function getAlbumProperties(query: string, apiKey: string) {
        if (query === '') {
            return []
        }
    }
    const searchMatches = await getAlbumProperties(query, apiKey)

    return (
        <main>
            <p>album mode not implemented yet</p>
        </main>
    )
}
