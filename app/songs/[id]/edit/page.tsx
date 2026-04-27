import { notFound } from 'next/navigation'
import { fetchLibrarySongs, fetchCurrentUser } from '../../../lib/data'
import EditorModal from '../../../components/editor-modal'

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const [songs, user] = await Promise.all([fetchLibrarySongs(), fetchCurrentUser()])
    const song = songs.find(s => s.uuid === id)
    if (!song || !song.properties) notFound()
    return (
        <EditorModal
            songId={id}
            properties={song.properties}
            artworkCached={song.artwork_cached}
            parentSongId={song.parent_song_id}
            rootSongId={song.root_song_id}
            isAdmin={user?.role === 'admin' || false}
        />
    )
}
