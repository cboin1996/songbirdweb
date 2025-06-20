'use client'

import { useSearchParams } from "next/navigation"
import NavBar from "../components/navbar"
import { isValidUrl, fetchPropertiesViaUrl, fetchPropertiesFromItunes, Properties, DownloadedSong, fetchPropertiesFromIndex } from "../lib/data"
import React, { useState } from "react"
import Button from "../components/button"
import Input from "../components/input"
import SongsSelector from "../components/songs"
import { useRouter } from "next/navigation"
import Link from "next/link"

let initialProperties: DownloadedSong[] = []

export default function Page() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const api_key_optional = searchParams.get("apiKey")
    if (api_key_optional === null) {
        router.push(`/`)
    }
    const api_key = api_key_optional?.toString()!
    const statuses = {
        search: "enter a song name, artist, or URL",
        searching: "searching",
        propertySelect: "select a property below",
        noPropertiesFound: "no properties found, try another search."
    }
    const [text, setText] = useState('')
    const [status, setStatus] = useState(statuses.search)
    const [searchMatches, setSearchMatches] = useState(initialProperties)
    const isSearching = status === statuses.searching

    async function handleSubmit(event: React.ChangeEvent<HTMLButtonElement>) {
        event.preventDefault()
        setStatus(statuses.searching)
        let properties: DownloadedSong[] | undefined
        if (isValidUrl(text)) {
            properties = await fetchPropertiesViaUrl(text, api_key)
        } else {
            properties = await fetchPropertiesFromIndex(text, api_key)
            let itunesProperties = await fetchPropertiesFromItunes(text, api_key)
            properties.push(...itunesProperties)
        }
        if (properties.length === 0 || properties === undefined) {
            setStatus(statuses.noPropertiesFound)
            return
        }
        setSearchMatches(properties);
        setStatus(statuses.propertySelect)
    }

    return (
        <main className="px-2 py-2">
            <div>
                <form className="flex-row flex gap-2 py-4">
                    <Input
                        placeholder=" type here"
                        disabled={isSearching}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
                        width={72}
                    />
                    <Button
                        text="search"
                        onClick={handleSubmit}
                        disabled={isSearching || text === ""}
                    >
                    </Button>
                    <p>{status}</p>
                </form>
            </div>
            <SongsSelector songs={searchMatches}></SongsSelector>
        </main>
    )
}
