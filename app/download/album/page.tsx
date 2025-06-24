import { isValidUrl, fetchPropertiesViaUrl, fetchPropertiesFromItunes, DownloadedSong, fetchPropertiesFromIndex, fetchAlbumFromItunes, AlbumProps } from "../../lib/data"
import React from "react"
import SongsSelector from "../../components/songs"
import Albums from "@/app/components/albums";

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
        const properties: AlbumProps[] = await fetchAlbumFromItunes(query, apiKey, false)
        return properties
    }
    const searchMatches = await getAlbumProperties(query, apiKey)

    return (
        <main>
            <Albums albums={searchMatches}></Albums>
        </main>
    )
}
