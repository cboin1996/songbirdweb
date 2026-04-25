'use client'
import { useMemo, useState } from "react";
import { LibrarySong } from "../lib/data";
import Input from "../components/input";
import Song from "../components/song";
import { usePlayer } from "../components/player";
import { routes } from "../lib/routes";

export default function LibraryList({ initialSongs }: { initialSongs: LibrarySong[] }) {
    const [songs, setSongs] = useState(initialSongs)
    const [query, setQuery] = useState('')
    const { play, pause, resume, current, isPlaying } = usePlayer()

    const filtered = useMemo(() => {
        const q = query.toLowerCase()
        if (!q) return songs
        return songs.filter(s => {
            const p = s.properties
            if (!p) return false
            return (
                p.trackName.toLowerCase().includes(q) ||
                p.artistName.toLowerCase().includes(q) ||
                p.collectionName.toLowerCase().includes(q)
            )
        })
    }, [songs, query])

    if (songs.length === 0) {
        return <p className="text-gray-400 text-sm py-4">library is empty</p>
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="sticky top-11 z-40 bg-white/90 dark:bg-gray-950/90 backdrop-blur-md py-3">
                <Input
                    placeholder="filter by song, artist, or album"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    classAttrs="w-72"
                />
            </div>
            {filtered.length === 0
                ? <p className="text-gray-400 text-sm">no matches</p>
                : <div className="grid 2xl:grid-cols-4 xl:grid-cols-3 lg:grid-cols-2 gap-2 md:gap-8 rounded-2xl justify-items-stretch">
                    {filtered.map(song => song.properties && (
                        <Song
                            key={song.uuid}
                            song={{ songId: song.uuid, properties: song.properties }}
                            selected={current?.uuid === song.uuid}
                            onClick={() => {
                            if (!song.properties) return
                            const q = filtered.filter(s => s.properties).map(s => ({ uuid: s.uuid, properties: s.properties!, last_position: s.last_position, last_played_at: s.last_played_at }))
                            play({ uuid: song.uuid, properties: song.properties, last_position: song.last_position, last_played_at: song.last_played_at }, q, { label: 'Library', href: routes.library })
                        }}
                            inLibrary={true}
                            onRemove={() => setSongs(prev => prev.filter(s => s.uuid !== song.uuid))}
                        />
                    ))}
                </div>
            }
        </div>
    )
}
