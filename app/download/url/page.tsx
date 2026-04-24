import React from "react"
import DownloadViaUrl from "../../components/urldownload";

export default async function Page(props: {
    searchParams?: Promise<{
        query?: string,
        mode?: string,
    }>;
}) {
    const searchParams = await props.searchParams
    const query = searchParams?.query || ''
    return (
        <main>
            <DownloadViaUrl query={query} />
        </main>
    )
}
