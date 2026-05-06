export const routes = {
    home: '/',
    download: '/download',
    downloadSong: '/download/song',
    downloadAlbum: '/download/album',
    downloadUrl: '/download/url',
    library: '/library',
    librarySongs: '/library?view=songs',
    libraryArtists: '/library?view=artists',
    libraryAlbums: '/library?view=albums',
    libraryGenres: '/library?view=genres',
    libraryPlaylists: '/library?view=playlists',
    explore: '/explore',
    import: '/import',
    admin: '/admin',
    settings: '/settings',
    info: '/info',
    share: '/share',
} as const

export function downloadSongQuery(query: string) {
    return `${routes.downloadSong}?query=${encodeURIComponent(query)}`
}

export function downloadAlbumQuery(query: string) {
    return `${routes.downloadAlbum}?query=${encodeURIComponent(query)}`
}

export function downloadUrlQuery(url: string) {
    return `${routes.downloadUrl}?query=${encodeURIComponent(url)}`
}

export function exploreQuery(params: string) {
    return `${routes.explore}?${params}`
}

export function sharePath(token: string) {
    return `${routes.share}/${token}`
}

export function editSongRoute(songId: string) {
    return `/songs/${songId}/edit`
}
