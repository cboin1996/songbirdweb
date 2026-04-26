import Image from "next/image"
import { BASE_URL, fetchShareInfo, fetchCurrentUser, artworkUrl } from "../../lib/data"
import ShareActions from "./share-actions"

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
    const downloadUrl = `${BASE_URL}/share/${token}/download`

    return (
        <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
            <div className="flex flex-col items-center gap-6 max-w-sm w-full">
                {p?.artworkUrl100 && (
                    <Image
                        src={artworkUrl(p.artworkUrl100, 600)}
                        alt=""
                        width={240}
                        height={240}
                        className="rounded-2xl shadow-xl"
                    />
                )}
                <div className="text-center">
                    <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{p?.trackName ?? 'Unknown'}</p>
                    <p className="text-sky-500 font-medium mt-1">{p?.artistName}</p>
                    {p?.collectionName && (
                        <p className="text-gray-400 text-sm mt-0.5">{p.collectionName}</p>
                    )}
                </div>

                {user && p ? (
                    <ShareActions songId={info.song_id} properties={p} downloadUrl={downloadUrl} />
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
