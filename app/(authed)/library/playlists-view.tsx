'use client'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
    Playlist, PlaylistSong,
    createPlaylist, renamePlaylist, deletePlaylist,
    fetchPlaylistSongs, bulkRemoveSongsFromPlaylist, reorderPlaylistSongs,
} from '../../lib/data'
import { usePlayer } from '../../components/player'
import {
    FaPlay, FaPause, FaPlus, FaTimes, FaMusic,
    FaHeadphones, FaHeart, FaStar, FaList, FaFire, FaBolt, FaGlobe, FaDrum, FaGuitar,
    FaPencilAlt, FaTrash,
} from 'react-icons/fa'
import { routes } from '../../lib/routes'
import SongPickerModal, { PickerSong } from '../../components/song-picker-modal'

const PLAYLIST_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    music: FaMusic,
    headphones: FaHeadphones,
    heart: FaHeart,
    star: FaStar,
    list: FaList,
    fire: FaFire,
    bolt: FaBolt,
    globe: FaGlobe,
    drum: FaDrum,
    guitar: FaGuitar,
}
const ICON_KEYS = Object.keys(PLAYLIST_ICONS)

const BG_COLORS = [
    'bg-sky-500', 'bg-violet-500', 'bg-rose-500', 'bg-amber-500',
    'bg-emerald-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500',
]
function plBg(id: string) { return BG_COLORS[id.charCodeAt(0) % BG_COLORS.length] }

function PlaylistIcon({ pl, size = 22 }: { pl: Playlist; size?: number }) {
    const Icon = PLAYLIST_ICONS[pl.icon ?? 'music'] ?? FaMusic
    return <Icon size={size} className="text-white" />
}

