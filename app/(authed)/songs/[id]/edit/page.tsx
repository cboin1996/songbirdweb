'use client'
import { use, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { fetchLibrarySongs, LibrarySong } from '../../../../lib/data'
import { queryKeys } from '../../../../lib/query-keys'
import { useUser } from '../../../../lib/user-context'
import EditorModal from '../../../../components/editor-modal'
import QueryError from '../../../../components/query-error'
import { FaTimes } from 'react-icons/fa'

export default function EditPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params)
    const { isAdmin } = useUser()
    const router = useRouter()
    const mountedSongRef = useRef<LibrarySong | null>(null)
    const [editorKey, setEditorKey] = useState(0)

    const { data: songs, error, refetch, isLoading } = useQuery({
        queryKey: queryKeys.librarySongs,
        queryFn: fetchLibrarySongs,
        retry: false,
    })

    const song = songs?.find(s => s.uuid === id) ?? null
    if (song && song.properties) mountedSongRef.current = song
    const renderSong = song ?? mountedSongRef.current
    const canRender = renderSong && renderSong.properties

    if (isLoading && !canRender) {
        return (
            <div className="fixed inset-0 z-[60] bg-white dark:bg-gray-950 flex flex-col overflow-y-auto">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
                    <div className="flex-1 min-w-0"><p className="font-medium text-base">editor</p></div>
                    <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0 p-2 -m-1 ml-1 transition-colors touch-manipulation">
                        <FaTimes size={18} />
                    </button>
                </div>
                <div className="flex items-center justify-center flex-1">
                    <p className="text-gray-400 text-sm">loading editor…</p>
                </div>
            </div>
        )
    }

    if (!canRender) {
        return (
            <div className="fixed inset-0 z-[60] bg-white dark:bg-gray-950 flex flex-col overflow-y-auto">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 shrink-0">
                    <div className="flex-1 min-w-0"><p className="font-medium text-base">editor</p></div>
                    <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0 p-2 -m-1 ml-1 transition-colors touch-manipulation">
                        <FaTimes size={18} />
                    </button>
                </div>
                <div className="flex flex-col items-center justify-center flex-1 gap-4 p-6">
                    {error && <QueryError error={error} retry={refetch} context="song editor" />}
                    {!error && <p className="text-gray-400 text-sm">song not found</p>}
                </div>
            </div>
        )
    }

    return (
        <EditorModal
            key={`${id}-${editorKey}`}
            songId={id}
            properties={renderSong.properties!}
            artworkCached={renderSong.artwork_cached}
            parentSongId={renderSong.parent_song_id}
            rootSongId={renderSong.root_song_id}
            isAdmin={isAdmin}
            onRetryAudio={() => setEditorKey(k => k + 1)}
        />
    )
}
