'use client'
import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import {
    Playlist, PlaylistSong,
    createPlaylist, renamePlaylist, deletePlaylist,
    fetchPlaylistSongs, removeSongFromPlaylist,
    songArtworkUrl, artworkUrl,
} from '../lib/data'
import { usePlayer } from '../components/player'
import { FaPlay, FaPause, FaPlus, FaTrash, FaTimes, FaChevronLeft, FaEllipsisV, FaMusic } from 'react-icons/fa'
import { routes } from '../lib/routes'

export default function PlaylistsView({
    playlists,
    onRefresh,
}: {
    playlists: Playlist[]
    onRefresh: () => void
}) {
    const { play, pause, isPlaying, current, playContext } = usePlayer()
    const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null)
    const [activeSongs, setActiveSongs] = useState<PlaylistSong[]>([])
    const [loadingId, setLoadingId] = useState<string | null>(null)
    const [newName, setNewName] = useState('')
    const [creating, setCreating] = useState(false)
    const [renamingId, setRenamingId] = useState<string | null>(null)
    const [renameValue, setRenameValue] = useState('')
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
    const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
    const menuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})

    async function openPlaylist(pl: Playlist) {
        setLoadingId(pl.id)
        const songs = await fetchPlaylistSongs(pl.id)
        setActivePlaylist(pl)
        setActiveSongs(songs)
        setLoadingId(null)
    }

    function closePlaylist() {
        setActivePlaylist(null)
        setActiveSongs([])
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
        if (activePlaylist?.id === id) setActivePlaylist(p => p ? { ...p, name } : p)
    }

    async function handleDelete(id: string) {
        await deletePlaylist(id)
        if (activePlaylist?.id === id) closePlaylist()
        onRefresh()
    }

    async function handleRemoveSong(songUuid: string) {
        if (!activePlaylist) return
        await removeSongFromPlaylist(activePlaylist.id, songUuid)
        setActiveSongs(prev => prev.filter(s => s.uuid !== songUuid))
        onRefresh()
    }

    function playFrom(song: PlaylistSong, songs: PlaylistSong[], pl: Playlist) {
        const playable = songs.filter(s => s.properties)
        if (!playable.length) return
        const startIdx = playable.findIndex(s => s.uuid === song.uuid)
        const queue = playable.map(s => ({ uuid: s.uuid, properties: s.properties! }))
        play(
            { uuid: song.uuid, properties: song.properties! },
            queue,
            { label: `Playlist · ${pl.name}`, href: `${routes.library}?view=playlists`, id: pl.id }
        )
    }

    function playAll(songs: PlaylistSong[], pl: Playlist) {
        const playable = songs.filter(s => s.properties)
        if (!playable.length) return
        if (playContext?.id === pl.id && isPlaying) { pause(); return }
        const first = playable[0]
        play(
            { uuid: first.uuid, properties: first.properties! },
            playable.map(s => ({ uuid: s.uuid, properties: s.properties! })),
            { label: `Playlist · ${pl.name}`, href: `${routes.library}?view=playlists`, id: pl.id }
        )
    }

    function openMenu(id: string, e: React.MouseEvent) {
        e.stopPropagation()
        const rect = menuBtnRefs.current[id]?.getBoundingClientRect()
        if (rect) setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
        setMenuOpenId(o => o === id ? null : id)
    }

    // ── Detail view ──────────────────────────────────────────────────────────
    if (activePlaylist) {
        const isThisPlaying = playContext?.id === activePlaylist.id && isPlaying
        return (
            <div className="pb-8">
                {/* Header */}
                <div className="flex items-center gap-3 mb-4">
                    <button
                        onClick={closePlaylist}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors p-1 -ml-1"
                    >
                        <FaChevronLeft size={13} />
                    </button>
                    <h2 className="font-semibold text-base flex-1 min-w-0 truncate">{activePlaylist.name}</h2>
                    <span className="text-xs text-gray-400 shrink-0">{activeSongs.length} songs</span>
                    <button
                        onClick={() => playAll(activeSongs, activePlaylist)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                            isThisPlaying
                                ? 'bg-sky-500 text-white hover:bg-sky-400'
                                : 'bg-sky-500 text-white hover:bg-sky-400'
                        }`}
                    >
                        {isThisPlaying ? <FaPause size={9} /> : <FaPlay size={9} />}
                        {isThisPlaying ? 'pause' : 'play all'}
                    </button>
                </div>

                {/* Song list */}
                {activeSongs.length === 0 ? (
                    <p className="text-gray-400 text-sm py-6 text-center">empty — add songs via the ⋮ menu on any song</p>
                ) : (
                    <div className="flex flex-col">
                        {activeSongs.map((s, i) => {
                            const art = songArtworkUrl(s.uuid, s.artwork_cached, s.properties?.artworkUrl100, 200)
                            const isCurrentSong = current?.uuid === s.uuid
                            return (
                                <button
                                    key={s.uuid}
                                    onClick={() => s.properties && playFrom(s, activeSongs, activePlaylist)}
                                    disabled={!s.properties}
                                    className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors text-left group disabled:opacity-50 disabled:cursor-default"
                                >
                                    <span className="text-xs text-gray-300 dark:text-gray-600 w-5 text-right shrink-0 tabular-nums">
                                        {isCurrentSong && isPlaying
                                            ? <FaPlay size={8} className="text-sky-500 ml-auto" />
                                            : i + 1}
                                    </span>
                                    {art ? (
                                        <Image src={art} alt="" width={36} height={36} className="rounded shrink-0" unoptimized={s.artwork_cached} />
                                    ) : (
                                        <div className="w-9 h-9 rounded shrink-0 bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                                            <FaMusic size={10} className="text-gray-400" />
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-sm truncate ${isCurrentSong ? 'text-sky-500' : ''}`}>
                                            {s.properties?.trackName ?? s.uuid.slice(0, 8)}
                                        </p>
                                        <p className="text-xs text-gray-400 truncate">{s.properties?.artistName}</p>
                                    </div>
                                    <button
                                        onClick={e => { e.stopPropagation(); handleRemoveSong(s.uuid) }}
                                        className="text-gray-200 hover:text-red-400 dark:text-gray-700 dark:hover:text-red-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100 p-1"
                                        title="remove from playlist"
                                    >
                                        <FaTrash size={10} />
                                    </button>
                                </button>
                            )
                        })}
                    </div>
                )}
            </div>
        )
    }

    // ── List view ─────────────────────────────────────────────────────────────
    return (
        <div className="pb-8">
            {/* New playlist */}
            <div className="flex items-center gap-3 mb-4">
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

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {playlists.map(pl => {
                    const isThisPlaying = playContext?.id === pl.id && isPlaying
                    return (
                        <div key={pl.id} className="group relative flex flex-col gap-2">
                            {/* Artwork mosaic / tap to open */}
                            <button
                                onClick={() => openPlaylist(pl)}
                                className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 w-full"
                            >
                                {loadingId === pl.id ? (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="w-4 h-4 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                                    </div>
                                ) : (
                                    <PlaylistMosaic playlistId={pl.id} />
                                )}
                                {/* Play/pause overlay */}
                                <div className={`absolute inset-0 flex items-end justify-end p-2 transition-opacity ${isThisPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                    <button
                                        onClick={async e => {
                                            e.stopPropagation()
                                            const songs = await fetchPlaylistSongs(pl.id)
                                            playAll(songs, pl)
                                        }}
                                        className="bg-sky-500 hover:bg-sky-400 text-white rounded-full p-2 shadow-lg transition-colors"
                                        title={isThisPlaying ? 'pause' : 'play'}
                                    >
                                        {isThisPlaying ? <FaPause size={10} /> : <FaPlay size={10} />}
                                    </button>
                                </div>
                            </button>

                            {/* Name row */}
                            <div className="flex items-start gap-1 min-w-0 px-0.5">
                                {renamingId === pl.id ? (
                                    <form
                                        onSubmit={e => { e.preventDefault(); handleRename(pl.id) }}
                                        className="flex items-center gap-1 flex-1"
                                    >
                                        <input
                                            autoFocus
                                            value={renameValue}
                                            onChange={e => setRenameValue(e.target.value)}
                                            className="flex-1 min-w-0 rounded bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:border-sky-500 px-2 py-0.5 text-sm outline-none"
                                        />
                                        <button type="submit" className="text-xs px-2 py-0.5 bg-sky-500 text-white rounded shrink-0">ok</button>
                                        <button type="button" onClick={() => setRenamingId(null)} className="text-gray-400 hover:text-gray-600 shrink-0">
                                            <FaTimes size={9} />
                                        </button>
                                    </form>
                                ) : (
                                    <>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">{pl.name}</p>
                                            <p className="text-xs text-gray-400">{pl.song_count} songs</p>
                                        </div>
                                        <button
                                            ref={el => { menuBtnRefs.current[pl.id] = el }}
                                            onClick={e => openMenu(pl.id, e)}
                                            className="text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 p-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <FaEllipsisV size={11} />
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Context menu */}
            {menuOpenId && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpenId(null)} />
                    <div
                        className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1"
                        style={{ top: menuPos.top, right: menuPos.right }}
                    >
                        <button
                            onClick={() => {
                                setRenamingId(menuOpenId)
                                setRenameValue(playlists.find(p => p.id === menuOpenId)?.name ?? '')
                                setMenuOpenId(null)
                            }}
                            className="whitespace-nowrap block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                            Rename
                        </button>
                        <button
                            onClick={() => { handleDelete(menuOpenId); setMenuOpenId(null) }}
                            className="whitespace-nowrap block w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                            Delete
                        </button>
                    </div>
                </>
            )}
        </div>
    )
}

function PlaylistMosaic({ playlistId }: { playlistId: string }) {
    const [urls, setUrls] = useState<string[] | null>(null)

    useEffect(() => {
        fetchPlaylistSongs(playlistId).then(songs => {
            const found = songs
                .filter(s => s.properties?.artworkUrl100)
                .slice(0, 4)
                .map(s => artworkUrl(s.properties!.artworkUrl100, 200))
            setUrls(found)
        })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playlistId])

    if (!urls || urls.length === 0) {
        return (
            <div className="absolute inset-0 flex items-center justify-center">
                <FaMusic size={24} className="text-gray-300 dark:text-gray-600" />
            </div>
        )
    }

    if (urls.length < 4) {
        return <Image src={urls[0]} alt="" fill sizes="200px" className="object-cover" />
    }

    return (
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
            {urls.map((u, i) => (
                <div key={i} className="relative overflow-hidden">
                    <Image src={u} alt="" fill sizes="100px" className="object-cover" />
                </div>
            ))}
        </div>
    )
}