function IconPicker({ value, onChange }: { value: string; onChange: (k: string) => void }) {
    return (
        <div className="flex flex-wrap gap-1">
            {ICON_KEYS.map(k => {
                const Icon = PLAYLIST_ICONS[k]
                return (
                    <button
                        key={k}
                        type="button"
                        onClick={() => onChange(k)}
                        className={`p-1.5 rounded-lg transition-colors ${value === k ? 'bg-sky-500 text-white' : 'text-gray-400 hover:text-sky-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                    >
                        <Icon size={14} />
                    </button>
                )
            })}
        </div>
    )
}

export default function PlaylistsView({
    playlists,
    onRefresh,
}: {
    playlists: Playlist[]
    onRefresh: () => void
}) {
    const { play, pause, isPlaying, playContext } = usePlayer()
    const [newName, setNewName] = useState('')
    const [newIcon, setNewIcon] = useState('music')
    const [creating, setCreating] = useState(false)
    const [loadingId, setLoadingId] = useState<string | null>(null)

    // modal
    const [modalSongs, setModalSongs] = useState<PickerSong[]>([])
    const [modalPlaylist, setModalPlaylist] = useState<Playlist | null>(null)
    const [modalLoading, setModalLoading] = useState(false)

    // rename (inline in modal header)
    const [renaming, setRenaming] = useState(false)
    const [renameValue, setRenameValue] = useState('')
    const [renameIcon, setRenameIcon] = useState('music')

    // context menu
    const [menuPl, setMenuPl] = useState<Playlist | null>(null)
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

    async function openModal(pl: Playlist) {
        setLoadingId(pl.id)
        const songs = await fetchPlaylistSongs(pl.id)
        setModalPlaylist(pl)
        setModalSongs(songs.map(s => ({ uuid: s.uuid, properties: s.properties, artwork_cached: s.artwork_cached })))
        setLoadingId(null)
    }

    function closeModal() {
        setModalPlaylist(null)
        setModalSongs([])
        setRenaming(false)
    }

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault()
        const name = newName.trim()
        if (!name) return
        await createPlaylist(name, newIcon)
        setNewName('')
        setNewIcon('music')
        setCreating(false)
        onRefresh()
    }

    async function handleRename(e: React.FormEvent) {
        e.preventDefault()
        if (!modalPlaylist) return
        const name = renameValue.trim()
        if (!name) return
        const updated = await renamePlaylist(modalPlaylist.id, name, renameIcon)
        if (updated) setModalPlaylist(updated)
        setRenaming(false)
        onRefresh()
    }

    async function handleDelete() {
        if (!modalPlaylist) return
        if (!confirm(`Delete "${modalPlaylist.name}"?`)) return
        await deletePlaylist(modalPlaylist.id)
        closeModal()
        onRefresh()
    }

    function openContextMenu(pl: Playlist, e: React.MouseEvent) {
        e.preventDefault()
        e.stopPropagation()
        const menuW = 140
        setMenuPos({
            top: e.clientY + 4,
            left: Math.min(e.clientX, window.innerWidth - menuW - 4),
        })
        setMenuPl(pl)
    }

    async function startRename(pl: Playlist) {
        setMenuPl(null)
        await openModal(pl)
        setRenameValue(pl.name)
        setRenameIcon(pl.icon ?? 'music')
        setRenaming(true)
    }

    async function deleteFromMenu(pl: Playlist) {
        setMenuPl(null)
        if (!confirm(`Delete "${pl.name}"?`)) return
        await deletePlaylist(pl.id)
        onRefresh()
    }

    async function handleRemove(idsToRemove: string[]) {
        if (!modalPlaylist || !idsToRemove.length) return
        setModalLoading(true)
        await bulkRemoveSongsFromPlaylist(modalPlaylist.id, idsToRemove)
        setModalSongs(prev => prev.filter(s => !idsToRemove.includes(s.uuid)))
        setModalLoading(false)
        onRefresh()
    }

    async function handleReorder(reordered: PickerSong[]) {
        if (!modalPlaylist) return
        setModalSongs(reordered)
        await reorderPlaylistSongs(modalPlaylist.id, reordered.map(s => s.uuid))
    }

    function playAll(songs: PlaylistSong[], pl: Playlist) {
        const playable = songs.filter(s => s.properties)
        if (!playable.length) return
        if (playContext?.id === pl.id && isPlaying) { pause(); return }
        const first = playable[0]
        const ctx = { label: `Playlist · ${pl.name}`, href: `${routes.library}?view=playlists`, id: pl.id }
        play(
            { uuid: first.uuid, properties: first.properties!, artwork_cached: first.artwork_cached, source: ctx },
            playable.map(s => ({ uuid: s.uuid, properties: s.properties!, artwork_cached: s.artwork_cached, source: ctx })),
            ctx
        )
    }

    const modalTitleActions = modalPlaylist && (
        <>
            {renaming ? (
                <form onSubmit={handleRename} className="flex items-center gap-1.5">
                    <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        className="w-32 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:border-sky-500 px-2 py-0.5 text-xs outline-none"
                    />
                    <div className="flex gap-0.5">
                        {ICON_KEYS.map(k => {
                            const Icon = PLAYLIST_ICONS[k]
                            return (
                                <button key={k} type="button" onClick={() => setRenameIcon(k)}
                                    className={`p-1 rounded transition-colors ${renameIcon === k ? 'bg-sky-500 text-white' : 'text-gray-400 hover:text-sky-500'}`}>
                                    <Icon size={11} />
                                </button>
                            )
                        })}
                    </div>
                    <button type="submit" className="text-xs px-2 py-0.5 bg-sky-500 text-white rounded shrink-0">save</button>
                    <button type="button" onClick={() => setRenaming(false)} className="text-gray-400 hover:text-gray-600 p-1">
                        <FaTimes size={10} />
                    </button>
                </form>
            ) : (
                <>
                    <button
                        onClick={() => { setRenameValue(modalPlaylist.name); setRenameIcon(modalPlaylist.icon ?? 'music'); setRenaming(true) }}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
                        title="rename"
                    >
                        <FaPencilAlt size={11} />
                    </button>
                    <button
                        onClick={handleDelete}
                        className="text-gray-400 hover:text-red-400 p-1"
                        title="delete playlist"
                    >
                        <FaTrash size={11} />
                    </button>
                </>
            )}
        </>
    )

    return (
        <div className="pb-8">
            {/* create form */}
            <div className="mb-4">
                {creating ? (
                    <form onSubmit={handleCreate} className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <input
                                autoFocus
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                placeholder="playlist name"
                                className="rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 focus:border-sky-500 px-3 py-1.5 text-sm outline-none transition-colors"
                            />
                            <button type="submit" className="px-3 py-1.5 bg-sky-500 hover:bg-sky-400 text-white rounded-full text-sm">create</button>
                            <button type="button" onClick={() => { setCreating(false); setNewName(''); setNewIcon('music') }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                                <FaTimes size={12} />
                            </button>
                        </div>
                        <IconPicker value={newIcon} onChange={setNewIcon} />
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

            {/* grid */}
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-1">
                {playlists.map(pl => {
                    const isThisPlaying = playContext?.id === pl.id && isPlaying
                    return (
                        <button
                            key={pl.id}
                            onClick={() => openModal(pl)}
                            onContextMenu={e => openContextMenu(pl, e)}
                            className="group flex flex-col gap-2 rounded-lg p-2 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-900 select-none"
                        >
                            <div className={`relative w-full aspect-square rounded-lg flex items-center justify-center ${plBg(pl.id)} ${loadingId === pl.id ? 'opacity-60' : ''}`}>
                                {loadingId === pl.id
                                    ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    : <PlaylistIcon pl={pl} size={32} />
                                }
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                                    <div
                                        role="button"
                                        onClick={async e => {
                                            e.stopPropagation()
                                            const songs = await fetchPlaylistSongs(pl.id)
                                            playAll(songs, pl)
                                        }}
                                        className="bg-black/40 rounded-full p-3 cursor-pointer"
                                    >
                                        {isThisPlaying ? <FaPause size={16} className="text-white" /> : <FaPlay size={16} className="text-white ml-0.5" />}
                                    </div>
                                </div>
                            </div>
                            <div className="flex flex-col min-w-0">
                                <p className="text-sm font-medium truncate">{pl.name}</p>
                                <p className="text-xs text-gray-400">{pl.song_count} songs</p>
                            </div>
                        </button>
                    )
                })}
            </div>

            <SongPickerModal
                open={!!modalPlaylist}
                onClose={closeModal}
                title={modalPlaylist?.name ?? ''}
                titleActions={modalTitleActions}
                songs={modalSongs}
                selectable
                actionLabel="Remove"
                actionLoading={modalLoading}
                onConfirm={handleRemove}
                reorderable
                onReorder={handleReorder}
                emptyState="no songs — add via ⋮ on any song"
            />

            {menuPl && typeof document !== 'undefined' && createPortal(
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuPl(null)} />
                    <div
                        className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl py-1"
                        style={{ top: menuPos.top, left: menuPos.left }}
                    >
                        <button
                            onClick={() => startRename(menuPl)}
                            className="whitespace-nowrap block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                            Rename
                        </button>
                        <button
                            onClick={() => { const pl = menuPl; setMenuPl(null); openModal(pl) }}
                            className="whitespace-nowrap block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                            Edit
                        </button>
                        <button
                            onClick={() => deleteFromMenu(menuPl)}
                            className="whitespace-nowrap block w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                            Delete
                        </button>
                    </div>
                </>,
                document.body
            )}
        </div>
    )
}
