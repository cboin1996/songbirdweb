export const queryKeys = {
    library: ['library'] as const,
    librarySongs: ['library-songs'] as const,
    playlists: ['playlists'] as const,
    drafts: ['drafts'] as const,
    // Under the library list's key: whatever refreshes the library (an editor save, a retag,
    // new art, a download) also refreshes which songs can be published.
    eligibleSongs: ['library-songs', 'eligible'] as const,
    explore: ['explore'] as const,
    adminStats: ['admin-stats'] as const,
    adminUsers: ['admin-users'] as const,
    settings: ['settings'] as const,
    version: ['version'] as const,
}
