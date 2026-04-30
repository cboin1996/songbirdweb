import { Suspense } from "react";
import { fetchLibrarySongs } from "../../lib/data";
import LibraryList from "./library-list";

export const dynamic = 'force-dynamic';

export default async function Page() {
    const songs = await fetchLibrarySongs()
    return (
        <main className="p-4">
            <Suspense>
                <LibraryList initialSongs={songs} />
            </Suspense>
        </main>
    )
}
