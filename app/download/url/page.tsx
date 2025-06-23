import { downloadSongViaUrl} from "../../lib/data";

import React from "react"
import DownloadViaUrl from "../../components/urldownload";

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
 
    return (
        <main>
            <DownloadViaUrl query={query} apiKey={apiKey}></DownloadViaUrl>
        </main>
    )
}
