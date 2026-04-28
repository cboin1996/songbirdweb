export const routes = {
    home: '/',
    download: '/download',
    downloadSong: '/download/song',
    downloadAlbum: '/download/album',
    downloadUrl: '/download/url',
    library: '/library',
    explore: '/explore',
    import: '/import',
    admin: '/admin',
    settings: '/settings',
    info: '/info',
} as const

export function editSongRoute(songId: string) {
    return `/songs/${songId}/edit`
}
