'use client'
import { useRef, useState } from 'react'
import Image from 'next/image'
import {
    Playlist, PlaylistSong,
    createPlaylist, renamePlaylist, deletePlaylist,
    fetchPlaylistSongs, removeSongFromPlaylist,
    songArtworkUrl,
} from '../lib/data'
import { usePlayer } from '../components/player'
import { FaPlay, FaPause, FaEllipsisV, FaPlus, FaTrash, FaTimes } from 'react-icons/fa'
import { routes } from '../lib/routes'

export default function PlaylistsView({
    playlists,
    onRefresh,
}: {
    playlists: Playlist[]
    onRefresh: () => void
}) {
    const { play, pause, isPlaying, playContext } = usePlayer()
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [expandedSongs, setExpandedSongs] = useState<PlaylistSong[]>([])
    const [loadingId, setLoadingId] = useState<string | null>(null)
    const [newName, setNewName] = useState('')
    const [creating, setCreating] = useState(false)
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
    const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
    const menuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
    const expandAbortRef = useRef<AbortController | null>(null)

    async function handleExpand(pl: Playlist) {
        if (expandedId === pl.id) {
            setExpandedId(null)
            setExpandedSongs([])
            return
        }
        expandAbortRef.current?.abort()
        const controller = new AbortController()
        expandAbortRef.current = controller
        setLoadingId(pl.id)
        const songs = await fetchPlaylistSongs(pl.id)
        if (controller.signal.aborted) return
        setExpandedId(pl.id)
        setExpandedSongs(songs)
        setLoadingId(null)
    }

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault()
        const name = newName.trim()
        if (!name) return
        await createPlaylist(name)
        setNewName('')
        setCreating(false)
        onRefresh()
    }

    async function handleRename(id: string) {
        const name = renameValue.trim()
        if (!name) return
        await renamePlaylist(id, name)
        setRenamingId(null)
        onRefresh()
    }

    async function handleDelete(id: string) {
        await deletePlaylist(id)
        if (expandedId === id) {
            setExpandedId(null)
            setExpandedSongs([])
        }
        onRefresh()
    }

    async function handleRemoveSong(playlistId: string, songUuid: string) {
        await removeSongFromPlaylist(playlistId, songUuid)
        setExpandedSongs(prev => prev.filter(s => s.uuid !== songUuid))
    }

    function handlePlayPlaylist(pl: Playlist, songs: PlaylistSong[]) {
        const playable = songs.filter(s => s.properties)
        if (!playable.length) return
        if (playContext?.id === pl.id && isPlaying) { pause(); return }
        const first = playable[0]
        const queue = playable.map(s => ({ uuid: s.uuid, properties: s.properties! }))
        play(
            { uuid: first.uuid, properties: first.properties! },
            queue,
            { label: `Playlist · ${pl.name}`, href: `${routes.library}?view=playlists`, id: pl.id }
        )
    }

    function openMenu(id: string, e: React.MouseEvent) {
        e.stopPropagation()
        const rect = menuBtnRefs.current[id]?.getBoundingClientRect()
        if (rect) setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
        setMenuOpenId(o => o === id ? null : id)
    }

    return (
        <div className="flex flex-col gap-2 pb-8">
            <div className="flex items-center gap-3 mb-2">
                {creating ? (
                    <form onSubmit={handleCreate} className="flex items-center gap-2">
                        <input
                            autoFocus
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            placeholder="playlist name"
                            className="rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:border-sky-500 px-3 py-1.5 text-sm outline-none transition-colors"
                        />
                        <button type="submit" className="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-white rounded-full text-sm">create</button>
                        <button type="button" onClick={() => { setCreating(false); setNewName('') }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                            <FaTimes size={12} />
                        </button>
                    </form>
                ) : (
                    <button
                        onClick={() => setCreating(true)}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium text-gray-400 hover:text-sky-500 border border-gray-200 dark:border-gray-800 hover:border-sky-500 transition-colors"
                    >
                        <FaPlus size={10} />
                        new playlist
                    </button>
                )}
            </div>

            {playlists.length === 0 && (
                <p className="text-gray-400 text-sm py-4">no playlists yet</p>
            )}

            {playlists.map(pl => (
                <div key={pl.id} className="rounded-lg border border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-3 px-3 py-2">
                        {renamingId === pl.id ? (
                            <form
                                onSubmit={e => { e.preventDefault(); handleRename(pl.id) }}
                                className="flex items-center gap-2 flex-1"
                            >
                                <input
                                    autoFocus
                                    value={renameValue}
                                    onChange={e => setRenameValue(e.target.value)}
                                    className="flex-1 rounded bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:border-sky-500 px-2 py-1 text-sm outline-none"
                                />
                                <button type="submit" className="text-xs px-2 py-1 bg-sky-500 text-white rounded">save</button>
                                <button type="button" onClick={() => setRenamingId(null)} className="text-gray-400 hover:text-gray-600">
                                    <FaTimes size={10} />
                                </button>
                            </form>
                        ) : (
                            <>
                                <button
                                    onClick={() => handleExpand(pl)}
                                    className="flex-1 text-left flex items-center gap-2"
                                >
                                    <span className="font-medium text-sm">{pl.name}</span>
                                    <span className="text-xs text-gray-400">{pl.song_count} songs</span>
                                    {loadingId === pl.id && <span className="text-xs text-sky-500">loading…</span>}
                                </button>
                                <button
                                    onClick={async () => {
                                        if (expandedId !== pl.id) {
                                            const songs = await fetchPlaylistSongs(pl.id)
                                            handlePlayPlaylist(pl, songs)
                                        } else {
                                            handlePlayPlaylist(pl, expandedSongs)
                                        }
                                    }}
                                    className={`p-1 transition-colors ${playContext?.id === pl.id && isPlaying ? 'text-sky-500 hover:text-sky-400' : 'text-gray-400 hover:text-sky-500'}`}
                                    title={playContext?.id === pl.id && isPlaying ? 'pause' : 'play'}
                                >
                                    {playContext?.id === pl.id && isPlaying ? <FaPause size={10} /> : <FaPlay size={10} />}
                                </button>
                                <button
                                    ref={el => { menuBtnRefs.current[pl.id] = el }}
                                    onClick={e => openMenu(pl.id, e)}
                                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
                                >
                                    <FaEllipsisV size={12} />
                                </button>
                            </>
                        )}
                    </div>

                    {expandedId === pl.id && (
                        <div className="border-t border-gray-100 dark:border-gray-800">
                            {expandedSongs.length === 0 ? (
                                <p className="text-gray-400 text-sm px-3 py-2">empty — add songs via the ⋮ menu on any song</p>
                            ) : (
                                expandedSongs.map(s => (
                                    <div key={s.uuid} className="flex items-center gap-3 px-3 py-2 border-t border-gray-50 dark:border-gray-900 first:border-t-0">
                                        {songArtworkUrl(s.uuid, s.artwork_cached, s.properties?.artworkUrl100, 200) ? (
                                            <Image
                                                src={songArtworkUrl(s.uuid, s.artwork_cached, s.properties!.artworkUrl100, 200)!}
                                                alt=""
                                                width={32}
                                                height={32}
                                                className="rounded shrink-0"
                                            />
                                        ) : (
                                            <div className="w-8 h-8 rounded shrink-0 bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-sm">🎵</div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm truncate">{s.properties?.trackName ?? s.uuid.slice(0, 8)}</p>
                                            <p className="text-xs text-sky-500 truncate">{s.properties?.artistName}</p>
                                        </div>
                                        <button
                                            onClick={() => handleRemoveSong(pl.id, s.uuid)}
                                            className="text-gray-300 hover:text-red-400 dark:text-gray-700 dark:hover:text-red-400 transition-colors shrink-0"
                                            title="remove from playlist"
                                        >
                                            <FaTrash size={10} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            ))}

            {menuOpenId && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpenId(null)} />
                    <div
                        className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1 min-w-[130px]"
                        style={{ top: menuPos.top, right: menuPos.right }}
                    >
                        <button
                            onClick={() => {
                                setRenamingId(menuOpenId)
                                setRenameValue(playlists.find(p => p.id === menuOpenId)?.name ?? '')
                                setMenuOpenId(null)
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                            Rename
                        </button>
                        <button
                            onClick={() => { handleDelete(menuOpenId); setMenuOpenId(null) }}
                            className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                            Delete
                        </button>
                    </div>
                </>
            )}
        </div>
    )
}
