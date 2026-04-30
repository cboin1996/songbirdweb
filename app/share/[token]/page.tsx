import Image from "next/image"
import { fetchShareInfo, fetchCurrentUser } from "../../lib/data"
import ShareActions from "./share-actions"
import { PlayerProvider } from "../../components/player"

export const dynamic = 'force-dynamic';

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    const [info, user] = await Promise.all([fetchShareInfo(token), fetchCurrentUser()])

    if (!info) {
        return (
            <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
                <div className="text-center">
                    <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Link expired</p>
                    <p className="text-gray-400 text-sm">This share link is no longer valid.</p>
                </div>
            </main>
        )
    }

    const p = info.properties
    // Relative URL hits Next.js's /v1 proxy (app/v1/[...path]/route.ts),
    // which forwards to the API. Avoids hardcoding the API origin into HTML.
    const downloadUrl = `/v1/share/${token}/download`

    return (
        <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
            <div className="flex flex-col items-center gap-6 max-w-sm w-full">
                {/* The /v1/share/<token>/artwork/<size> endpoint serves
                    server-cached artwork OR redirects to iTunes if available;
                    works for fixture-imported songs that have no iTunes URL. */}
                <Image
                    src={`/v1/share/${token}/artwork/full`}
                    alt=""
                    width={240}
                    height={240}
                    className="rounded-2xl shadow-xl"
                    unoptimized
                />

                <div className="text-center">
                    <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{p?.trackName ?? 'Unknown'}</p>
                    <p className="text-sky-500 font-medium mt-1">{p?.artistName}</p>
                    {p?.collectionName && (
                        <p className="text-gray-400 text-sm mt-0.5">{p.collectionName}</p>
                    )}
                </div>

                {user && p ? (
                    // PlayerProvider scoped here only (not in root layout) so anon
                    // visitors don't trigger authenticated background fetches.
                    <PlayerProvider>
                        <ShareActions songId={info.song_id} properties={p} downloadUrl={downloadUrl} />
                    </PlayerProvider>
                ) : (
                    <a
                        href={downloadUrl}
                        className="flex items-center gap-2 px-6 py-3 bg-sky-500 hover:bg-sky-400 text-white rounded-full font-medium transition-colors text-sm"
                    >
                        Download
                    </a>
                )}

                <p className="text-xs text-gray-300 dark:text-gray-600">
                    shared via songbird · expires {new Date(info.expires_at).toLocaleDateString()}
                </p>
            </div>
        </main>
    )
}
