import { fetchExplore, ExploreWindow } from "../../lib/data"
import ExploreClient from "./explore-client"

export default async function Page(props: {
    searchParams?: Promise<{ window?: string }>
}) {
    const searchParams = await props.searchParams
    const window = (searchParams?.window ?? 'week') as ExploreWindow
    const data = await fetchExplore(window)
    return (
        <main className="p-4">
            <ExploreClient data={data} window={window} />
        </main>
    )
}
